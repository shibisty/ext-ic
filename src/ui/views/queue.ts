import { h, field, select, type SelectOption } from '../dom';
import { OUTPUT_FORMATS, QUALITY_OPTIONS } from '../../core/formats';
import { optimFormatKey, OPTIM_DEFAULTS } from '../../core/optim';
import { hasOverrides } from '../../core/settings';
import { formatBytes, formatSizeDelta } from '../../core/log';
import { renderOptimFields } from './optim-fields';
import { renderResizeFields } from './resize-fields';
import { openCropModal } from './crop';
import type { ViewContext } from '../context';
import type { QueueItem } from '../types';

const STATUS_KEY = { queued: 'statusQueued', converting: 'statusConverting', done: 'statusDone', error: 'statusError' } as const;

/**
 * Formats the engine can produce. A currently-selected format the engine
 * can't produce (e.g. AVIF saved by v1.0) stays visible but disabled.
 */
export function formatOptions(ctx: ViewContext, withInherit: boolean, current = ''): SelectOption[] {
  const available = ctx.availableFormats ?? OUTPUT_FORMATS;
  const list: SelectOption[] = available.map((f) => [f, f.toUpperCase()]);
  for (const cur of new Set([current, ctx.s.format])) {
    if (cur && !available.includes(cur)) list.unshift([cur, `${cur.toUpperCase()} — ${ctx.t('formatUnavailable')}`, true]);
  }
  return withInherit ? [['', `${ctx.t('useDefault')} (${ctx.s.format.toUpperCase()})`], ...list] : list;
}

export function qualityOptions(ctx: ViewContext, current: string | number, withInherit: boolean): [string, string][] {
  const values = QUALITY_OPTIONS.slice();
  const cur = String(current);
  if (cur && !values.includes(cur)) values.unshift(cur);
  const list = values.map((v): [string, string] => [v, `${v}%`]);
  return withInherit ? [['', `${ctx.t('useDefault')} (${ctx.s.quality})`], ...list] : list;
}

export function profileOptions(ctx: ViewContext): [string, string][] {
  return [['', ctx.t('defaultSettingsOption')], ...ctx.s.presets.map((p): [string, string] => [p.id, `${p.name} (${p.format.toUpperCase()})`])];
}

function iconBtn(text: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { className: `icon-btn ${cls}`.trim(), type: 'button', textContent: text, title, ariaLabel: title, on: { click: onClick } });
}

function renderHeader(item: QueueItem, ctx: ViewContext): HTMLElement {
  const { t } = ctx;
  const thumb = h('img', { className: 'queue-item__thumb', src: item.thumbUrl, alt: '' });
  thumb.onerror = () => { thumb.style.visibility = 'hidden'; };

  const nameRow = h('div', { className: 'queue-item__name-row' },
    h('div', { className: 'queue-item__name', title: item.name, textContent: item.name }),
    hasOverrides(item.overrides) && h('span', { className: 'custom-dot', title: t('customBadgeTitle') }));

  const size = item.status === 'done'
    ? h('span', null, `${formatBytes(item.sizeBytes)} → ${formatBytes(item.resultSize)} `,
      h('span', { className: 'size-delta', title: t('sizeChangeTitle'), textContent: formatSizeDelta(item.sizeBytes, item.resultSize) }))
    : h('span', { textContent: formatBytes(item.sizeBytes) });

  const info = h('div', { className: 'queue-item__info' },
    nameRow,
    h('div', { className: 'queue-item__meta' }, h('span', { className: `badge ${item.status}`, textContent: t(STATUS_KEY[item.status]) }), size),
    item.status === 'converting' && h('div', { className: 'progress-track' }, h('div', { className: 'progress-fill is-indeterminate' })),
    item.status === 'error' && !!item.error && h('div', { className: 'queue-item__meta queue-item__error', textContent: item.error }),
  );

  const actions = h('div', { className: 'queue-item__actions' },
    item.status === 'done' && iconBtn('⬇', t('download'), () => ctx.download(item)),
    item.status === 'error' && iconBtn('↻', t('retry'), () => ctx.convertOne(item)),
    iconBtn(item.expanded ? '▾' : '▸', t('perImageSettings'), () => ctx.toggleExpanded(item)),
    iconBtn('✕', t('remove'), () => ctx.remove(item)),
  );

  return h('div', { className: 'queue-item', dataset: { id: item.id } }, thumb, info, actions);
}

function renderPanel(item: QueueItem, ctx: ViewContext): HTMLElement {
  const { t, s } = ctx;
  const o = item.overrides;
  const resolvedFormat = o.format || s.format;

  const fmt = select(formatOptions(ctx, true, o.format), o.format, (v) => ctx.updateOverrides(item, { format: v }, true));
  fmt.dataset.role = 'item-format';

  const profile = select(profileOptions(ctx), '', (id) => {
    const p = s.presets.find((x) => x.id === id);
    if (!p) return;
    ctx.updateOverrides(item, {
      format: p.format,
      quality: String(p.quality),
      resizeMode: p.resizeMode,
      resizeW: p.resizeW,
      resizeH: p.resizeH,
      optim: p.optim ? structuredClone(p.optim) : null,
    }, true);
  });

  const quality = select(qualityOptions(ctx, o.quality, true), o.quality, (v) => ctx.updateOverrides(item, { quality: v }, true));
  quality.dataset.role = 'item-quality';

  const resize = renderResizeFields({ mode: o.resizeMode, w: o.resizeW, h: o.resizeH }, t, true, (m) => {
    ctx.updateOverrides(item, { resizeMode: m.mode as typeof o.resizeMode, resizeW: m.w, resizeH: m.h });
  });

  const panel = h('div', { className: 'queue-item-panel' },
    h('div', { className: 'queue-item-panel__title', textContent: t('perImageSettings') }),
    h('div', { className: 'controls-grid' },
      field(t('outputFormat'), fmt),
      field(t('profileLabel'), profile),
      field(t('quality'), quality),
      ...resize));

  const key = optimFormatKey(resolvedFormat);
  if (key) {
    renderOptimFields(panel, resolvedFormat, o.optim ?? s.optim[key] ?? OPTIM_DEFAULTS[key], t, (values) => {
      ctx.updateOverrides(item, { optim: values });
    }, ctx.hiddenOptimFields(resolvedFormat));
  }

  const crop = o.crop;
  panel.appendChild(h('div', { className: 'crop-row' },
    h('div', { className: 'crop-row__label', textContent: `${t('cropLabel')}:` }),
    h('div', { className: 'crop-row__status', textContent: crop ? `${crop.w}×${crop.h} @ (${crop.x}, ${crop.y})` : t('cropNotSet') }),
    h('button', { className: 'btn btn-ghost', type: 'button', textContent: t('cropButton'), on: { click: () => void openCropModal(item, t, (c) => ctx.setCrop(item, c)) } }),
    !!crop && iconBtn('✕', t('cropClear'), () => ctx.setCrop(item, null)),
  ));

  panel.appendChild(h('button', {
    className: 'btn btn-primary queue-item-panel__convert',
    type: 'button',
    textContent: `▶ ${t('convertNow')}`,
    disabled: item.status === 'converting',
    on: { click: () => ctx.convertOne(item) },
  }));
  return panel;
}

export function renderQueue(container: HTMLElement, queue: readonly QueueItem[], ctx: ViewContext): void {
  container.replaceChildren();
  if (!queue.length) {
    container.appendChild(h('div', { className: 'queue-empty', textContent: ctx.t('emptyQueue') }));
    return;
  }
  for (const item of queue) {
    container.appendChild(h('div', { className: 'queue-item-wrap' }, renderHeader(item, ctx), item.expanded && renderPanel(item, ctx)));
  }
}
