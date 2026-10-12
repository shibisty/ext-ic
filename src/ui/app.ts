/**
 * UI controller shared by the popup, the side panel and the "open in tab"
 * page. Holds view state, talks to the platform services (injected, so the
 * whole thing runs in jsdom tests with fakes) and re-renders views.
 */
import { h, q, qOpt, option } from './dom';
import { renderQueue, formatOptions, profileOptions } from './views/queue';
import { renderSettingsPage } from './views/settings-page';
import { renderPresetsList, openPresetEditor } from './views/presets';
import { renderLogList } from './views/log';
import { closeTopModal, confirmDialog } from './views/modal';
import type { ViewContext } from './context';
import type { QueueItem } from './types';
import { applyStaticI18n, translator, type Translator } from '../i18n';
import type { CropRect } from '../core/command';
import { fileExtension, isAcceptedInput, mimeFor, normalizeFormat } from '../core/formats';
import { buildSaveFilename, replaceExt, uniqueNames } from '../core/filenames';
import { createZip } from '../core/zip';
import { addLogEntry } from '../core/log';
import { upsertPreset, type Preset } from '../core/presets';
import { optimFormatKey } from '../core/optim';
import { defaultOverrides, resolveItemSettings, type ItemOverrides, type Settings } from '../core/settings';
import { EngineError } from '../platform/engine';
import type { Converter } from '../platform/converter';
import type { QueueRecord, QueueRepo } from '../platform/queue-db';
import type { SettingsStore } from '../platform/settings-store';
import type { Downloader } from '../platform/downloads';
import type { ViewKind } from '../platform/panels';
import {
  NeedsPermissionError, fetchImageFile, requestOrigin, takePendingImage,
} from '../platform/pending-image';

export interface AppDeps {
  doc: Document;
  view: ViewKind;
  settings: SettingsStore;
  queue: QueueRepo;
  engine: Converter;
  downloads: Downloader;
  /** Cross-view queue sync; BroadcastChannel in the browser. */
  channel: Pick<BroadcastChannel, 'postMessage' | 'addEventListener'>;
  openSidePanel?: () => Promise<void>;
  openInTab?: () => void;
  /** storage.onChanged for the context-menu hand-off; optional in tests. */
  onPendingImage?: (cb: () => void) => void;
  fetchImage?: typeof fetchImageFile;
  requestOrigin?: typeof requestOrigin;
  takePendingImage?: typeof takePendingImage;
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (u: string) => void;
}

type Tab = 'convert' | 'presets' | 'log';
type EnginePhase = 'loading' | 'ready' | 'error';

interface Notice { text: string; action?: { label: string; run: () => void } }

let idCounter = 0;
const newItemId = () => `f_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export class App implements ViewContext {
  s!: Settings;
  t!: Translator;
  queue: QueueItem[] = [];
  activeTab: Tab = 'convert';
  enginePhase: EnginePhase = 'loading';
  engineError = '';
  processing = false;
  notice: Notice | null = null;

  private readonly el: Record<string, HTMLElement> = {};
  private readonly url: (b: Blob) => string;
  private readonly revoke: (u: string) => void;

  constructor(private readonly d: AppDeps) {
    this.url = d.createObjectURL ?? ((b) => URL.createObjectURL(b));
    this.revoke = d.revokeObjectURL ?? ((u) => URL.revokeObjectURL(u));
  }

  get canShowDownloads(): boolean { return this.d.downloads.canShow(); }

  get availableFormats(): readonly string[] | null {
    const caps = this.d.engine.caps;
    return caps ? [...caps.outputs.keys()] : null;
  }

  hiddenOptimFields(format: string): string[] {
    const caps = this.d.engine.caps;
    if (normalizeFormat(format) !== 'webp' || caps?.outputs.get('webp') !== 'browser') return [];
    // The canvas encoder has no "effort" knob; lossless only where q=1 means VP8L.
    return caps.webpLossless ? ['method'] : ['method', 'lossless'];
  }
  private get doc(): Document { return this.d.doc; }

  /* ------------------------------------------------------------ lifecycle */

  async init(): Promise<void> {
    this.cacheEls();
    this.s = await this.d.settings.load();
    this.t = translator(this.s.lang);
    if (this.d.view === 'tab') this.doc.body.classList.replace('is-popup', 'is-tab');
    if (this.d.view !== 'popup') this.el.btnSidepanel?.remove();
    if (this.d.view === 'tab') this.el.btnTab?.remove();
    this.applyTheme();
    this.bindEvents();
    await this.reloadQueue();
    this.applyLanguage();
    void this.startEngine();
    this.watchExternal();
    await this.pickUpPendingImage();
  }

  private cacheEls(): void {
    const ids = {
      btnSettings: 'btn-settings', btnSidepanel: 'btn-sidepanel', btnTab: 'btn-open-tab', settingsPage: 'settings-page',
      settingsBody: 'settings-page-body', btnSettingsBack: 'btn-settings-back', tabbar: 'tabbar', panelConvert: 'panel-convert',
      panelPresets: 'panel-presets', panelLog: 'panel-log', btnAddFiles: 'btn-add-files', fileInput: 'file-input',
      pasteHint: 'paste-hint', dragOverlay: 'drag-overlay', formatSelect: 'format-select', profileSelect: 'profile-select',
      btnConvertAll: 'btn-convert-all', btnClearAll: 'btn-clear-all', queueList: 'queue-list', btnNewPreset: 'btn-new-preset',
      presetsList: 'presets-list', logList: 'log-list', btnClearLog: 'btn-clear-log', engineDot: 'engine-dot', engineStatus: 'engine-status',
    } as const;
    const optional = new Set(['btnSidepanel', 'btnTab']);
    for (const [k, id] of Object.entries(ids)) {
      const node = optional.has(k) ? qOpt(id, this.doc) : q(id, this.doc);
      if (node) this.el[k] = node;
    }
    this.el.notice = h('div', { className: 'notice', hidden: true });
    this.el.queueList!.before(this.el.notice);
  }

  /* --------------------------------------------------------------- events */

  private bindEvents(): void {
    const { el } = this;
    const win = this.doc.defaultView!;
    el.btnSettings!.addEventListener('click', () => this.openSettings());
    el.btnSettingsBack!.addEventListener('click', () => this.closeSettings());
    this.doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!closeTopModal()) this.closeSettings();
    });
    for (const btn of Array.from(el.tabbar!.children) as HTMLElement[]) {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab as Tab));
    }

    const input = el.fileInput as HTMLInputElement;
    el.btnAddFiles!.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      if (input.files) this.addFiles(Array.from(input.files));
      input.value = '';
    });

    let dragDepth = 0;
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    win.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      el.dragOverlay!.classList.add('is-active');
    });
    win.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
    win.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) el.dragOverlay!.classList.remove('is-active');
    });
    win.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      el.dragOverlay!.classList.remove('is-active');
      if (e.dataTransfer?.files.length) this.addFiles(Array.from(e.dataTransfer.files));
    });

    this.doc.addEventListener('paste', (e) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.kind === 'file')
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) this.addFiles(files);
    });

    (el.formatSelect as HTMLSelectElement).addEventListener('change', () => {
      // Picking a format by hand detaches it from whatever profile was loaded.
      this.updateSettings({ format: (el.formatSelect as HTMLSelectElement).value, activeProfileId: '' });
    });
    (el.profileSelect as HTMLSelectElement).addEventListener('change', () => {
      this.applyProfile((el.profileSelect as HTMLSelectElement).value);
    });

    el.btnConvertAll!.addEventListener('click', () => void this.runQueue());
    el.btnClearAll!.addEventListener('click', () => this.clearAll());
    el.btnClearLog!.addEventListener('click', () => this.updateSettings({ log: [] }));
    el.btnNewPreset!.addEventListener('click', () => this.editPreset(null));
    // Must stay synchronous: opening the side panel requires the click's user gesture.
    el.btnSidepanel?.addEventListener('click', () => {
      this.d.openSidePanel?.().then(() => { if (this.d.view === 'popup') win.close(); }, () => {});
    });
    el.btnTab?.addEventListener('click', () => {
      this.d.openInTab?.();
      if (this.d.view === 'popup') win.close();
    });
    el.engineStatus!.addEventListener('click', () => { if (this.enginePhase === 'error') void this.startEngine(); });

    this.watchForClose();
  }

  /**
   * Converted (already saved) items are purged when the popup / side panel
   * closes. Not in tab mode — there "hidden" just means another tab got focus.
   */
  private watchForClose(): void {
    if (this.d.view === 'tab') return;
    const win = this.doc.defaultView!;
    let purged = false;
    const purge = () => {
      if (purged) return;
      purged = true;
      const done = this.queue.filter((i) => i.status === 'done').map((i) => i.id);
      if (!done.length) return;
      void this.d.queue.deleteMany(done).then(() => this.broadcast(), () => {});
    };
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') purge();
      else if (purged) { purged = false; void this.reloadQueue().then(() => this.renderQueue()); }
    });
    win.addEventListener('pagehide', purge);
  }

  private watchExternal(): void {
    this.d.settings.onExternalChange((next, changed) => {
      const before = this.s;
      this.s = { ...this.s };
      for (const k of changed) (this.s as unknown as Record<string, unknown>)[k] = next[k];
      this.afterSettingsChange(changed, before);
    });
    this.d.channel.addEventListener('message', (e) => {
      if ((e as MessageEvent).data?.type === 'queue-changed') void this.reloadQueue().then(() => this.renderQueue());
    });
    this.d.onPendingImage?.(() => void this.pickUpPendingImage());
  }

  /* ------------------------------------------------------------- settings */

  updateSettings(partial: Partial<Settings>): void {
    const before = this.s;
    this.s = { ...this.s, ...partial };
    void this.d.settings.save(partial);
    this.afterSettingsChange(Object.keys(partial) as (keyof Settings)[], before);
  }

  private afterSettingsChange(changed: (keyof Settings)[], before: Settings): void {
    const has = (k: keyof Settings) => changed.includes(k) && before[k] !== this.s[k];
    if (has('lang')) {
      this.t = translator(this.s.lang);
      this.applyLanguage();
      if (this.settingsOpen()) renderSettingsPage(this.el.settingsBody!, this);
      return; // applyLanguage re-rendered everything else
    }
    if (has('theme')) this.applyTheme();
    if (has('format')) {
      (this.el.formatSelect as HTMLSelectElement).value = this.s.format;
      if (this.settingsOpen()) renderSettingsPage(this.el.settingsBody!, this);
    }
    if (has('presets') || has('activeProfileId')) this.populateProfileSelect();
    if (has('presets') && this.activeTab === 'presets') renderPresetsList(this.el.presetsList!, this);
    if (has('log') && this.activeTab === 'log') renderLogList(this.el.logList!, this);
    if (has('format') || has('quality') || has('presets') || has('optim') || has('resize')) this.renderQueue();
  }

  private settingsOpen(): boolean { return this.el.settingsPage!.classList.contains('is-open'); }

  private openSettings(): void {
    renderSettingsPage(this.el.settingsBody!, this);
    this.el.settingsPage!.classList.add('is-open');
  }

  private closeSettings(): void { this.el.settingsPage!.classList.remove('is-open'); }

  /** Loading a profile drives the defaults (format, quality, resize, optim). */
  applyProfile(presetId: string): void {
    const p = this.s.presets.find((x) => x.id === presetId);
    if (!p) { this.updateSettings({ activeProfileId: '' }); return; }
    const key = optimFormatKey(p.format);
    this.updateSettings({
      activeProfileId: p.id,
      format: p.format,
      quality: p.quality,
      resize: { mode: p.resizeMode, w: p.resizeW, h: p.resizeH },
      ...(key && p.optim ? { optim: { ...this.s.optim, [key]: structuredClone(p.optim) } } : {}),
    });
  }

  /* ------------------------------------------------------------ rendering */

  private applyTheme(): void {
    const win = this.doc.defaultView!;
    const mq = win.matchMedia?.('(prefers-color-scheme: dark)');
    const resolved = this.s.theme === 'system' ? (mq?.matches ? 'dark' : 'light') : this.s.theme;
    this.doc.documentElement.setAttribute('data-theme', resolved);
    if (mq && !(mq as { _icBound?: boolean })._icBound) {
      (mq as { _icBound?: boolean })._icBound = true;
      mq.addEventListener?.('change', () => { if (this.s.theme === 'system') this.applyTheme(); });
    }
  }

  private applyLanguage(): void {
    this.doc.documentElement.lang = this.s.lang;
    applyStaticI18n(this.doc, this.s.lang);
    this.el.pasteHint!.textContent = this.t('addFilesHint2');
    this.populateFormatSelect();
    this.populateProfileSelect();
    this.updateEngineStatus();
    this.renderQueue();
    if (this.activeTab === 'presets') renderPresetsList(this.el.presetsList!, this);
    if (this.activeTab === 'log') renderLogList(this.el.logList!, this);
  }

  private populateFormatSelect(): void {
    const sel = this.el.formatSelect as HTMLSelectElement;
    sel.replaceChildren(...formatOptions(this, false).map(([v, l, d]) => option(v, l, d)));
    sel.value = this.s.format;
  }

  private populateProfileSelect(): void {
    const sel = this.el.profileSelect as HTMLSelectElement;
    sel.replaceChildren(...profileOptions(this).map(([v, l]) => option(v, l)));
    sel.value = this.s.activeProfileId || '';
  }

  switchTab(tab: Tab): void {
    this.activeTab = tab;
    for (const b of Array.from(this.el.tabbar!.children) as HTMLElement[]) b.classList.toggle('is-active', b.dataset.tab === tab);
    this.el.panelConvert!.style.display = tab === 'convert' ? '' : 'none';
    this.el.panelPresets!.style.display = tab === 'presets' ? '' : 'none';
    this.el.panelLog!.style.display = tab === 'log' ? '' : 'none';
    if (tab === 'presets') renderPresetsList(this.el.presetsList!, this);
    if (tab === 'log') renderLogList(this.el.logList!, this);
  }

  renderQueue(): void {
    renderQueue(this.el.queueList!, this.queue, this);
    const btn = this.el.btnConvertAll as HTMLButtonElement;
    const pending = this.queue.filter((i) => i.status === 'queued').length;
    btn.disabled = this.processing || pending === 0;
    btn.textContent = this.processing
      ? `${this.t('statusConverting')} ${this.queue.filter((i) => i.status === 'done' || i.status === 'error').length}/${this.queue.length}`
      : this.t('convertAll') + (pending > 1 ? ` (${pending})` : '');
    this.renderNotice();
  }

  private renderNotice(): void {
    const box = this.el.notice!;
    box.hidden = !this.notice;
    box.replaceChildren();
    if (!this.notice) return;
    const n = this.notice;
    box.append(
      h('div', { className: 'notice__text', textContent: n.text }),
      h('div', { className: 'notice__actions' },
        n.action && h('button', { className: 'btn btn-primary', type: 'button', textContent: n.action.label, on: { click: n.action.run } }),
        h('button', { className: 'btn btn-ghost', type: 'button', textContent: this.t('dismiss'), on: { click: () => { this.notice = null; this.renderNotice(); } } })),
    );
  }

  /* ---------------------------------------------------------------- queue */

  private toRecord(i: QueueItem): QueueRecord {
    return {
      id: i.id, name: i.name, ext: i.ext, sizeBytes: i.sizeBytes, addedAt: i.addedAt,
      // never persist "converting": another view would show a stuck spinner
      status: i.status === 'converting' ? 'queued' : i.status,
      error: i.error, resultName: i.resultName, resultSize: i.resultSize,
      overrides: i.overrides, originalBlob: i.file, resultBlobStored: i.resultBlob,
    };
  }

  private fromRecord(r: QueueRecord, prev?: QueueItem): QueueItem {
    return {
      id: r.id,
      file: r.originalBlob,
      name: r.name,
      ext: r.ext,
      sizeBytes: r.sizeBytes,
      addedAt: r.addedAt ?? 0,
      status: r.status === 'converting' ? 'queued' : r.status,
      resultBlob: r.resultBlobStored ?? null,
      resultName: r.resultName || '',
      resultSize: r.resultSize || 0,
      error: r.error || '',
      thumbUrl: prev?.thumbUrl ?? (r.originalBlob ? this.url(r.originalBlob) : ''),
      expanded: prev?.expanded ?? false,
      naturalWidth: prev?.naturalWidth ?? null,
      naturalHeight: prev?.naturalHeight ?? null,
      overrides: { ...defaultOverrides(), ...(r.overrides ?? {}) },
    };
  }

  /**
   * Re-reads the queue from IndexedDB, keeping per-view UI state (expanded,
   * thumbnails) and any item this view is converting right now.
   */
  async reloadQueue(): Promise<void> {
    let records: QueueRecord[];
    try { records = await this.d.queue.getAll(); } catch { records = []; }
    const prev = new Map(this.queue.map((i) => [i.id, i]));
    const next = records.map((r) => {
      const p = prev.get(r.id);
      return p?.status === 'converting' ? p : this.fromRecord(r, p);
    });
    const keep = new Set(next.map((i) => i.id));
    for (const p of prev.values()) {
      if (!keep.has(p.id)) {
        if (p.status === 'converting') next.push(p); // not persisted yet
        else if (p.thumbUrl) this.revoke(p.thumbUrl);
      }
    }
    this.queue = next;
  }

  private broadcast(): void {
    try { this.d.channel.postMessage({ type: 'queue-changed' }); } catch { /* closed */ }
  }

  private persist(item: QueueItem): void {
    void this.d.queue.put(this.toRecord(item)).then(() => this.broadcast(), () => {});
  }

  addFiles(files: File[]): QueueItem[] {
    const added: QueueItem[] = [];
    const now = Date.now();
    files.forEach((file, i) => {
      if (!isAcceptedInput(file)) return;
      const item: QueueItem = {
        id: newItemId(), file, name: file.name || 'image', ext: fileExtension(file.name), sizeBytes: file.size,
        addedAt: now + i, status: 'queued', resultBlob: null, resultName: '', resultSize: 0, error: '',
        thumbUrl: this.url(file), expanded: false, naturalWidth: null, naturalHeight: null, overrides: defaultOverrides(),
      };
      this.queue.push(item);
      added.push(item);
    });
    this.renderQueue();
    added.forEach((i) => this.persist(i));
    return added;
  }

  remove(item: QueueItem): void {
    this.queue = this.queue.filter((i) => i !== item);
    if (item.thumbUrl) this.revoke(item.thumbUrl);
    this.renderQueue();
    void this.d.queue.delete(item.id).then(() => this.broadcast(), () => {});
  }

  clearAll(): void {
    const keep = this.queue.filter((i) => i.status === 'converting');
    for (const i of this.queue) if (!keep.includes(i) && i.thumbUrl) this.revoke(i.thumbUrl);
    const ids = this.queue.filter((i) => !keep.includes(i)).map((i) => i.id);
    this.queue = keep;
    this.renderQueue();
    void this.d.queue.deleteMany(ids).then(() => this.broadcast(), () => {});
  }

  toggleExpanded(item: QueueItem): void {
    item.expanded = !item.expanded;
    this.renderQueue();
  }

  updateOverrides(item: QueueItem, patch: Partial<ItemOverrides>, rerender = false): void {
    item.overrides = { ...item.overrides, ...patch };
    this.persist(item);
    if (rerender) this.renderQueue();
  }

  setCrop(item: QueueItem, crop: CropRect | null): void {
    this.updateOverrides(item, { crop }, true);
  }

  /* ----------------------------------------------------------- conversion */

  async startEngine(): Promise<void> {
    this.enginePhase = 'loading';
    this.updateEngineStatus();
    try {
      await this.d.engine.init();
      this.enginePhase = 'ready';
      this.engineError = '';
      // Now we know which formats really work — rebuild every format list.
      this.populateFormatSelect();
      this.renderQueue();
      if (this.settingsOpen()) renderSettingsPage(this.el.settingsBody!, this);
    } catch (err) {
      this.enginePhase = 'error';
      this.engineError = (err as Error)?.message || String(err);
    }
    this.updateEngineStatus();
  }

  private updateEngineStatus(): void {
    const { engineDot: dot, engineStatus: status } = this.el;
    const phase = this.enginePhase;
    dot!.className = `dot ${phase === 'ready' ? 'ok' : phase === 'error' ? 'err' : 'loading'}`;
    status!.textContent = phase === 'ready' ? this.t('engineReady')
      : phase === 'error' ? `${this.t('engineError')} — ${this.t('clickToRetry')}` : this.t('engineLoading');
    status!.title = phase === 'error' ? this.engineError : '';
    status!.classList.toggle('is-clickable', phase === 'error');
  }

  convertOne(item: QueueItem): void { void this.convertItem(item, false); }

  /** Returns true when the item converted successfully. */
  async convertItem(item: QueueItem, batch: boolean): Promise<boolean> {
    if (item.status === 'converting') return false;
    item.status = 'converting';
    item.error = '';
    this.renderQueue();
    try {
      const st = resolveItemSettings(item.overrides, this.s);
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const out = await this.d.engine.convert({
        bytes,
        inputExt: item.ext,
        inputMime: item.file.type,
        options: { outFormat: st.format, quality: st.quality, resize: st.resize, crop: st.crop, optim: st.optim },
      });
      item.resultBlob = new Blob([out as BlobPart], { type: mimeFor(st.format) });
      item.resultSize = item.resultBlob.size;
      item.resultName = replaceExt(item.name, st.format);
      item.status = 'done';
    } catch (err) {
      item.status = 'error';
      item.error = this.describeError(err);
    }
    if (this.queue.includes(item)) {
      this.persist(item);
    }
    this.renderQueue();
    const ok = item.status === 'done';
    if (!batch && ok) await this.saveItem(item);
    return ok;
  }

  private describeError(err: unknown): string {
    if (err instanceof EngineError) {
      if (err.code === 'timeout') return this.t('engineTimeout');
      if (err.code === 'unsupported') return this.t('formatUnsupported', (err.detail ?? '').toUpperCase());
      if (err.code === 'webp-lossless') return this.t('webpLosslessUnsupported');
    }
    return (err as Error)?.message || this.t('errorGeneric');
  }

  async runQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    const converted: QueueItem[] = [];
    try {
      for (const item of this.queue.slice()) {
        if (item.status !== 'queued' || !this.queue.includes(item)) continue;
        if (await this.convertItem(item, true)) converted.push(item);
      }
      if (converted.length) {
        if (this.s.autoZip && converted.length > 1) await this.saveZip(converted);
        else for (const item of converted) await this.saveItem(item);
      }
    } finally {
      this.processing = false;
      this.renderQueue();
    }
  }

  /* --------------------------------------------------------------- saving */

  download(item: QueueItem): void { void this.saveItem(item); }

  async saveItem(item: QueueItem): Promise<void> {
    if (!item.resultBlob) return;
    const savedAs = buildSaveFilename(this.s.saveFolder, item.resultName);
    const downloadId = await this.d.downloads.save(item.resultBlob, savedAs, this.s.askSaveLocation);
    this.log({ name: item.resultName, savedAs, sizeBytes: item.resultSize, downloadId, isZip: false, timestamp: Date.now() });
  }

  async saveZip(items: QueueItem[]): Promise<void> {
    const names = uniqueNames(items.map((i) => i.resultName));
    const files = await Promise.all(items.map(async (i, n) => ({ name: names[n]!, data: new Uint8Array(await i.resultBlob!.arrayBuffer()) })));
    const zip = createZip(files);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const savedAs = buildSaveFilename(this.s.saveFolder, `converted-images-${stamp}.zip`);
    const downloadId = await this.d.downloads.save(zip, savedAs, this.s.askSaveLocation);
    this.log({ name: `${items.length} ${this.t('savedAsZip')}`, savedAs, sizeBytes: zip.size, downloadId, isZip: true, count: items.length, timestamp: Date.now() });
  }

  private log(entry: Parameters<typeof addLogEntry>[1]): void {
    this.updateSettings({ log: addLogEntry(this.s.log, entry) });
  }

  showDownload(id: number): void { this.d.downloads.show(id); }

  /* -------------------------------------------------------------- presets */

  editPreset(preset: Preset | null): void {
    openPresetEditor(preset, this, (saved) => this.updateSettings({ presets: upsertPreset(this.s.presets, saved) }));
  }

  async deletePreset(preset: Preset): Promise<void> {
    const ok = await confirmDialog({
      title: this.t('deletePreset'), message: this.t('deletePresetConfirm'), ok: this.t('confirmYes'), cancel: this.t('cancel'),
    });
    if (!ok) return;
    this.updateSettings({
      presets: this.s.presets.filter((p) => p.id !== preset.id),
      ...(this.s.activeProfileId === preset.id ? { activeProfileId: '' } : {}),
    });
  }

  /* ------------------------------------------------- context-menu hand-off */

  private pickingUp = false;

  /** Init and storage.onChanged can both fire for the same hand-off — take it once. */
  async pickUpPendingImage(): Promise<void> {
    if (this.pickingUp) return;
    this.pickingUp = true;
    try {
      const pending = await (this.d.takePendingImage ?? takePendingImage)();
      if (pending) await this.importFromUrl(pending.url);
    } catch { /* storage unavailable */ } finally {
      this.pickingUp = false;
    }
  }

  async importFromUrl(url: string): Promise<void> {
    const fetchImage = this.d.fetchImage ?? fetchImageFile;
    try {
      const file = await fetchImage(url);
      this.notice = null;
      this.addFiles([file]);
    } catch (err) {
      if (err instanceof NeedsPermissionError) {
        this.notice = {
          text: this.t('contextNeedsAccess', err.host),
          action: {
            label: this.t('allowAccess'),
            run: () => {
              // permissions.request needs the click gesture: call it first, synchronously.
              void (this.d.requestOrigin ?? requestOrigin)(err.origin).then((granted) => {
                if (granted) void this.importFromUrl(url);
              });
            },
          },
        };
      } else {
        this.notice = { text: `${this.t('contextFetchFailed')}: ${(err as Error)?.message || err}` };
      }
      this.renderNotice();
    }
  }
}

