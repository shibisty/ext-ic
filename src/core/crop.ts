/** Pure geometry for the crop editor (display-pixel space ↔ image pixels). */
import type { CropRect } from './command';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export type DragMode = 'new' | 'move' | `resize-${Corner}`;

export const MIN_DISPLAY_SIZE = 4;

export function clampRect(r: Rect, maxW: number, maxH: number): Rect {
  if (!maxW || !maxH) return r;
  const x = Math.max(0, Math.min(r.x, maxW - 1));
  const y = Math.max(0, Math.min(r.y, maxH - 1));
  return {
    x,
    y,
    w: Math.max(MIN_DISPLAY_SIZE, Math.min(r.w, maxW - x)),
    h: Math.max(MIN_DISPLAY_SIZE, Math.min(r.h, maxH - y)),
  };
}

/** Moving keeps the size and slides the box back inside the stage. */
export function clampMove(r: Rect, maxW: number, maxH: number): Rect {
  const w = Math.min(r.w, maxW);
  const h = Math.min(r.h, maxH);
  return { x: Math.max(0, Math.min(r.x, maxW - w)), y: Math.max(0, Math.min(r.y, maxH - h)), w, h };
}

export function dragRect(mode: DragMode, start: Point, startRect: Rect, p: Point): Rect {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  if (mode === 'new') {
    return { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(dx), h: Math.abs(dy) };
  }
  if (mode === 'move') return { ...startRect, x: startRect.x + dx, y: startRect.y + dy };
  const corner = mode.slice(7) as Corner;
  let { x, y, w, h } = startRect;
  if (corner.includes('e')) w = startRect.w + dx;
  if (corner.includes('s')) h = startRect.h + dy;
  if (corner.includes('w')) { x = startRect.x + dx; w = startRect.w - dx; }
  if (corner.includes('n')) { y = startRect.y + dy; h = startRect.h - dy; }
  // Dragging a handle past the opposite edge flips instead of going negative.
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w, h };
}

export function toNatural(r: Rect, scale: number): CropRect {
  return { x: Math.round(r.x / scale), y: Math.round(r.y / scale), w: Math.round(r.w / scale), h: Math.round(r.h / scale) };
}

export function fromNatural(c: Partial<CropRect>, scale: number, displayW: number, displayH: number): Rect {
  return {
    x: (c.x || 0) * scale,
    y: (c.y || 0) * scale,
    w: c.w ? c.w * scale : displayW,
    h: c.h ? c.h * scale : displayH,
  };
}

/** Normalizes user-entered numbers and keeps the crop inside the image when its size is known. */
export function normalizeCrop(c: Partial<CropRect>, naturalW?: number | null, naturalH?: number | null): CropRect {
  let x = Math.max(0, Math.round(Number(c.x) || 0));
  let y = Math.max(0, Math.round(Number(c.y) || 0));
  let w = Math.max(1, Math.round(Number(c.w) || 0));
  let h = Math.max(1, Math.round(Number(c.h) || 0));
  if (naturalW && naturalH) {
    x = Math.min(x, naturalW - 1);
    y = Math.min(y, naturalH - 1);
    w = Math.min(w, naturalW - x);
    h = Math.min(h, naturalH - y);
  }
  return { x, y, w, h };
}

export function fitDisplay(naturalW: number, naturalH: number, maxW: number): { w: number; h: number; scale: number } {
  const w = Math.min(maxW, naturalW);
  const scale = w / naturalW;
  return { w, h: naturalH * scale, scale };
}
