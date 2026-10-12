import { describe, expect, it } from 'vitest';
import { buildConvertCommand, cropGeometry, optimArgs, resizeGeometry } from '../../src/core/command';

describe('resizeGeometry', () => {
  it('handles percent and exact sizes', () => {
    expect(resizeGeometry({ mode: 'percent', percent: 50 })).toBe('50%');
    expect(resizeGeometry({ mode: 'exact', width: 800, height: 0 })).toBe('800x');
    expect(resizeGeometry({ mode: 'exact', width: 0, height: 600 })).toBe('x600');
    expect(resizeGeometry({ mode: 'exact', width: 800.4, height: 600 })).toBe('800x600');
  });
  it('ignores empty / invalid values', () => {
    expect(resizeGeometry(null)).toBeNull();
    expect(resizeGeometry({ mode: 'percent', percent: 0 })).toBeNull();
    expect(resizeGeometry({ mode: 'percent', percent: Number.NaN })).toBeNull();
    expect(resizeGeometry({ mode: 'exact', width: -5, height: 0 })).toBeNull();
  });
});

describe('cropGeometry', () => {
  it('formats WxH+X+Y and clamps negatives', () => {
    expect(cropGeometry({ x: 10, y: 20, w: 100, h: 50 })).toBe('100x50+10+20');
    expect(cropGeometry({ x: -3, y: 2.6, w: 10.2, h: 9.7 })).toBe('10x10+0+3');
  });
  it('rejects zero-size crops', () => {
    expect(cropGeometry({ x: 0, y: 0, w: 0, h: 10 })).toBeNull();
  });
});

describe('optimArgs', () => {
  it('png lossy uses FloydSteinberg and color count', () => {
    expect(optimArgs('png', { mode: 'lossy', level: '9', colors: '64', dither: 'on' }))
      .toEqual(['-define', 'png:compression-level=9', '-dither', 'FloydSteinberg', '-colors', '64']);
    expect(optimArgs('png', { mode: 'lossy', colors: '8', dither: 'off' })).toEqual(['+dither', '-colors', '8']);
    expect(optimArgs('png', { mode: 'lossless', level: '6', colors: '8' })).toEqual(['-define', 'png:compression-level=6']);
  });
  it('jpg options (also for "jpeg")', () => {
    expect(optimArgs('jpeg', { progressive: 'on', subsampling: '4:2:0', optimizeCoding: 'off' }))
      .toEqual(['-interlace', 'Plane', '-sampling-factor', '4:2:0', '-define', 'jpeg:optimize-coding=false']);
  });
  it('webp options', () => {
    expect(optimArgs('webp', { lossless: 'on', method: '6' })).toEqual(['-define', 'webp:lossless=true', '-define', 'webp:method=6']);
  });
  it('nothing for other formats or no optim', () => {
    expect(optimArgs('gif', { mode: 'lossy' })).toEqual([]);
    expect(optimArgs('png', null)).toEqual([]);
  });
});

describe('buildConvertCommand', () => {
  it('orders operations like the CLI: orient, strip, crop, resize, coder opts, quality', () => {
    const { argv, outName } = buildConvertCommand({
      inputName: 'input.png', outFormat: 'jpeg', quality: 80,
      crop: { x: 1, y: 2, w: 30, h: 40 }, resize: { mode: 'percent', percent: 50 },
      optim: { progressive: 'on' },
    });
    expect(outName).toBe('output.jpg');
    expect(argv).toEqual([
      'convert', 'input.png[0]', '-auto-orient', '-strip',
      '-crop', '30x40+1+2', '+repage', '-resize', '50%',
      '-interlace', 'Plane', '-quality', '80', 'output.jpg',
    ]);
  });
  it('never passes -quality to PNG (it would override compression level/filter)', () => {
    const { argv } = buildConvertCommand({ inputName: 'a.jpg', outFormat: 'png', quality: 90 });
    expect(argv).not.toContain('-quality');
  });
  it('keeps all frames for multi-frame capable outputs', () => {
    expect(buildConvertCommand({ inputName: 'a.gif', outFormat: 'gif' }).argv[1]).toBe('a.gif');
    expect(buildConvertCommand({ inputName: 'a.gif', outFormat: 'tiff' }).argv[1]).toBe('a.gif');
    expect(buildConvertCommand({ inputName: 'a.gif', outFormat: 'png' }).argv[1]).toBe('a.gif[0]');
  });
  it('clamps quality to 100', () => {
    expect(buildConvertCommand({ inputName: 'a', outFormat: 'webp', quality: 150 }).argv).toContain('100');
  });
});
