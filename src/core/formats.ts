/**
 * Output formats offered in the UI. Actual support depends on which coders
 * the bundled magick.wasm was compiled with — an unsupported one just fails
 * that item with ImageMagick's own error message.
 */
export const OUTPUT_FORMATS = [
  'avif', 'bmp', 'cin', 'cur', 'dds', 'dib', 'dpx', 'eps', 'exr', 'fits',
  'gif', 'hdr', 'heic', 'heif', 'ico', 'jp2', 'jpg', 'jxl', 'miff', 'mng',
  'otb', 'palm', 'pbm', 'pcx', 'pdf', 'pgm', 'png', 'pnm', 'ppm', 'ps',
  'psd', 'rgb', 'rgba', 'sgi', 'svg', 'tga', 'tiff', 'wbmp', 'webp',
  'xbm', 'xpm', 'xwd', 'yuv',
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Extensions browsers often hand us with an empty or odd MIME type
 * (HEIC on Windows, DDS, TGA, PSD…). Accepted by extension as a fallback.
 */
export const EXTRA_INPUT_EXTENSIONS = [
  'dds', 'tga', 'psd', 'exr', 'hdr', 'dpx', 'jxl', 'jp2', 'miff',
  'heic', 'heif', 'avif', 'ico', 'cur', 'tif', 'tiff', 'pcx', 'xcf',
  'pbm', 'pgm', 'ppm', 'pnm', 'sgi', 'fits', 'webp', 'bmp',
];

export const QUALITY_OPTIONS = ['100', '95', '90', '85', '80', '75', '70', '65', '60', '50', '40', '30', '20'];

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  eps: 'application/postscript',
  ps: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  jxl: 'image/jxl',
  jp2: 'image/jp2',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && (OUTPUT_FORMATS as readonly string[]).includes(value);
}

/** 'jpeg' → 'jpg'; everything else lower-cased. */
export function normalizeFormat(format: string): string {
  const f = format.trim().toLowerCase();
  if (f === 'jpeg') return 'jpg';
  if (f === 'tif') return 'tiff';
  return f;
}

export function mimeFor(format: string): string {
  const f = normalizeFormat(format);
  return MIME[f] ?? 'application/octet-stream';
}

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isAcceptedInput(file: { name: string; type: string }): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  return EXTRA_INPUT_EXTENSIONS.includes(fileExtension(file.name));
}
