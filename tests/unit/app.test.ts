import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeConverter, JPG, change, file, mountApp } from '../helpers/app-harness';
import { EngineError } from '../../src/platform/engine';
import { NeedsPermissionError } from '../../src/platform/pending-image';
import { closeTopModal } from '../../src/ui/views/modal';

afterEach(() => { while (closeTopModal()); });

describe('App: start-up', () => {
  it('shows engine status and only formats the engine can produce', async () => {
    const h = await mountApp();
    expect(h.$('#engine-status').textContent).toBe('Conversion engine ready');
    expect(h.$$<HTMLOptionElement>('#format-select option').map((o) => o.value)).toEqual(['png', 'jpg', 'gif', 'webp']);
  });

  it('keeps an unsupported saved format visible but disabled', async () => {
    const h = await mountApp({ settings: { format: 'avif' } });
    const opt = h.$<HTMLOptionElement>('#format-select option[value="avif"]');
    expect(opt.disabled).toBe(true);
    expect(opt.textContent).toContain('not supported');
  });

  it('shows the engine error and retries on click', async () => {
    const engine = new FakeConverter();
    const init = vi.spyOn(engine, 'init').mockRejectedValueOnce(new Error('magickApi.js 404'));
    const h = await mountApp({ engine });
    // mountApp called startEngine twice (init + explicit); make it fail once then succeed
    init.mockRejectedValueOnce(new Error('magickApi.js 404'));
    await h.app.startEngine();
    expect(h.$('#engine-status').textContent).toContain('click to retry');
    expect(h.$('#engine-status').title).toBe('magickApi.js 404');
    h.$('#engine-status').click();
    await h.flush();
    expect(h.$('#engine-status').textContent).toBe('Conversion engine ready');
  });

  it('tab view hides the tab/side-panel buttons and uses the wide layout', async () => {
    await mountApp({ view: 'tab' });
    expect(document.body.classList.contains('is-tab')).toBe(true);
    expect(document.getElementById('btn-open-tab')).toBeNull();
    expect(document.getElementById('btn-sidepanel')).toBeNull();
  });
});

describe('App: queue and conversion', () => {
  it('accepts images (and HEIC with an empty MIME type), rejects other files', async () => {
    const h = await mountApp();
    h.app.addFiles([file('a.png'), file('IMG_1.HEIC', ''), file('notes.txt', 'text/plain')]);
    await h.flush();
    expect(h.$$('.queue-item__name').map((e) => e.textContent)).toEqual(['a.png', 'IMG_1.HEIC']);
    expect(h.repo.rows.size).toBe(2);
    expect(h.channel.postMessage).toHaveBeenCalledWith({ type: 'queue-changed' });
  });

  it('"Convert all" converts with resolved settings, saves into the folder and logs', async () => {
    const h = await mountApp({ settings: { format: 'jpg', quality: 80, saveFolder: 'Out', resize: { mode: 'percent', w: '50', h: '' } } });
    h.app.addFiles([file('photo.png')]);
    expect(h.$<HTMLButtonElement>('#btn-convert-all').disabled).toBe(false);
    await h.app.runQueue();
    expect(h.engine.jobs[0]).toMatchObject({
      inputExt: 'png',
      options: { outFormat: 'jpg', quality: 80, resize: { mode: 'percent', percent: 50 }, crop: null },
    });
    expect(h.$('.badge').className).toContain('done');
    expect(h.$('.size-delta').textContent).toBe('+50%');
    expect(h.saves.map((s) => s.filename)).toEqual(['Out/photo.jpg']);
    expect(h.saves[0]!.blob.type).toBe('image/jpeg');
    expect(h.settings.current.log[0]).toMatchObject({ name: 'photo.jpg', savedAs: 'Out/photo.jpg', downloadId: 1 });
    expect(h.repo.rows.values().next().value?.status).toBe('done');
  });

  it('auto-ZIP packs several results into one download (a single result stays a file)', async () => {
    const h = await mountApp({ settings: { autoZip: true } });
    h.app.addFiles([file('a.png'), file('a.PNG'), file('b.png')]);
    await h.app.runQueue();
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0]!.filename).toMatch(/^converted-images-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.zip$/);
    const text = new TextDecoder().decode(new Uint8Array(await h.saves[0]!.blob.arrayBuffer()));
    expect(text).toContain('a.png');
    expect(text).toContain('a (1).png');
    expect(h.settings.current.log[0]).toMatchObject({ isZip: true, count: 3 });

    h.app.addFiles([file('c.png')]);
    await h.app.runQueue();
    expect(h.saves[1]!.filename).toBe('c.png');
  });

  it('shows localized engine errors and offers retry', async () => {
    const engine = new FakeConverter();
    engine.fail = new EngineError('x', 'unsupported', 'avif');
    const h = await mountApp({ engine, settings: { lang: 'ru' } });
    h.app.addFiles([file('a.png')]);
    await h.app.runQueue();
    expect(h.$('.queue-item__error').textContent).toContain('Формат AVIF не поддерживается');
    engine.fail = null;
    h.$<HTMLButtonElement>('.queue-item__actions button[title="Повторить"]').click();
    await h.flush();
    expect(h.$('.badge').className).toContain('done');
    expect(h.saves).toHaveLength(1); // single retry auto-saves
  });

  it('timeout error message', async () => {
    const engine = new FakeConverter();
    engine.fail = new EngineError('timeout', 'timeout');
    const h = await mountApp({ engine });
    h.app.addFiles([file('a.png')]);
    await h.app.runQueue();
    expect(h.$('.queue-item__error').textContent).toContain('took too long');
  });

  it('per-image panel: overrides, hidden WebP fields, crop clear, convert now', async () => {
    const h = await mountApp();
    const [item] = h.app.addFiles([file('a.png')]);
    h.$<HTMLButtonElement>('.queue-item__actions button[title="Settings for this image"]').click();
    change(h.$('[data-role="item-format"]'), 'webp');
    expect(item!.overrides.format).toBe('webp');
    // WebP is produced by the browser encoder: no "effort" knob.
    expect(h.$$('.queue-item-panel select[data-optim]').map((s) => s.dataset.optim)).toEqual(['lossless']);
    change(h.$('[data-role="item-quality"]'), '70');
    h.app.setCrop(item!, { x: 1, y: 2, w: 3, h: 4 });
    expect(h.$('.crop-row__status').textContent).toBe('3×4 @ (1, 2)');
    expect(h.$('.custom-dot')).toBeTruthy();
    h.$<HTMLButtonElement>('.crop-row .icon-btn').click();
    expect(item!.overrides.crop).toBeNull();
    h.$<HTMLButtonElement>('.queue-item-panel__convert').click();
    await h.flush();
    expect(h.engine.jobs[0]!.options).toMatchObject({ outFormat: 'webp', quality: 70 });
    await vi.waitFor(() => expect([...h.repo.rows.values()][0]!.overrides.quality).toBe('70'));
  });

  it('remove and clear all', async () => {
    const h = await mountApp();
    h.app.addFiles([file('a.png'), file('b.png')]);
    h.$<HTMLButtonElement>('.queue-item__actions button[title="Remove"]').click();
    await h.flush();
    expect(h.$$('.queue-item__name').map((e) => e.textContent)).toEqual(['b.png']);
    h.$('#btn-clear-all').click();
    await h.flush();
    expect(h.$('.queue-empty').textContent).toContain('No images yet');
    expect(h.repo.rows.size).toBe(0);
  });

  it('paste adds images from the clipboard', async () => {
    const h = await mountApp();
    const ev = new Event('paste') as ClipboardEvent;
    const f = file('pasted.png');
    Object.defineProperty(ev, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => f }] } });
    document.dispatchEvent(ev);
    expect(h.app.queue.map((i) => i.name)).toEqual(['pasted.png']);
  });

  it('reloads the queue when another view broadcasts a change, keeping UI state', async () => {
    const h = await mountApp();
    const [a] = h.app.addFiles([file('a.png')]);
    await h.flush();
    a!.expanded = true;
    const rec = { ...[...h.repo.rows.values()][0]!, id: 'other', name: 'from-sidepanel.png', addedAt: Date.now() + 10 };
    await h.repo.put(rec);
    h.channel.dispatchEvent(Object.assign(new Event('message'), { data: { type: 'queue-changed' } }));
    await h.flush();
    expect(h.app.queue.map((i) => i.name)).toEqual(['a.png', 'from-sidepanel.png']);
    expect(h.app.queue[0]!.expanded).toBe(true);
  });

  it('purges converted items when the popup closes, but not in tab view', async () => {
    for (const view of ['popup', 'tab'] as const) {
      const h = await mountApp({ view });
      h.app.addFiles([file('a.png'), file('b.png')]);
      await h.flush();
      h.app.queue[0]!.status = 'done';
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await h.flush();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      expect(h.repo.rows.size).toBe(view === 'popup' ? 1 : 2);
    }
  });
});

describe('App: settings, profiles, presets', () => {
  it('settings page changes language, folder (sanitized) and toggles', async () => {
    const h = await mountApp();
    h.$('#btn-settings').click();
    expect(h.$('#settings-page').classList.contains('is-open')).toBe(true);
    const folder = h.$<HTMLInputElement>('input[name="saveFolder"]');
    change(folder, ' ../Images/:2026 ');
    expect(h.settings.current.saveFolder).toBe('Images/_2026');
    expect(folder.value).toBe('Images/_2026');
    h.$<HTMLInputElement>('input[name="autoZip"]').click();
    expect(h.settings.current.autoZip).toBe(true);
    change(h.$('select[name="lang"]'), 'ru');
    expect(h.$('.tab-btn[data-tab="log"]').textContent).toBe('Журнал');
    expect(h.$('.settings-section__title').textContent).toBe('Общее');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(h.$('#settings-page').classList.contains('is-open')).toBe(false);
  });

  it('default resize is saved (it was lost on reopen in v1.0)', async () => {
    const h = await mountApp();
    h.$('#btn-settings').click();
    change(h.$('#settings-page select[data-resize="mode"]'), 'exact');
    change(h.$('#settings-page input[data-resize="w"]'), '1200');
    expect(h.settings.current.resize).toEqual({ mode: 'exact', w: '1200', h: '' });
  });

  it('creates a preset, applies it as the profile, then deletes it via the confirm dialog', async () => {
    const h = await mountApp({ settings: { format: 'jpg' } });
    h.app.switchTab('presets');
    h.$('#btn-new-preset').click();
    change(h.$('input[name="presetName"]'), 'Small JPG');
    change(h.$('.crop-modal select[data-resize="mode"]'), 'percent');
    change(h.$('.crop-modal input[data-resize="w"]'), '50');
    h.$('[data-role="preset-save"]').click();
    expect(h.settings.current.presets).toMatchObject([{ id: 'p1', name: 'Small JPG', format: 'jpg', resizeMode: 'percent', resizeW: '50' }]);
    expect(h.$('.preset-item__meta').textContent).toContain('50%');

    h.app.updateSettings({ format: 'png' });
    change(h.$('#profile-select'), 'p1');
    expect(h.settings.current).toMatchObject({ activeProfileId: 'p1', format: 'jpg', resize: { mode: 'percent', w: '50' } });
    expect(h.$<HTMLSelectElement>('#format-select').value).toBe('jpg');

    // cancel keeps it
    h.$<HTMLButtonElement>('.preset-item button[title="Delete preset"]').click();
    h.$<HTMLButtonElement>('.crop-modal .btn-ghost').click();
    await h.flush();
    expect(h.settings.current.presets).toHaveLength(1);
    // confirm deletes it and resets the active profile
    h.$<HTMLButtonElement>('.preset-item button[title="Delete preset"]').click();
    h.$<HTMLButtonElement>('.crop-modal .btn-danger').click();
    await h.flush();
    expect(h.settings.current.presets).toEqual([]);
    expect(h.settings.current.activeProfileId).toBe('');
  });

  it('picks up settings changed in another view', async () => {
    const h = await mountApp();
    h.settings.external({ format: 'gif', theme: 'dark' });
    expect(h.$<HTMLSelectElement>('#format-select').value).toBe('gif');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('log tab lists saves with "show in folder"', async () => {
    const h = await mountApp();
    h.app.addFiles([file('a.png')]);
    await h.app.runQueue();
    h.app.switchTab('log');
    expect(h.$('.log-item__path').textContent).toBe('a.png');
    h.$<HTMLButtonElement>('#log-list button[title="Show in folder"]').click();
    expect(h.deps.downloads.show).toHaveBeenCalledWith(1);
    h.$('#btn-clear-log').click();
    expect(h.$('#log-list .queue-empty')).toBeTruthy();
  });
});

describe('App: right-click "Convert with Image Converter"', () => {
  it('imports the pending image', async () => {
    const fetchImage = vi.fn(async () => file('cat.jpg', 'image/jpeg', Array.from(JPG)));
    const h = await mountApp({ deps: { takePendingImage: async () => ({ url: 'https://ex.com/cat.jpg', ts: Date.now() }), fetchImage } });
    expect(fetchImage).toHaveBeenCalledWith('https://ex.com/cat.jpg');
    expect(h.app.queue.map((i) => i.name)).toEqual(['cat.jpg']);
  });

  it('asks for site access, then retries', async () => {
    const fetchImage = vi.fn()
      .mockRejectedValueOnce(new NeedsPermissionError('https://cdn.ex.com/*', 'cdn.ex.com'))
      .mockResolvedValueOnce(file('a.jpg', 'image/jpeg'));
    const requestOrigin = vi.fn(async () => true);
    const h = await mountApp({ deps: { takePendingImage: async () => ({ url: 'https://cdn.ex.com/a.jpg', ts: Date.now() }), fetchImage, requestOrigin } });
    expect(h.$('.notice__text').textContent).toContain('cdn.ex.com');
    h.$<HTMLButtonElement>('.notice .btn-primary').click();
    await h.flush();
    expect(requestOrigin).toHaveBeenCalledWith('https://cdn.ex.com/*');
    expect(h.app.queue.map((i) => i.name)).toEqual(['a.jpg']);
    expect(h.$<HTMLElement>('.notice').hidden).toBe(true);
  });
});
