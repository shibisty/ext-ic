export interface LogEntry {
  id: string;
  name: string;
  savedAs: string;
  sizeBytes: number;
  downloadId: number | null;
  isZip: boolean;
  count?: number;
  timestamp: number;
}

export const LOG_LIMIT = 60;

export function addLogEntry(log: readonly LogEntry[], entry: Omit<LogEntry, 'id'>, idSeed = Date.now()): LogEntry[] {
  const id = `log_${idSeed.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return [{ ...entry, id }, ...log].slice(0, LOG_LIMIT);
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Size change as a signed percentage, e.g. "−63%" / "+12%". */
export function formatSizeDelta(before: number, after: number): string {
  if (!before || !Number.isFinite(after)) return '';
  const pct = Math.round(((after - before) / before) * 100);
  if (pct === 0) return '±0%';
  return pct < 0 ? `−${Math.abs(pct)}%` : `+${pct}%`;
}

export function formatTimeAgo(ts: number, lang: 'en' | 'ru', now = Date.now()): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  const ru = lang === 'ru';
  if (sec < 60) return ru ? 'только что' : 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return ru ? `${min} мин назад` : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return ru ? `${hr} ч назад` : `${hr} h ago`;
  const d = Math.round(hr / 24);
  return ru ? `${d} дн назад` : `${d} d ago`;
}
