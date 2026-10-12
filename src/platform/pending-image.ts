/**
 * Right-click "Convert with Image Converter": the background stores the
 * image URL in storage.local; whichever view is open picks it up.
 *
 * Extension pages bypass CORS only for origins the user granted, so if the
 * fetch fails we ask (per origin) via optional_host_permissions.
 */
import { ext } from './browser';
import { nameFromUrl } from '../core/filenames';
import { sniffFormat } from '../core/capabilities';
import { mimeFor } from '../core/formats';

export const PENDING_KEY = 'pendingImage';

export interface PendingImage { url: string; ts: number }

export async function takePendingImage(): Promise<PendingImage | null> {
  const api = ext();
  const raw = await api.storage.local.get([PENDING_KEY, 'pendingImageUrl']);
  // v1.0 stored a bare URL under pendingImageUrl.
  const value = (raw[PENDING_KEY] as PendingImage | undefined)
    ?? (typeof raw.pendingImageUrl === 'string' ? { url: raw.pendingImageUrl, ts: Date.now() } : null);
  if (!value?.url) return null;
  await api.storage.local.remove([PENDING_KEY, 'pendingImageUrl']);
  // Ignore stale requests (e.g. the panel failed to open an hour ago).
  if (Date.now() - value.ts > 5 * 60_000) return null;
  return value;
}

export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? `${u.protocol}//${u.host}/*` : null;
  } catch {
    return null;
  }
}

export class NeedsPermissionError extends Error {
  constructor(readonly origin: string, readonly host: string) {
    super(`No access to ${host}`);
  }
}

export async function fetchImageFile(url: string, fetchImpl: typeof fetch = fetch): Promise<File> {
  try {
    const resp = await fetchImpl(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    // Servers often send octet-stream/text: trust the bytes over the header.
    let type = blob.type.split(';')[0]!.trim();
    if (!type.startsWith('image/')) {
      const sniffed = sniffFormat(new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
      type = sniffed ? mimeFor(sniffed) : 'image/png';
    }
    return new File([blob], nameFromUrl(url, type), { type });
  } catch (err) {
    const origin = originPattern(url);
    if (origin && !(await hasOrigin(origin))) throw new NeedsPermissionError(origin, new URL(url).host);
    throw err;
  }
}

async function hasOrigin(origin: string): Promise<boolean> {
  try { return await ext().permissions.contains({ origins: [origin] }); } catch { return false; }
}

/** Must be called from a click handler (user gesture). */
export async function requestOrigin(origin: string): Promise<boolean> {
  try { return await ext().permissions.request({ origins: [origin] }); } catch { return false; }
}
