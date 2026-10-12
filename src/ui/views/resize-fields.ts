import { h, field, select } from '../dom';
import type { Translator } from '../../i18n';

export interface ResizeModel { mode: string; w: string; h: string }

/**
 * "Resize" select + W/H (or %) inputs. `withInherit` adds "Use default".
 * onChange fires on select change and on input commit (change event).
 */
export function renderResizeFields(model: ResizeModel, t: Translator, withInherit: boolean, onChange: (m: ResizeModel) => void): HTMLElement[] {
  const modes: [string, string][] = [
    ...(withInherit ? [['inherit', t('useDefault')] as [string, string]] : []),
    ['none', t('resizeNone')],
    ['percent', '%'],
    ['exact', 'W × H'],
  ];
  const w = h('input', { type: 'number', min: '1' });
  const hh = h('input', { type: 'number', min: '1' });
  w.dataset.resize = 'w';
  hh.dataset.resize = 'h';

  const sync = () => {
    w.style.display = model.mode === 'percent' || model.mode === 'exact' ? '' : 'none';
    hh.style.display = model.mode === 'exact' ? '' : 'none';
    w.placeholder = model.mode === 'percent' ? t('percentLabel') : t('widthPlaceholder');
    hh.placeholder = t('heightPlaceholder');
    w.value = model.w;
    hh.value = model.h;
  };
  const modeSelect = select(modes, model.mode, (v) => { model.mode = v; sync(); onChange({ ...model }); });
  modeSelect.dataset.resize = 'mode';
  w.addEventListener('input', () => { model.w = w.value; });
  hh.addEventListener('input', () => { model.h = hh.value; });
  w.addEventListener('change', () => onChange({ ...model }));
  hh.addEventListener('change', () => onChange({ ...model }));
  sync();

  return [field(t('resize'), modeSelect), field(' ', h('div', { className: 'field-row' }, w, hh))];
}
