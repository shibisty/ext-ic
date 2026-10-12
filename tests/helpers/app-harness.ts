import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { App, type AppDeps } from '../../src/ui/app';
import { defaultSettings, type Settings } from '../../src/core/settings';
import type { Converter, ConvertJob } from '../../src/platform/converter';
import type { EngineCaps } from '../../src/core/capabilities';
import type { QueueRecord, QueueRepo } from '../../src/platform/queue-db';
import type { SettingsStore } from '../../src/platform/settings-store';
import type { ViewKind } from '../../src/platform/panels';

const pageBody = (file: string) => {
  const html = readFileSync(resolve(__dirname, '../../src', file), 'utf8');
  const m = /<body class="([^"]+)">([\s\S]*)<\/body>/.exec(html)!;
  return { cls: m[1]!, inner: m[2]!.replace(/<script[\s\S]*?<\/script>/g, '') };
};

export const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

export class FakeConverter implements Converter {
  caps: EngineCaps | null = null;
  jobs: ConvertJob[] = [];
  fail: Error | null = null;
  output = JPG;
  constructor(public formats: Record<string, 'magick' | 'browser'> = { png: 'magick', jpg: 'magick', gif: 'magick', webp: 'browser' }) {}
  async init() {
    this.caps = { outputs: new Map(Object.entries(this.formats)), browserDecode: true, webpLossless: true };
    return this.caps;
  }
  async convert(job: ConvertJob) {
    this.jobs.push(job);
    if (this.fail) throw this.fail;
    return this.output;
  }
}

export class MemoryRepo implements QueueRepo {
  rows = new Map<string, QueueRecord>();
  async put(r: QueueRecord) { this.rows.set(r.id, r); }
  async delete(id: string) { this.rows.delete(id); }
  async deleteMany(ids: readonly string[]) { ids.forEach((id) => this.rows.delete(id)); }
  async clear() { this.rows.clear(); }
  async getAll() { return [...this.rows.values()].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0)); }
}

export class MemorySettings implements SettingsStore {
  saved: Partial<Settings>[] = [];
  private listeners: ((s: Settings, changed: (keyof Settings)[]) => void)[] = [];
  constructor(public current: Settings = defaultSettings('en')) {}
  async load() { return structuredClone(this.current); }
  async save(p: Partial<Settings>) { this.saved.push(p); this.current = { ...this.current, ...structuredClone(p) }; }
  onExternalChange(cb: (s: Settings, changed: (keyof Settings)[]) => void) { this.listeners.push(cb); }
  /** Simulates a change made in another popup/side panel. */
  external(p: Partial<Settings>) {
    this.current = { ...this.current, ...p };
    this.listeners.forEach((l) => l(structuredClone(this.current), Object.keys(p) as (keyof Settings)[]));
  }
}

export interface Harness {
  app: App;
  deps: AppDeps;
  engine: FakeConverter;
  repo: MemoryRepo;
  settings: MemorySettings;
  saves: { blob: Blob; filename: string; saveAs: boolean }[];
  channel: EventTarget & { postMessage: ReturnType<typeof vi.fn> };
  $: <T extends Element = HTMLElement>(sel: string) => T;
  $$: <T extends Element = HTMLElement>(sel: string) => T[];
  flush: () => Promise<void>;
}

export async function mountApp(opts: { view?: ViewKind; settings?: Partial<Settings>; engine?: FakeConverter; deps?: Partial<AppDeps> } = {}): Promise<Harness> {
  const view = opts.view ?? 'popup';
  const page = pageBody(view === 'sidepanel' ? 'sidepanel.html' : 'popup.html');
  document.body.className = page.cls;
  document.body.innerHTML = page.inner;

  const engine = opts.engine ?? new FakeConverter();
  const repo = new MemoryRepo();
  const settings = new MemorySettings({ ...defaultSettings('en'), ...opts.settings });
  const saves: Harness['saves'] = [];
  const channel = Object.assign(new EventTarget(), { postMessage: vi.fn() });
  let n = 0;
  const deps: AppDeps = {
    doc: document,
    view,
    settings,
    queue: repo,
    engine,
    downloads: {
      save: async (blob, filename, saveAs) => { saves.push({ blob, filename, saveAs }); return saves.length; },
      canShow: () => true,
      show: vi.fn(),
    },
    channel,
    createObjectURL: () => `blob:test/${n++}`,
    revokeObjectURL: () => {},
    takePendingImage: async () => null,
    ...opts.deps,
  };
  const app = new App(deps);
  await app.init();
  await app.startEngine();
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  await flush();
  return {
    app, deps, engine, repo, settings, saves, channel, flush,
    $: (sel) => { const el = document.querySelector(sel); if (!el) throw new Error(`no ${sel}`); return el as never; },
    $$: (sel) => Array.from(document.querySelectorAll(sel)) as never,
  };
}

export const file = (name: string, type = 'image/png', bytes: number[] = [0x89, 0x50, 0x4e, 0x47]) =>
  new File([new Uint8Array(bytes)], name, { type });

export function change(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  if (el instanceof HTMLInputElement) el.dispatchEvent(new Event('change', { bubbles: true }));
}
