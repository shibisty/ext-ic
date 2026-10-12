import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createQueueRepo, type QueueRecord } from '../../src/platform/queue-db';
import { EngineError, MagickEngine, summarizeStderr, type MagickModule } from '../../src/platform/engine';
import { HybridConverter } from '../../src/platform/converter';
import type { BrowserCodecs } from '../../src/platform/browser-codecs';
import { NeedsPermissionError, PENDING_KEY, fetchImageFile, originPattern, takePendingImage } from '../../src/platform/pending-image';
import { createSettingsStore } from '../../src/platform/settings-store';
import { defaultOverrides } from '../../src/core/settings';
import { installFakeExt } from '../helpers/fake-ext';

const rec = (id: string, addedAt?: number): QueueRecord => ({
  id, name: `${id}.png`, ext: 'png', sizeBytes: 3, status: 'queued', error: '', resultName: '', resultSize: 0,
  overrides: defaultOverrides(), originalBlob: new Blob([new Uint8Array([1, 2, 3])]), resultBlobStored: null, addedAt,
});

describe('queue repo (IndexedDB)', () => {
  it('stores, lists in insertion order, deletes', async () => {
    const repo = createQueueRepo(new IDBFactory());
    await repo.put(rec('f10', 3));
    await repo.put(rec('f2', 2));
    await repo.put(rec('f1', 1));
    expect((await repo.getAll()).map((r) => r.id)).toEqual(['f1', 'f2', 'f10']);
    await repo.deleteMany(['f1', 'f10']);
    expect((await repo.getAll()).map((r) => r.id)).toEqual(['f2']);
    await repo.clear();
    expect(await repo.getAll()).toEqual([]);
  });

  it('v1.0 records without addedAt sort numerically by id (was f1, f10, f2)', async () => {
    const repo = createQueueRepo(new IDBFactory());
    for (const id of ['f1_x', 'f10_x', 'f2_x']) await repo.put(rec(id));
    expect((await repo.getAll()).map((r) => r.id)).toEqual(['f1_x', 'f2_x', 'f10_x']);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 x');

function fakeModule(impl: MagickModule['call']): MagickModule {
  return { call: vi.fn(impl) };
}

describe('MagickEngine', () => {
  it('returns the named output file', async () => {
    const mod = fakeModule(async () => ({ outputFiles: [{ name: 'output.jpg', buffer: JPG.buffer }], exitCode: 0 }));
    const e = new MagickEngine(async () => mod);
    const out = await e.run({ bytes: PNG, inputName: 'input.png', argv: ['convert'], outName: 'output.jpg' });
    expect(Array.from(out)).toEqual(Array.from(JPG));
  });

  it('passes a copy of the input (the library transfers/detaches buffers)', async () => {
    let received: Uint8Array | undefined;
    const e = new MagickEngine(async () => fakeModule(async (files) => { received = files[0]!.content; return { outputFiles: [{ name: 'o', buffer: JPG.buffer }] }; }));
    const input = PNG.slice();
    await e.run({ bytes: input, inputName: 'i', argv: [], outName: 'o' });
    expect(received).not.toBe(input);
    expect(Array.from(received!)).toEqual(Array.from(input));
  });

  it('turns stderr into a readable error when nothing was produced', async () => {
    const e = new MagickEngine(async () => fakeModule(async () => ({
      outputFiles: [], exitCode: 1,
      stderr: ["convert: UnableToOpenConfigureFile `delegates.xml' @ warning/configure.c/x.", "convert: no decode delegate for this image format `XYZ' @ error/constitute.c/ReadImage/556."],
    })));
    await expect(e.run({ bytes: PNG, inputName: 'i', argv: [], outName: 'o' })).rejects.toThrow("no decode delegate for this image format `XYZ'");
  });

  it('allows retrying after a failed load', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue(fakeModule(async () => ({ outputFiles: [] })));
    const e = new MagickEngine(loader);
    await expect(e.init()).rejects.toMatchObject({ code: 'load' });
    await expect(e.init()).resolves.toBeUndefined();
  });

  it('times out a hung worker and re-imports a fresh module', async () => {
    vi.useFakeTimers();
    const loader = vi.fn()
      .mockResolvedValueOnce(fakeModule(() => new Promise(() => {})))
      .mockResolvedValueOnce(fakeModule(async () => ({ outputFiles: [{ name: 'o', buffer: JPG.buffer }] })));
    const e = new MagickEngine(loader, 1000);
    const p = e.run({ bytes: PNG, inputName: 'i', argv: [], outName: 'o' });
    const assertion = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    vi.useRealTimers();
    await expect(e.run({ bytes: PNG, inputName: 'i', argv: [], outName: 'o' })).resolves.toBeInstanceOf(Uint8Array);
    expect(loader.mock.calls.map((c) => c[0])).toEqual([0, 1]); // generation bumped → cache-busting re-import
  });

  it('summarizeStderr', () => {
    expect(summarizeStderr([], 2)).toBe('ImageMagick exited with code 2');
    expect(summarizeStderr(['  ', 'magick: bad thing @ x.c/1'])).toBe('bad thing');
  });
});

function fakeCodecs(over: Partial<BrowserCodecs> = {}): BrowserCodecs {
  return {
    probe: async () => ({ encoders: new Set(['webp']), webpLossless: true, canDecode: true }),
    encode: vi.fn(async () => WEBP),
    decodeToPng: vi.fn(async () => PNG),
    ...over,
  };
}

const LIST = ['      JPEG* rw-   JPEG', '      PNG* rw-   PNG', '      GIF* rw+   GIF'];

describe('HybridConverter', () => {
  const opts = { outFormat: 'jpg', quality: 80 };

  it('derives capabilities from the engine and the browser', async () => {
    const magick = { init: vi.fn(async () => {}), listFormats: vi.fn(async () => LIST), run: vi.fn() };
    const c = new HybridConverter(magick, fakeCodecs(), ['png', 'jpg', 'webp', 'avif']);
    const caps = await c.init();
    expect(Object.fromEntries(caps.outputs)).toEqual({ png: 'magick', jpg: 'magick', webp: 'browser' });
  });

  it('routes WEBP through IM→PNG→canvas with lossy quality capped below 1', async () => {
    const magick = { init: vi.fn(async () => {}), listFormats: vi.fn(async () => LIST), run: vi.fn(async () => PNG) };
    const codecs = fakeCodecs();
    const c = new HybridConverter(magick, codecs, ['png', 'webp']);
    const out = await c.convert({ bytes: PNG, inputExt: 'png', options: { outFormat: 'webp', quality: 100, resize: { mode: 'percent', percent: 50 } } });
    expect(out).toBe(WEBP);
    const argv = (magick.run.mock.calls[0] as unknown as [{ argv: string[] }])[0].argv;
    expect(argv.at(-1)).toBe('output.png');
    expect(argv).toContain('50%');
    expect(codecs.encode).toHaveBeenCalledWith(PNG, 'image/webp', 0.99);
  });

  it('lossless WEBP uses quality 1, or fails clearly where unsupported', async () => {
    const magick = { init: vi.fn(async () => {}), listFormats: vi.fn(async () => LIST), run: vi.fn(async () => PNG) };
    const codecs = fakeCodecs();
    await new HybridConverter(magick, codecs, ['webp']).convert({ bytes: PNG, inputExt: 'png', options: { outFormat: 'webp', optim: { lossless: 'on' } } });
    expect(codecs.encode).toHaveBeenCalledWith(PNG, 'image/webp', 1);

    const noLossless = fakeCodecs({ probe: async () => ({ encoders: new Set(['webp']), webpLossless: false, canDecode: true }) });
    await expect(new HybridConverter(magick, noLossless, ['webp']).convert({ bytes: PNG, inputExt: 'png', options: { outFormat: 'webp', optim: { lossless: 'on' } } }))
      .rejects.toMatchObject({ code: 'webp-lossless' });
  });

  it('retries via browser decoding when IM cannot read the input', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new EngineError('no decode delegate', 'magick'))
      .mockResolvedValueOnce(JPG);
    const codecs = fakeCodecs();
    const c = new HybridConverter({ init: async () => {}, listFormats: async () => LIST, run }, codecs, ['jpg']);
    await c.convert({ bytes: WEBP, inputExt: 'webp', inputMime: 'image/webp', options: opts });
    expect(codecs.decodeToPng).toHaveBeenCalledWith(WEBP, 'image/webp');
    expect(run.mock.calls[1]![0].inputName).toBe('input.png');
  });

  it('reports the IM error when the browser cannot decode either', async () => {
    const run = vi.fn().mockRejectedValue(new EngineError('ImproperImageHeader', 'magick'));
    const codecs = fakeCodecs({ decodeToPng: vi.fn(async () => { throw new Error('decode'); }) });
    const c = new HybridConverter({ init: async () => {}, listFormats: async () => LIST, run }, codecs, ['jpg']);
    await expect(c.convert({ bytes: PNG, inputExt: 'png', options: opts })).rejects.toThrow('ImproperImageHeader');
  });

  it('rejects unsupported formats and mislabeled outputs', async () => {
    const run = vi.fn(async () => PNG); // IM "succeeds" but writes PNG
    const c = new HybridConverter({ init: async () => {}, listFormats: async () => [], run }, fakeCodecs(), ['avif', 'jpg']);
    // empty format list → candidate list trusted → avif routed to magick → signature check catches it
    await expect(c.convert({ bytes: PNG, inputExt: 'png', options: { outFormat: 'avif' } })).rejects.toMatchObject({ code: 'unsupported', detail: 'avif' });
    await expect(c.convert({ bytes: PNG, inputExt: 'png', options: { outFormat: 'heic' } })).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('pending image (context menu)', () => {
  it('takes the stored URL once, also in the v1.0 key', async () => {
    const fx = installFakeExt();
    await fx.api.storage.local.set({ [PENDING_KEY]: { url: 'https://a/x.png', ts: Date.now() } });
    expect((await takePendingImage())?.url).toBe('https://a/x.png');
    expect(await takePendingImage()).toBeNull();
    await fx.api.storage.local.set({ pendingImageUrl: 'https://b/y.png' });
    expect((await takePendingImage())?.url).toBe('https://b/y.png');
  });

  it('ignores stale requests', async () => {
    const fx = installFakeExt();
    await fx.api.storage.local.set({ [PENDING_KEY]: { url: 'https://a/x.png', ts: Date.now() - 10 * 60_000 } });
    expect(await takePendingImage()).toBeNull();
  });

  it('asks for permission when a cross-origin fetch fails without access', async () => {
    const fx = installFakeExt();
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchImageFile('https://cdn.example.com/a.jpg', failing)).rejects.toBeInstanceOf(NeedsPermissionError);
    fx.granted.add('https://cdn.example.com/*');
    await expect(fetchImageFile('https://cdn.example.com/a.jpg', failing)).rejects.toThrow('Failed to fetch');
  });

  it('builds a File with a sensible name', async () => {
    installFakeExt();
    const ok = vi.fn(async () => new Response(JPG, { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
    const f = await fetchImageFile('https://ex.com/photos/cat?size=l', ok);
    expect(f.name).toBe('cat.jpg');
    expect(f.type).toBe('image/jpeg');
    // wrong Content-Type → sniffed from bytes
    const octet = vi.fn(async () => new Response(PNG, { headers: { 'content-type': 'application/octet-stream' } })) as unknown as typeof fetch;
    const g = await fetchImageFile('https://ex.com/raw', octet);
    expect([g.name, g.type]).toEqual(['raw.png', 'image/png']);
  });

  it('originPattern', () => {
    expect(originPattern('https://ex.com:8443/a?b')).toBe('https://ex.com:8443/*');
    expect(originPattern('data:image/png;base64,')).toBeNull();
  });
});

describe('settings store', () => {
  it('saves and notifies other views', async () => {
    installFakeExt();
    const a = createSettingsStore('en');
    const b = createSettingsStore('en');
    const seen: string[][] = [];
    b.onExternalChange((_next, changed) => seen.push(changed));
    await a.save({ format: 'jpg', autoZip: true });
    await vi.waitFor(() => expect(seen).toEqual([['format', 'autoZip']]));
    expect((await b.load()).format).toBe('jpg');
  });
});
