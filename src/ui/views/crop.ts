import { h } from '../dom';
import { openModal } from './modal';
import {
  clampMove, clampRect, dragRect, fitDisplay, fromNatural, normalizeCrop, toNatural,
  type Corner, type DragMode, type Point, type Rect,
} from '../../core/crop';
import type { CropRect } from '../../core/command';
import type { Translator } from '../../i18n';
import type { QueueItem } from '../types';

const STAGE_MAX_W = 320;

function ensureNaturalSize(item: QueueItem): Promise<boolean> {
  if (item.naturalWidth) return Promise.resolve(true);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      item.naturalWidth = img.naturalWidth;
      item.naturalHeight = img.naturalHeight;
      resolve(img.naturalWidth > 0);
    };
    img.onerror = () => resolve(false);
    img.src = item.thumbUrl;
  });
}

interface Stage {
  wrap: HTMLDivElement;
  setFromNatural(c: Partial<CropRect>): void;
  onChange(fn: (c: CropRect) => void): void;
}

function buildStage(item: QueueItem): Stage {
  const nw = item.naturalWidth!;
  const nh = item.naturalHeight!;
  const { w: dw, h: dh, scale } = fitDisplay(nw, nh, STAGE_MAX_W);
  const img = h('img', { src: item.thumbUrl, draggable: false, style: { width: `${dw}px`, height: `${dh}px` } });
  const rectEl = h('div', { className: 'crop-rect' },
    ...(['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => h('div', { className: `crop-handle crop-handle--${c}`, dataset: { corner: c } })));
  const wrap = h('div', { className: 'crop-stage', style: { width: `${dw}px`, height: `${dh}px` } }, img, rectEl);

  let rect: Rect = { x: 0, y: 0, w: dw, h: dh };
  let listener: ((c: CropRect) => void) | null = null;
  let mode: DragMode | null = null;
  let start: Point = { x: 0, y: 0 };
  let startRect: Rect = rect;

  const paint = () => {
    Object.assign(rectEl.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  };
  const pos = (e: PointerEvent): Point => {
    const b = wrap.getBoundingClientRect();
    return { x: Math.max(0, Math.min(dw, e.clientX - b.left)), y: Math.max(0, Math.min(dh, e.clientY - b.top)) };
  };
  const begin = (e: PointerEvent, m: DragMode) => {
    mode = m;
    start = pos(e);
    startRect = m === 'new' ? { ...start, w: 0, h: 0 } : { ...rect };
    wrap.setPointerCapture?.(e.pointerId);
  };

  wrap.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const corner = target.dataset.corner as Corner | undefined;
    if (corner) begin(e, `resize-${corner}`);
    else begin(e, target === rectEl ? 'move' : 'new');
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const next = dragRect(mode, start, startRect, pos(e));
    rect = mode === 'move' ? clampMove(next, dw, dh) : clampRect(next, dw, dh);
    paint();
  });
  const end = () => {
    if (!mode) return;
    mode = null;
    listener?.(normalizeCrop(toNatural(rect, scale), nw, nh));
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  paint();

  return {
    wrap,
    setFromNatural(c) { rect = clampRect(fromNatural(c, scale, dw, dh), dw, dh); paint(); },
    onChange(fn) { listener = fn; },
  };
}

/** Crop editor; calls onApply(rect) or onApply(null) for "Reset". */
export async function openCropModal(item: QueueItem, t: Translator, onApply: (crop: CropRect | null) => void): Promise<void> {
  const hasPreview = await ensureNaturalSize(item);
  const m = openModal(t('cropTitle'));
  const stage = hasPreview ? buildStage(item) : null;
  m.modal.appendChild(stage ? stage.wrap : h('div', { className: 'crop-modal__note', textContent: t('cropNoPreview') }));

  const num = (label: string) => {
    const input = h('input', { type: 'number', min: '0' });
    input.dataset.crop = label.toLowerCase();
    return { input, el: h('div', { className: 'crop-field' }, h('label', { textContent: label }), input) };
  };
  const fx = num('X'); const fy = num('Y'); const fw = num('W'); const fh = num('H');
  m.modal.appendChild(h('div', { className: 'crop-fields' }, fx.el, fy.el, fw.el, fh.el));

  const initial: CropRect = item.overrides.crop
    ?? (hasPreview ? { x: 0, y: 0, w: item.naturalWidth!, h: item.naturalHeight! } : { x: 0, y: 0, w: 0, h: 0 });
  const fill = (c: CropRect) => { fx.input.value = String(c.x); fy.input.value = String(c.y); fw.input.value = String(c.w); fh.input.value = String(c.h); };
  const read = (): CropRect => normalizeCrop(
    { x: Number(fx.input.value), y: Number(fy.input.value), w: Number(fw.input.value), h: Number(fh.input.value) },
    item.naturalWidth, item.naturalHeight,
  );
  fill(initial);
  if (stage) {
    stage.setFromNatural(initial);
    stage.onChange(fill);
    for (const f of [fx, fy, fw, fh]) f.input.addEventListener('input', () => stage.setFromNatural(read()));
  }

  m.modal.appendChild(h('div', { className: 'crop-actions' },
    h('button', { className: 'btn btn-ghost', textContent: t('cropReset'), on: { click: () => { m.close(); onApply(null); } } }),
    h('button', { className: 'btn btn-ghost', textContent: t('cropCancel'), on: { click: () => m.close() } }),
    h('button', { className: 'btn btn-primary', textContent: t('cropApply'), on: { click: () => { m.close(); onApply(read()); } } }),
  ));
}
