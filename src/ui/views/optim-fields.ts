import { h, field, select } from '../dom';
import { OPTIM_DEFAULTS, OPTIM_FIELDS, optimFormatKey, type OptimValues } from '../../core/optim';
import type { Translator } from '../../i18n';

/** Dropdowns for the format's optimization options; hides dependent fields. */
export function renderOptimFields(
  container: HTMLElement,
  format: string,
  current: OptimValues | null | undefined,
  t: Translator,
  onChange: (values: OptimValues) => void,
  hidden: readonly string[] = [],
): HTMLElement | null {
  const key = optimFormatKey(format);
  if (!key) return null;
  const values: OptimValues = { ...OPTIM_DEFAULTS[key], ...(current ?? {}) };
  const grid = h('div', { className: 'controls-grid' });
  const wrap = h('div', { className: 'optim-section' }, h('div', { className: 'optim-section__title', textContent: t('optimizationSection') }), grid);
  const fieldEls: Record<string, HTMLElement> = {};

  const refresh = () => {
    for (const f of fields) {
      if (f.dependsOn) fieldEls[f.key]!.style.display = values[f.dependsOn.key] === f.dependsOn.value ? '' : 'none';
    }
  };

  const fields = OPTIM_FIELDS[key].filter((f) => !hidden.includes(f.key));
  if (!fields.length) return null;
  for (const f of fields) {
    const opts = f.options.map((o): [string, string] => [o.value, o.literal ?? t(o.key ?? o.value)]);
    const s = select(opts, String(values[f.key] ?? ''), (v) => {
      values[f.key] = v;
      refresh();
      onChange({ ...values });
    });
    s.dataset.optim = f.key;
    fieldEls[f.key] = field(t(f.labelKey), s);
    grid.appendChild(fieldEls[f.key]!);
  }
  refresh();
  container.appendChild(wrap);
  return wrap;
}
