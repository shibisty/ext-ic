import { MESSAGES, type MessageKey } from './messages';
import type { Lang } from '../core/settings';

export type { MessageKey };
export type Translator = (key: MessageKey | string, ...args: unknown[]) => string;

export function t(lang: Lang, key: MessageKey | string, ...args: unknown[]): string {
  const dict = (MESSAGES[lang] ?? MESSAGES.en) as Record<string, unknown>;
  const val = dict[key] ?? (MESSAGES.en as Record<string, unknown>)[key] ?? key;
  return typeof val === 'function' ? String((val as (...a: unknown[]) => unknown)(...args)) : String(val);
}

export function translator(lang: Lang): Translator {
  return (key, ...args) => t(lang, key, ...args);
}

export function applyStaticI18n(root: ParentNode, lang: Lang): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(lang, el.dataset.i18nTitle!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(lang, el.dataset.i18nPlaceholder!));
  });
}
