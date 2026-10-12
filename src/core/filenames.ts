/** Characters Chrome/Firefox reject in downloads.download({filename}). */
const ILLEGAL = /[<>:"|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function replaceExt(name: string, newExt: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${newExt}`;
}

/** One path segment safe for every OS. */
export function sanitizeSegment(seg: string): string {
  let s = seg.replace(ILLEGAL, '_').replace(/[. ]+$/g, '').trim();
  if (s === '' || s === '.' || s === '..') return '';
  if (RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

export function sanitizeFileName(name: string): string {
  return sanitizeSegment(name.replace(/[\\/]/g, '_')) || 'image';
}

/**
 * "  /Images\\2026/../x/ " → "Images/2026/x". Empty / dot segments are
 * dropped so the result always stays inside Downloads.
 */
export function sanitizeFolder(folder: string): string {
  return folder
    .split(/[\\/]+/)
    .map(sanitizeSegment)
    .filter(Boolean)
    .join('/');
}

export function buildSaveFilename(folder: string, name: string): string {
  const f = sanitizeFolder(folder);
  const n = sanitizeFileName(name);
  return f ? `${f}/${n}` : n;
}

/** Makes names unique: a.png, a (1).png, a (2).png … (case-insensitive). */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((original) => {
    let name = original;
    let n = 1;
    while (used.has(name.toLowerCase())) {
      const dot = original.lastIndexOf('.');
      const base = dot > 0 ? original.slice(0, dot) : original;
      const ext = dot > 0 ? original.slice(dot) : '';
      name = `${base} (${n})${ext}`;
      n++;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Derives a file name from an image URL (context-menu flow). */
export function nameFromUrl(url: string, mimeType: string): string {
  let last = 'image';
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    try {
      const path = new URL(url).pathname;
      last = decodeURIComponent(path.split('/').filter(Boolean).pop() || 'image');
    } catch { /* keep default */ }
  }
  last = sanitizeFileName(last);
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
  const sub = (mimeType.split('/')[1] || 'png').split('+')[0]!.replace('jpeg', 'jpg');
  return `${last}.${sub}`;
}
