import { normalizeFormat } from './formats';
import type { OptimValues } from './optim';

export interface PercentResize { mode: 'percent'; percent: number }
export interface ExactResize { mode: 'exact'; width: number; height: number }
export type ResizeSpec = PercentResize | ExactResize;

export interface CropRect { x: number; y: number; w: number; h: number }

export interface ConvertOptions {
  inputName: string;
  outFormat: string;
  quality?: number | null;
  resize?: ResizeSpec | null;
  crop?: CropRect | null;
  optim?: OptimValues | null;
}

export interface ConvertCommand {
  argv: string[];
  outName: string;
}

/**
 * -quality only means "compression quality" for these. For PNG the tens
 * digit is the zlib level and the units digit the filter type, so e.g.
 * `-quality 90` silently forces filter 0 and overrides png:compression-level.
 * TIFF is similarly overloaded. Everyone else is driven by optimArgs().
 */
export const QUALITY_APPLICABLE_FORMATS: ReadonlySet<string> = new Set([
  'jpg', 'webp', 'heic', 'heif', 'avif', 'jp2', 'jxl',
]);

const posInt = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export function resizeGeometry(resize: ResizeSpec | null | undefined): string | null {
  if (!resize) return null;
  if (resize.mode === 'percent') {
    const p = Number(resize.percent);
    return Number.isFinite(p) && p > 0 ? `${p}%` : null;
  }
  const w = posInt(resize.width);
  const h = posInt(resize.height);
  if (!w && !h) return null;
  return `${w || ''}x${h || ''}`;
}

export function cropGeometry(crop: CropRect | null | undefined): string | null {
  if (!crop) return null;
  const w = posInt(crop.w);
  const h = posInt(crop.h);
  if (!w || !h) return null;
  const x = Math.max(0, Math.round(Number(crop.x) || 0));
  const y = Math.max(0, Math.round(Number(crop.y) || 0));
  return `${w}x${h}+${x}+${y}`;
}

export function optimArgs(format: string, optim: OptimValues | null | undefined): string[] {
  if (!optim) return [];
  const args: string[] = [];
  const fmt = normalizeFormat(format);
  const has = (v: unknown) => v !== undefined && v !== null && v !== '';

  if (fmt === 'png') {
    if (has(optim.level)) args.push('-define', `png:compression-level=${optim.level}`);
    if (optim.mode === 'lossy') {
      // FloydSteinberg gives much cleaner quantized PNGs than the default.
      if (optim.dither === 'off') args.push('+dither');
      else args.push('-dither', 'FloydSteinberg');
      if (has(optim.colors)) args.push('-colors', String(optim.colors));
    }
  } else if (fmt === 'jpg') {
    if (optim.progressive === 'on') args.push('-interlace', 'Plane');
    else if (optim.progressive === 'off') args.push('-interlace', 'none');
    if (has(optim.subsampling)) args.push('-sampling-factor', String(optim.subsampling));
    if (has(optim.optimizeCoding)) {
      args.push('-define', `jpeg:optimize-coding=${optim.optimizeCoding === 'on' ? 'true' : 'false'}`);
    }
  } else if (fmt === 'webp') {
    if (has(optim.lossless)) args.push('-define', `webp:lossless=${optim.lossless === 'on' ? 'true' : 'false'}`);
    if (has(optim.method)) args.push('-define', `webp:method=${optim.method}`);
  }
  return args;
}

/**
 * Builds the ImageMagick argv. Order matters and matches CLI conventions:
 * auto-orient (bake EXIF rotation into pixels BEFORE stripping the tag) →
 * strip metadata → crop (+repage) → resize → coder options → quality.
 * For multi-frame inputs (GIF, PDF…) going to single-frame formats we keep
 * only the first frame, so the result is one file instead of out-0/out-1….
 * (WebP/AVIF/GIF/TIFF/PDF/ICO keep all frames.)
 */
export function buildConvertCommand(opts: ConvertOptions): ConvertCommand {
  const fmt = normalizeFormat(opts.outFormat);
  const outName = `output.${fmt}`;
  const input = SINGLE_FRAME_OUTPUTS.has(fmt) ? `${opts.inputName}[0]` : opts.inputName;
  const argv = ['convert', input, '-auto-orient', '-strip'];

  const crop = cropGeometry(opts.crop);
  if (crop) argv.push('-crop', crop, '+repage');
  const geometry = resizeGeometry(opts.resize);
  if (geometry) argv.push('-resize', geometry);
  argv.push(...optimArgs(fmt, opts.optim));
  const q = Number(opts.quality);
  if (Number.isFinite(q) && q > 0 && QUALITY_APPLICABLE_FORMATS.has(fmt)) {
    argv.push('-quality', String(Math.min(100, Math.round(q))));
  }
  argv.push(outName);
  return { argv, outName };
}

/** Formats that can't hold several frames/pages. */
export const SINGLE_FRAME_OUTPUTS: ReadonlySet<string> = new Set([
  'jpg', 'png', 'bmp', 'dib', 'heic', 'heif', 'jxl', 'jp2',
  'tga', 'pcx', 'ppm', 'pgm', 'pbm', 'pnm', 'xbm', 'xpm', 'wbmp', 'otb',
  'palm', 'sgi', 'exr', 'hdr', 'dpx', 'cin', 'fits', 'svg', 'xwd',
]);
