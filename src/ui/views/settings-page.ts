import { h, field, select } from '../dom';
import { optimFormatKey } from '../../core/optim';
import { sanitizeFolder } from '../../core/filenames';
import { renderOptimFields } from './optim-fields';
import { renderResizeFields } from './resize-fields';
import { qualityOptions } from './queue';
import type { ViewContext } from '../context';
import type { Lang, Theme, ResizeMode } from '../../core/settings';

function section(title: string, ...children: (Node | false)[]): HTMLElement {
  return h('div', { className: 'settings-section' }, h('div', { className: 'settings-section__title', textContent: title }), ...children);
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, name: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, name, on: { change: () => onChange(input.checked) } });
  return h('label', { className: 'settings-checkbox' }, input, label);
}

export function renderSettingsPage(body: HTMLElement, ctx: ViewContext): void {
  const { t, s } = ctx;
  body.replaceChildren();

  const lang = select([['en', 'EN'], ['ru', 'RU']], s.lang, (v) => ctx.updateSettings({ lang: v as Lang }));
  lang.name = 'lang';
  const theme = select([['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]], s.theme,
    (v) => ctx.updateSettings({ theme: v as Theme }));
  theme.name = 'theme';
  body.appendChild(section(t('generalSection'), h('div', { className: 'controls-grid' }, field(t('language'), lang), field(t('theme'), theme))));

  const folder = h('input', { type: 'text', name: 'saveFolder', placeholder: t('saveFolderPlaceholder'), value: s.saveFolder });
  folder.addEventListener('change', () => {
    const clean = sanitizeFolder(folder.value);
    folder.value = clean;
    ctx.updateSettings({ saveFolder: clean });
  });
  body.appendChild(section(t('saveSection'),
    field(t('saveFolder'), folder),
    h('div', { className: 'settings-hint', textContent: t('saveFolderHint') }),
    checkbox(t('askSaveLocation'), s.askSaveLocation, (v) => ctx.updateSettings({ askSaveLocation: v }), 'askSaveLocation'),
    checkbox(t('autoZip'), s.autoZip, (v) => ctx.updateSettings({ autoZip: v }), 'autoZip'),
  ));

  const quality = select(qualityOptions(ctx, s.quality, false), String(s.quality), (v) => ctx.updateSettings({ quality: Number(v) }));
  quality.name = 'quality';
  const resize = renderResizeFields({ mode: s.resize.mode, w: s.resize.w, h: s.resize.h }, t, false, (m) => {
    ctx.updateSettings({ resize: { mode: m.mode as ResizeMode, w: m.w, h: m.h } });
  });
  const conv = section(`${t('conversionSection')} — ${s.format.toUpperCase()}`,
    h('div', { className: 'controls-grid' }, field(t('quality'), quality), ...resize));
  const key = optimFormatKey(s.format);
  if (key) {
    renderOptimFields(conv, s.format, s.optim[key], t, (values) => {
      ctx.updateSettings({ optim: { ...s.optim, [key]: values } });
    }, ctx.hiddenOptimFields(s.format));
  }
  body.appendChild(conv);
}
