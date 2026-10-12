import { describe, expect, it } from 'vitest';
import { buildSaveFilename, nameFromUrl, replaceExt, sanitizeFolder, uniqueNames } from '../../src/core/filenames';

describe('filenames', () => {
  it('replaceExt', () => {
    expect(replaceExt('photo.final.PNG', 'jpg')).toBe('photo.final.jpg');
    expect(replaceExt('.hidden', 'png')).toBe('.hidden.png');
    expect(replaceExt('noext', 'webp')).toBe('noext.webp');
  });

  it('sanitizeFolder keeps the path inside Downloads', () => {
    expect(sanitizeFolder('  /Images\\2026/../x/ ')).toBe('Images/2026/x');
    expect(sanitizeFolder('a:b/c*d?')).toBe('a_b/c_d_');
    expect(sanitizeFolder('con/aux')).toBe('_con/_aux');
    expect(sanitizeFolder('trailing. /')).toBe('trailing');
    expect(sanitizeFolder('')).toBe('');
  });

  it('buildSaveFilename', () => {
    expect(buildSaveFilename('ImageConverter', 'тест.png')).toBe('ImageConverter/тест.png');
    expect(buildSaveFilename('', 'a/b.png')).toBe('a_b.png');
    expect(buildSaveFilename('x', 'what?.png')).toBe('x/what_.png');
  });

  it('uniqueNames is case-insensitive and keeps order', () => {
    expect(uniqueNames(['a.png', 'A.png', 'a.png', 'b'])).toEqual(['a.png', 'A (1).png', 'a (2).png', 'b']);
  });

  it('nameFromUrl', () => {
    expect(nameFromUrl('https://ex.com/img/%D1%84%D0%BE%D1%82%D0%BE.jpg?w=1', 'image/jpeg')).toBe('фото.jpg');
    expect(nameFromUrl('https://ex.com/render', 'image/webp')).toBe('render.webp');
    expect(nameFromUrl('data:image/png;base64,AAA', 'image/png')).toBe('image.png');
    expect(nameFromUrl('https://ex.com/i', 'image/svg+xml')).toBe('i.svg');
  });
});
