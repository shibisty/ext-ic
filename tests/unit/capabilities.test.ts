import { describe, expect, it } from 'vitest';
import { buildCaps, outputMatchesFormat, parseFormatList, sniffFormat } from '../../src/core/capabilities';

// Excerpt of the real `convert -list format` from the bundled magick.wasm.
const LIST = `
   Format  Mode  Description
-------------------------------------------------------------------------------
      ARW  r--   Sony Alpha Raw Image Format
      BMP* rw-   Microsoft Windows bitmap image
      BRF* -w-   BRF ASCII Braille format
      GIF* rw+   CompuServe graphics interchange format
      ICO* rw+   Microsoft icon
     JPEG* rw-   Joint Photographic Experts Group JFIF format (libjpeg 90)
      JPG* rw-   Joint Photographic Experts Group JFIF format
      PDF  rw+   Portable Document Format
      PNG* rw-   Portable Network Graphics (libpng 1.6.35beta02)
     TIFF* rw+   Tagged Image File Format (LIBTIFF, Version 4.0.9)
`;

describe('parseFormatList', () => {
  it('reads r/w flags and normalizes names', () => {
    const f = parseFormatList(LIST);
    expect([...f.write].sort()).toEqual(['bmp', 'brf', 'gif', 'ico', 'jpg', 'pdf', 'png', 'tiff']);
    expect(f.read.has('arw')).toBe(true);
    expect(f.write.has('arw')).toBe(false);
    expect(f.read.has('brf')).toBe(false);
  });
  it('accepts an array of lines (library stdout)', () => {
    expect(parseFormatList(LIST.split('\n')).write.has('png')).toBe(true);
  });
});

describe('buildCaps', () => {
  const magick = parseFormatList(LIST);
  it('routes IM-writable formats to magick, missing ones to the browser if it can encode them', () => {
    const caps = buildCaps(['png', 'jpg', 'webp', 'avif', 'heic'], magick, new Set(['webp']), { browserDecode: true, webpLossless: true });
    expect(Object.fromEntries(caps.outputs)).toEqual({ png: 'magick', jpg: 'magick', webp: 'browser' });
  });
  it('trusts the candidate list when the format list is unknown', () => {
    const caps = buildCaps(['png', 'avif'], null, new Set(), { browserDecode: false, webpLossless: false });
    expect([...caps.outputs.keys()]).toEqual(['png', 'avif']);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
const AVIF = new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode('ftypavif')]);

describe('sniffFormat / outputMatchesFormat', () => {
  it('recognizes common signatures', () => {
    expect(sniffFormat(PNG)).toBe('png');
    expect(sniffFormat(JPG)).toBe('jpg');
    expect(sniffFormat(WEBP)).toBe('webp');
    expect(sniffFormat(AVIF)).toBe('avif');
    expect(sniffFormat(new TextEncoder().encode('GIF89a..'))).toBe('gif');
    expect(sniffFormat(new TextEncoder().encode('P6\n64 48'))).toBeNull();
  });
  it('rejects a PNG pretending to be AVIF/XWD (the v1.0 bug)', () => {
    expect(outputMatchesFormat('avif', PNG)).toBe(false);
    expect(outputMatchesFormat('xwd', PNG)).toBe(false);
    expect(outputMatchesFormat('heif', PNG)).toBe(false);
  });
  it('accepts genuine outputs and unknown-signature formats', () => {
    expect(outputMatchesFormat('png', PNG)).toBe(true);
    expect(outputMatchesFormat('jpeg', JPG)).toBe(true);
    expect(outputMatchesFormat('webp', WEBP)).toBe(true);
    expect(outputMatchesFormat('ppm', new TextEncoder().encode('P6\n64 48\n255\n'))).toBe(true);
    expect(outputMatchesFormat('ico', PNG)).toBe(true); // ICO may embed PNG frames
  });
});
