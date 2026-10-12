import { isOutputFormat, normalizeFormat } from './formats';
import { mergeOptim, optimFormatKey, type OptimByFormat, type OptimValues } from './optim';
import type { CropRect, ResizeSpec } from './command';
import type { Preset } from './presets';
import type { LogEntry } from './log';

export type Lang = 'en' | 'ru';
export type Theme = 'system' | 'light' | 'dark';
export type ResizeMode = 'none' | 'percent' | 'exact';

/** Raw resize inputs as typed in the UI (W holds the percent in percent mode). */
export interface ResizeInput { mode: ResizeMode; w: string; h: string }

export interface Settings {
  lang: Lang;
  theme: Theme;
  format: string;
  quality: number;
  resize: ResizeInput;
  optim: OptimByFormat;
  presets: Preset[];
  activeProfileId: string;
  saveFolder: string;
  askSaveLocation: boolean;
  autoZip: boolean;
  log: LogEntry[];
}

/** Per-image overrides; '' / 'inherit' / null mean "use the defaults". */
export interface ItemOverrides {
  format: string;
  quality: string;
  resizeMode: ResizeMode | 'inherit';
  resizeW: string;
  resizeH: string;
  crop: CropRect | null;
  optim: OptimValues | null;
}

export interface ResolvedSettings {
  format: string;
  quality: number;
  resize: ResizeSpec | null;
  crop: CropRect | null;
  optim: OptimValues | null;
}

export function detectLang(navigatorLanguage: string | undefined): Lang {
  return (navigatorLanguage || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function defaultSettings(navigatorLanguage?: string): Settings {
  return {
    lang: detectLang(navigatorLanguage),
    theme: 'system',
    format: 'png',
    quality: 90,
    resize: { mode: 'none', w: '', h: '' },
    optim: mergeOptim(null),
    presets: [],
    activeProfileId: '',
    saveFolder: '',
    askSaveLocation: false,
    autoZip: false,
    log: [],
  };
}

export function defaultOverrides(): ItemOverrides {
  return { format: '', quality: '', resizeMode: 'inherit', resizeW: '', resizeH: '', crop: null, optim: null };
}

export function hasOverrides(o: ItemOverrides): boolean {
  return !!(o.format || o.quality !== '' || o.resizeMode !== 'inherit' || o.crop || o.optim);
}

export function resizeSpecFrom(mode: string, w: string | number, h: string | number): ResizeSpec | null {
  if (mode === 'percent' && Number(w) > 0) return { mode: 'percent', percent: Number(w) };
  if (mode === 'exact' && (Number(w) > 0 || Number(h) > 0)) {
    return { mode: 'exact', width: Number(w) || 0, height: Number(h) || 0 };
  }
  return null;
}

/** Combines global defaults with an item's overrides into what gets converted. */
export function resolveItemSettings(o: ItemOverrides, s: Pick<Settings, 'format' | 'quality' | 'resize' | 'optim'>): ResolvedSettings {
  const format = normalizeFormat(o.format || s.format);
  const quality = o.quality !== '' && o.quality != null && Number(o.quality) > 0 ? Number(o.quality) : s.quality;
  const resize = o.resizeMode === 'inherit'
    ? resizeSpecFrom(s.resize.mode, s.resize.w, s.resize.h)
    : resizeSpecFrom(o.resizeMode, o.resizeW, o.resizeH);
  const key = optimFormatKey(format);
  const optim = o.optim ?? (key ? s.optim[key] : null);
  return { format, quality, resize, crop: o.crop, optim };
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T; // already an object
  try { return (JSON.parse(v) as T) ?? fallback; } catch { return fallback; }
}

const RESIZE_MODES: ResizeMode[] = ['none', 'percent', 'exact'];

/**
 * Reads the chrome.storage.local record (keys `ic_*`, compatible with v1.0)
 * into a fully-populated Settings object. Never throws.
 */
export function parseStoredSettings(raw: Record<string, unknown>, navigatorLanguage?: string): Settings {
  const s = defaultSettings(navigatorLanguage);
  if (raw.ic_lang === 'en' || raw.ic_lang === 'ru') s.lang = raw.ic_lang;
  if (raw.ic_theme === 'system' || raw.ic_theme === 'light' || raw.ic_theme === 'dark') s.theme = raw.ic_theme;
  if (typeof raw.ic_format === 'string' && isOutputFormat(normalizeFormat(raw.ic_format))) s.format = normalizeFormat(raw.ic_format);
  const q = Number(raw.ic_quality);
  if (Number.isFinite(q) && q > 0 && q <= 100) s.quality = q;
  const r = parseJson<Partial<ResizeInput> | null>(raw.ic_resize, null);
  if (r && RESIZE_MODES.includes(r.mode as ResizeMode)) {
    s.resize = { mode: r.mode as ResizeMode, w: String(r.w ?? ''), h: String(r.h ?? '') };
  }
  s.optim = mergeOptim(parseJson(raw.ic_optim, null));
  const presets = parseJson<unknown>(raw.ic_presets, []);
  s.presets = Array.isArray(presets) ? (presets as Preset[]).filter((p) => p && typeof p.id === 'string') : [];
  if (typeof raw.ic_profile === 'string' && s.presets.some((p) => p.id === raw.ic_profile)) s.activeProfileId = raw.ic_profile;
  if (typeof raw.ic_saveFolder === 'string') s.saveFolder = raw.ic_saveFolder;
  s.askSaveLocation = asBool(raw.ic_askSaveLocation, s.askSaveLocation);
  s.autoZip = asBool(raw.ic_autozip, s.autoZip);
  const log = parseJson<unknown>(raw.ic_log, []);
  s.log = Array.isArray(log) ? (log as LogEntry[]) : [];
  return s;
}

export const STORAGE_KEYS = [
  'ic_lang', 'ic_theme', 'ic_format', 'ic_quality', 'ic_resize', 'ic_optim', 'ic_presets',
  'ic_profile', 'ic_saveFolder', 'ic_askSaveLocation', 'ic_autozip', 'ic_log',
] as const;

type SettingKey = keyof Settings;
const KEY_MAP: Record<SettingKey, (typeof STORAGE_KEYS)[number]> = {
  lang: 'ic_lang',
  theme: 'ic_theme',
  format: 'ic_format',
  quality: 'ic_quality',
  resize: 'ic_resize',
  optim: 'ic_optim',
  presets: 'ic_presets',
  activeProfileId: 'ic_profile',
  saveFolder: 'ic_saveFolder',
  askSaveLocation: 'ic_askSaveLocation',
  autoZip: 'ic_autozip',
  log: 'ic_log',
};

/** JSON-string keys stay strings for backward compatibility with v1.0. */
const JSON_KEYS: ReadonlySet<SettingKey> = new Set(['optim', 'presets', 'log']);

export function toStorageRecord(partial: Partial<Settings>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial) as [SettingKey, unknown][]) {
    out[KEY_MAP[k]] = JSON_KEYS.has(k) ? JSON.stringify(v) : v;
  }
  return out;
}

/** Maps changed storage keys back to Settings fields. */
export function changedSettingKeys(storageKeys: string[]): SettingKey[] {
  const reverse = new Map(Object.entries(KEY_MAP).map(([a, b]) => [b, a as SettingKey]));
  return storageKeys.map((k) => reverse.get(k as (typeof STORAGE_KEYS)[number])).filter((k): k is SettingKey => !!k);
}
