type Child = Node | string | null | undefined | false;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style' | 'dataset'>> & {
  style?: Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  on?: { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };
};

/** Tiny hyperscript: h('div', { className: 'x', on: { click } }, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const { style, dataset, on, ...rest } = props;
    Object.assign(el, rest);
    if (style) Object.assign(el.style, style);
    if (dataset) Object.assign(el.dataset, dataset);
    if (on) for (const [type, fn] of Object.entries(on)) el.addEventListener(type, fn as EventListener);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function q<T extends HTMLElement = HTMLElement>(id: string, root: Document = document): T {
  const el = root.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

export function qOpt<T extends HTMLElement = HTMLElement>(id: string, root: Document = document): T | null {
  return root.getElementById(id) as T | null;
}

export type SelectOption = [value: string, text: string, disabled?: boolean];

export function option(value: string, text: string, disabled = false): HTMLOptionElement {
  return h('option', { value, textContent: text, disabled });
}

export function select(options: SelectOption[], value: string, onChange?: (v: string) => void): HTMLSelectElement {
  const s = h('select', null, ...options.map(([v, t, d]) => option(v, t, d)));
  s.value = value;
  if (onChange) s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function field(label: string, ...controls: Child[]): HTMLDivElement {
  return h('div', { className: 'field' }, h('label', { textContent: label }), ...controls);
}
