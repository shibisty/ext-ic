/**
 * Per-format optimization settings (shown as dropdowns) and their defaults.
 * They map to ImageMagick coder options — see command.ts → optimArgs().
 */
export type OptimFormat = 'png' | 'jpg' | 'webp';
export type OnOff = 'on' | 'off';

export interface PngOptim { mode: 'lossless' | 'lossy'; level: string; colors: string; dither: OnOff }
export interface JpgOptim { progressive: OnOff; subsampling: '4:4:4' | '4:2:2' | '4:2:0'; optimizeCoding: OnOff }
export interface WebpOptim { lossless: OnOff; method: string }

export type OptimValues = Partial<PngOptim & JpgOptim & WebpOptim> & Record<string, string | undefined>;
export type OptimByFormat = Record<OptimFormat, OptimValues>;

/**
 * PNG defaults to "lossy" (quantized, ≤256 colors), like TinyPNG — this is
 * what gets sizes into the same ballpark. True lossless stays available.
 */
export const OPTIM_DEFAULTS: Readonly<OptimByFormat> = Object.freeze({
  png: { mode: 'lossy', level: '9', colors: '256', dither: 'on' },
  jpg: { progressive: 'on', subsampling: '4:2:0', optimizeCoding: 'on' },
  webp: { lossless: 'off', method: '6' },
});

export interface OptimOption { value: string; key?: string; literal?: string }
export interface OptimField {
  key: string;
  labelKey: string;
  options: OptimOption[];
  dependsOn?: { key: string; value: string };
}

const lit = (values: string[]): OptimOption[] => values.map((v) => ({ value: v, literal: v }));
const onOff: OptimOption[] = [{ value: 'on', key: 'onLabel' }, { value: 'off', key: 'offLabel' }];

export const OPTIM_FIELDS: Readonly<Record<OptimFormat, OptimField[]>> = {
  png: [
    { key: 'mode', labelKey: 'pngMode', options: [{ value: 'lossless', key: 'pngModeLossless' }, { value: 'lossy', key: 'pngModeLossy' }] },
    { key: 'level', labelKey: 'pngLevel', options: lit(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) },
    { key: 'colors', labelKey: 'pngColors', options: lit(['256', '128', '64', '32', '16', '8']), dependsOn: { key: 'mode', value: 'lossy' } },
    { key: 'dither', labelKey: 'pngDither', options: onOff, dependsOn: { key: 'mode', value: 'lossy' } },
  ],
  jpg: [
    { key: 'progressive', labelKey: 'jpgProgressive', options: onOff },
    { key: 'subsampling', labelKey: 'jpgSubsampling', options: lit(['4:4:4', '4:2:2', '4:2:0']) },
    { key: 'optimizeCoding', labelKey: 'jpgOptimizeCoding', options: onOff },
  ],
  webp: [
    { key: 'lossless', labelKey: 'webpLossless', options: [{ value: 'off', key: 'offLabel' }, { value: 'on', key: 'onLabel' }] },
    { key: 'method', labelKey: 'webpMethod', options: lit(['0', '1', '2', '3', '4', '5', '6']) },
  ],
};

export function optimFormatKey(format: string): OptimFormat | null {
  const f = format === 'jpeg' ? 'jpg' : format;
  return f === 'png' || f === 'jpg' || f === 'webp' ? f : null;
}

export function cloneOptimDefaults(): OptimByFormat {
  return structuredClone(OPTIM_DEFAULTS) as OptimByFormat;
}

/** Merges stored values over defaults, ignoring unknown formats/garbage. */
export function mergeOptim(stored: unknown): OptimByFormat {
  const out = cloneOptimDefaults();
  if (!stored || typeof stored !== 'object') return out;
  for (const key of Object.keys(out) as OptimFormat[]) {
    const v = (stored as Record<string, unknown>)[key];
    if (v && typeof v === 'object') out[key] = { ...out[key], ...(v as OptimValues) };
  }
  return out;
}
