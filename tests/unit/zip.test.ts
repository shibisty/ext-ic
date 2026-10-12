import { describe, expect, it } from 'vitest';
import { crc32, createZipBytes, dosDateTime } from '../../src/core/zip';

/** Tiny reader for what we write (store method only). */
function readZip(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const flags = dv.getUint16(p + 8, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(local + 26, true);
    const data = buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + size);
    entries.push({ name, flags, crc, data });
    p += 46 + nameLen;
  }
  return entries;
}

describe('zip', () => {
  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes readable entries with the UTF-8 flag', () => {
    const files = [
      { name: 'тест.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'b.jpg', data: new Uint8Array(1000).fill(7) },
    ];
    const entries = readZip(createZipBytes(files, new Date(2026, 9, 12, 8, 30, 10)));
    expect(entries.map((e) => e.name)).toEqual(['тест.png', 'b.jpg']);
    for (const [i, e] of entries.entries()) {
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(Array.from(e.data)).toEqual(Array.from(files[i]!.data));
      expect(e.crc).toBe(crc32(files[i]!.data));
    }
  });

  it('dos date/time encoding', () => {
    const { time, date } = dosDateTime(new Date(2026, 9, 12, 8, 30, 10));
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 12);
    expect(time).toBe((8 << 11) | (30 << 5) | 5);
  });
});
