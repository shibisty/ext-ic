// Packs dist/<target> into store-ready ZIPs (+ a sources ZIP for AMO review).
//   npm run zip   →  release/ext-ic-chrome-<v>.zip, ext-ic-firefox-<v>.zip, ext-ic-source-<v>.zip
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = join(root, 'release');
mkdirSync(outDir, { recursive: true });

const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function walk(dir, skip = () => false) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (skip(p)) return [];
    return statSync(p).isDirectory() ? walk(p, skip) : [p];
  });
}

function zip(files, base) {
  const parts = []; const central = []; let offset = 0;
  for (const file of files.sort()) {
    const name = Buffer.from(relative(base, file).split(sep).join('/'), 'utf8');
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDeflate ? 8 : 0, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

for (const target of ['chrome', 'firefox']) {
  const dir = join(root, 'dist', target);
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`dist/${target} is missing — run npm run build`);
  const out = join(outDir, `ext-ic-${target}-${version}.zip`);
  writeFileSync(out, zip(walk(dir, (p) => p.endsWith('README.md')), dir));
  console.log(`✓ ${relative(root, out)}`);
}

// AMO asks for sources when the submitted code is bundled.
const ignore = new Set(['node_modules', 'dist', 'release', '.git', '_legacy-js', 'test-results']);
const src = walk(root, (p) => ignore.has(relative(root, p).split(sep)[0]));
const srcOut = join(outDir, `ext-ic-source-${version}.zip`);
writeFileSync(srcOut, zip(src, root));
console.log(`✓ ${relative(root, srcOut)}`);
