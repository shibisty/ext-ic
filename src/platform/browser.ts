/**
 * Cross-browser namespace. Firefox exposes `browser` (and a promise-based
 * `chrome` in MV3); Chrome only `chrome`. Both are typed as `chrome.*`.
 * Resolved lazily so tests can install a fake on globalThis.
 */
export type Ext = typeof chrome;

export function ext(): Ext {
  const g = globalThis as unknown as { browser?: Ext; chrome?: Ext };
  const api = g.browser ?? g.chrome;
  if (!api) throw new Error('Extension API is not available');
  return api;
}

/** Fire-and-forget for promise-returning extension calls. */
export function quiet(p: unknown): void {
  if (p && typeof (p as Promise<unknown>).catch === 'function') (p as Promise<unknown>).catch(() => {});
}
