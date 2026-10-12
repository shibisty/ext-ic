import { describe, expect, it } from 'vitest';
import { clampMove, clampRect, dragRect, fitDisplay, fromNatural, normalizeCrop, toNatural } from '../../src/core/crop';

describe('crop geometry', () => {
  it('new selection from any drag direction', () => {
    expect(dragRect('new', { x: 50, y: 40 }, { x: 0, y: 0, w: 0, h: 0 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 20 });
  });

  it('resizing past the opposite edge flips instead of going negative', () => {
    const r = dragRect('resize-se', { x: 100, y: 100 }, { x: 50, y: 50, w: 50, h: 50 }, { x: 20, y: 30 });
    expect(r).toEqual({ x: 20, y: 30, w: 30, h: 20 });
  });

  it('nw handle moves the origin', () => {
    expect(dragRect('resize-nw', { x: 10, y: 10 }, { x: 10, y: 10, w: 100, h: 100 }, { x: 30, y: 25 })).toEqual({ x: 30, y: 25, w: 80, h: 85 });
  });

  it('moving slides the box back in without shrinking it (v1.0 shrank it)', () => {
    expect(clampMove({ x: 290, y: -10, w: 50, h: 40 }, 300, 200)).toEqual({ x: 250, y: 0, w: 50, h: 40 });
  });

  it('clampRect keeps a minimum size inside the stage', () => {
    expect(clampRect({ x: 310, y: 5, w: 1, h: 1 }, 300, 200)).toEqual({ x: 299, y: 5, w: 4, h: 4 });
  });

  it('display ↔ natural pixels', () => {
    const { w, h, scale } = fitDisplay(1280, 960, 320);
    expect([w, h, scale]).toEqual([320, 240, 0.25]);
    expect(toNatural({ x: 10, y: 20, w: 100, h: 50 }, scale)).toEqual({ x: 40, y: 80, w: 400, h: 200 });
    expect(fromNatural({ x: 40, y: 80, w: 400, h: 200 }, scale, w, h)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(fromNatural({}, scale, w, h)).toEqual({ x: 0, y: 0, w: 320, h: 240 });
  });

  it('normalizeCrop clamps typed numbers to the image', () => {
    expect(normalizeCrop({ x: 900, y: -5, w: 500, h: 0 }, 1000, 800)).toEqual({ x: 900, y: 0, w: 100, h: 1 });
    expect(normalizeCrop({ x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});
