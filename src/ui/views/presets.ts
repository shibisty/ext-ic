import { h, field, select } from '../dom';
import { openModal } from './modal';
import { renderOptimFields } from './optim-fields';
import { renderResizeFields } from './resize-fields';
import { formatOptions, qualityOptions } from './queue';
import { OPTIM_DEFAULTS, optimFormatKey } from '../../core/optim';
import { newPresetId, summarizePreset, type Preset } from '../../core/presets';
import type { ResizeMode } from '../../core/settings';
import type { ViewContext } from '../context';

export function renderPresetsList(container: HTMLElement, ctx: ViewContext): void {
  const { t, s } = ctx;
  container.replaceChildren();
  if (!s.presets.length) {
    container.appendChild(h('div', { className: 'queue-empty', textContent: t('noPresets') }));
    return;
  }
  for (const p of s.presets) {
    container.appendChild(h('div', { className: 'preset-item', dataset: { id: p.id } },
      h('div', { className: 'preset-item__info' },
        h('div', { className: 'preset-item__name' }, h('span', { className: 'preset-item__format', textContent: p.format }), p.name),
        h('div', { className: 'preset-item__meta', textContent: summarizePreset(p, t) })),
      h('div', { className: 'preset-item__actions' },
        h('button', { className: 'icon-btn', type: 'button', title: t('editPreset'), textContent: '✎', on: { click: () => ctx.editPreset(p) } }),
        h('button', { className: 'icon-btn', type: 'button', title: t('deletePreset'), textContent: '✕', on: { click: () => ctx.deletePreset(p) } })),
    ));
  }
}

/** Modal editor; resolves via onSave(preset). */
export function openPresetEditor(existing: Preset | null, ctx: ViewContext, onSave: (p: Preset) => void): void {
  const { t, s } = ctx;
  const key0 = optimFormatKey(s.format);
  const draft: Preset = existing
    ? structuredClone(existing)
    : {
      id: newPresetId(s.presets),
      name: '',
      format: s.format,
      quality: s.quality,
      resizeMode: 'none',
      resizeW: '',
      resizeH: '',
      optim: key0 ? structuredClone(s.optim[key0]) : null,
    };

  const m = openModal(existing ? t('editPreset') : t('newPreset').replace(/^\+\s*/, ''), 'settings-modal');
  const fields = h('div', { className: 'preset-editor-fields' });
  m.modal.appendChild(fields);

  const name = h('input', { type: 'text', name: 'presetName', placeholder: t('presetNamePlaceholder'), value: draft.name });
  name.addEventListener('input', () => { draft.name = name.value; });
  fields.appendChild(field(t('presetName'), name));

  let optimWrap: HTMLElement | null = null;
  const rebuildOptim = () => {
    optimWrap?.remove();
    const key = optimFormatKey(draft.format);
    if (!key) { draft.optim = null; optimWrap = null; return; }
    draft.optim ??= structuredClone(OPTIM_DEFAULTS[key]);
    optimWrap = renderOptimFields(fields, draft.format, draft.optim, t, (v) => { draft.optim = v; }, ctx.hiddenOptimFields(draft.format));
  };

  const fmt = select(formatOptions(ctx, false, draft.format), draft.format, (v) => {
    if (optimFormatKey(v) !== optimFormatKey(draft.format)) draft.optim = null;
    draft.format = v;
    rebuildOptim();
  });
  fmt.name = 'presetFormat';
  const quality = select(qualityOptions(ctx, draft.quality, false), String(draft.quality), (v) => { draft.quality = Number(v); });
  const resize = renderResizeFields({ mode: draft.resizeMode, w: draft.resizeW, h: draft.resizeH }, t, false, (r) => {
    draft.resizeMode = r.mode as ResizeMode; draft.resizeW = r.w; draft.resizeH = r.h;
  });
  fields.appendChild(h('div', { className: 'controls-grid' }, field(t('presetFormat'), fmt), field(t('quality'), quality), ...resize));
  rebuildOptim();

  m.modal.appendChild(h('div', { className: 'crop-actions' },
    h('button', { className: 'btn btn-ghost', type: 'button', textContent: t('cancel'), on: { click: () => m.close() } }),
    h('button', {
      className: 'btn btn-primary',
      type: 'button',
      textContent: t('save'),
      dataset: { role: 'preset-save' },
      on: {
        click: () => {
          draft.name = draft.name.trim() || `${draft.format.toUpperCase()} ${new Date().toLocaleDateString()}`;
          m.close();
          onSave(draft);
        },
      },
    }),
  ));
  name.focus();
}
