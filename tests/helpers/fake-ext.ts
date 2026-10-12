/** Minimal in-memory chrome.* for modules that call ext() directly. */
type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

export interface FakeExt {
  store: Record<string, unknown>;
  granted: Set<string>;
  downloads: { url: string; filename: string; saveAs?: boolean }[];
  api: typeof chrome;
}

export function installFakeExt(): FakeExt {
  const store: Record<string, unknown> = {};
  const listeners: Listener[] = [];
  const granted = new Set<string>();
  const downloads: FakeExt['downloads'] = [];
  const emit = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => listeners.forEach((l) => l(changes, 'local'));

  const api = {
    runtime: { getURL: (p: string) => `chrome-extension://test/${p}`, id: 'test' },
    i18n: { getMessage: () => '' },
    storage: {
      local: {
        async get(keys?: string | string[] | null) {
          if (keys == null) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        async set(items: Record<string, unknown>) {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = structuredClone(v); }
          emit(changes);
        },
        async remove(keys: string | string[]) {
          const changes: Record<string, { oldValue?: unknown }> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) { changes[k] = { oldValue: store[k] }; delete store[k]; }
          if (Object.keys(changes).length) emit(changes);
        },
      },
      onChanged: { addListener: (l: Listener) => listeners.push(l) },
    },
    permissions: {
      contains: async ({ origins = [] }: { origins?: string[] }) => origins.every((o) => granted.has(o)),
      request: async ({ origins = [] }: { origins?: string[] }) => { origins.forEach((o) => granted.add(o)); return true; },
    },
    downloads: {
      async download(o: { url: string; filename: string; saveAs?: boolean }) { downloads.push(o); return downloads.length; },
      show: () => {},
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: { create: async () => ({}) },
  } as unknown as typeof chrome;

  (globalThis as { chrome?: typeof chrome }).chrome = api;
  return { store, granted, downloads, api };
}
