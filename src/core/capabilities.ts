/**
 * What the bundled ImageMagick build can really read/write, and how to
 * check that an output file actually is the format it claims to be.
 *
 * Background: the KnicKnic magick.wasm (IM 7.0.8-28, 2019) has only the
 * jpeg/png/tiff/zlib delegates. Asked for an unknown format (avif, heic,
 * jxl, jp2, exr, xwd) it silently writes the INPUT format instead — the
 * user got "photo.avif" that was a PNG. WEBP needs the external `cwebp`
 * and fails outright.
 */
import { normalizeFormat } from './formats';

export interface MagickFormats { read: Set<string>; write: Set<string> }

/** Parses `convert -list format` output ("   PNG* rw-   Portable …"). */
export function parseFormatList(lines: readonly string[] | string): MagickFormats {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines);
  const read = new Set<string>();
  const write = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9-]+)(\*?)\s+([r-])([w-])([+-])\s/.exec(line);
    if (!m) continue;
    const name = normalizeFormat(m[1]!);
    if (m[3] === 'r') read.add(name);
    if (m[4] === 'w') write.add(name);
  }
  // JPEG is listed as JPEG/JPG; TIFF as TIFF/TIFF64 — normalizeFormat folds them.
  return { read, write };
}

export type OutputRoute = 'magick' | 'browser';

export interface EngineCaps {
  /** Output format → which encoder produces it. Missing = unsupported. */
  outputs: Map<string, OutputRoute>;
  /** Browser can decode these input MIME types as a fallback (webp, avif…). */
  browserDecode: boolean;
  /** Browser WebP encoder honours quality=1 as lossless (true in Chromium). */
  webpLossless: boolean;
}

/** Formats we'd rather encode with the browser even if IM claims support. */
const PREFER_BROWSER: ReadonlySet<string> = new Set();

export function buildCaps(
  candidates: readonly string[],
  magick: MagickFormats | null,
  browserEncoders: ReadonlySet<string>,
  extra: { browserDecode: boolean; webpLossless: boolean },
): EngineCaps {
  const outputs = new Map<string, OutputRoute>();
  for (const f of candidates) {
    const fmt = normalizeFormat(f);
    if (browserEncoders.has(fmt) && (PREFER_BROWSER.has(fmt) || !magick?.write.has(fmt))) outputs.set(fmt, 'browser');
    else if (!magick || magick.write.has(fmt)) outputs.set(fmt, 'magick');
  }
  return { outputs, ...extra };
}

/* ---------------------------------------------------------------- magic */

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/** Best-effort sniffing of the formats whose signature we know. */
export function sniffFormat(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(b, [0x8a, 0x4d, 0x4e, 0x47])) return 'mng';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (ascii(b, 0, 4) === '8BPS') return 'psd';
  if (ascii(b, 0, 4) === '%PDF') return 'pdf';
  if (ascii(b, 0, 4) === 'DDS ') return 'dds';
  if (starts(b, [0x76, 0x2f, 0x31, 0x01])) return 'exr';
  if (starts(b, [0xff, 0x0a]) || ascii(b, 4, 8) === 'JXL ') return 'jxl';
  if (ascii(b, 4, 8) === 'jP  ' || starts(b, [0xff, 0x4f, 0xff, 0x51])) return 'jp2';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
  }
  return null;
}

/** Formats whose output we can positively verify by signature. */
const VERIFIABLE: ReadonlySet<string> = new Set(['png', 'jpg', 'gif', 'webp', 'tiff', 'bmp', 'psd', 'pdf', 'dds', 'exr', 'jxl', 'jp2', 'avif', 'heic', 'heif', 'mng']);

/**
 * False when the bytes are clearly NOT the requested format — either a
 * verifiable format with the wrong signature, or any format whose bytes
 * sniff as a different known format (the "PNG renamed to .xwd" case).
 */
export function outputMatchesFormat(format: string, bytes: Uint8Array): boolean {
  const want = normalizeFormat(format) === 'heif' ? 'heic' : normalizeFormat(format);
  const got = sniffFormat(bytes);
  if (VERIFIABLE.has(want)) return got === want;
  // Containers that legitimately embed other formats.
  if (want === 'ico' || want === 'cur' || want === 'svg' || want === 'eps' || want === 'ps' || want === 'miff') return true;
  return got === null;
}
