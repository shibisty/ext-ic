/**
 * Wrapper around the vendored KnicKnic wasm-imagemagick build.
 *
 * - The library is imported at runtime by absolute URL (never bundled): it
 *   finds magick.js / magick.wasm relative to its own URL via a stack trace.
 * - It runs ImageMagick in its own Web Worker, so the UI stays responsive.
 * - The library never rejects if the worker dies (OOM, crash): the promise
 *   just hangs. We add a timeout; on timeout the module is re-imported with
 *   a cache-busting query, which spawns a fresh worker for later calls.
 */
import { ext } from './browser';

export interface MagickCallResult {
  outputFiles: { name: string; buffer?: ArrayBuffer; blob?: Blob }[];
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
}

export interface MagickModule {
  call(files: { name: string; content: Uint8Array }[], argv: string[]): Promise<MagickCallResult>;
}

export interface EngineRun {
  bytes: Uint8Array;
  inputName: string;
  argv: string[];
  outName: string;
}

export type EngineErrorCode = 'load' | 'timeout' | 'magick' | 'no-output' | 'unsupported' | 'webp-lossless';

export class EngineError extends Error {
  constructor(message: string, readonly code: EngineErrorCode, readonly detail?: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export type MagickLoader = (generation: number) => Promise<MagickModule>;

export const MAGICK_API_PATH = 'lib/wasm-imagemagick/magickApi.js';

/**
 * Path is relative to the built UI bundle (dist/<target>/assets/main.js).
 * Generation > 0 re-imports with a query string → a new module instance →
 * a new worker (used after a timeout).
 */
export const defaultLoader: MagickLoader = async (generation) => {
  if (!generation) return (await import(/* @vite-ignore */ '../lib/wasm-imagemagick/magickApi.js')) as MagickModule;
  const url = `${ext().runtime.getURL(MAGICK_API_PATH)}?gen=${Number(generation)}`;
  return (await import(/* @vite-ignore */ url)) as MagickModule;
};

function describe(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return (err as Error).message || String(err);
}

/** Pulls the useful line out of ImageMagick's stderr. */
export function summarizeStderr(stderr: readonly string[] | undefined, exitCode?: number): string {
  const lines = (stderr ?? []).map((l) => l.trim()).filter(Boolean);
  // Skip warnings like "UnableToOpenConfigureFile `delegates.xml' @ warning/…".
  const errors = lines.filter((l) => !/@\s*warning\//i.test(l));
  const important = errors.find((l) => /@\s*error\//i.test(l)) ?? errors[0] ?? lines[0];
  if (important) return important.replace(/^(convert|magick)(\.\w+)?:\s*/i, '').replace(/\s+@\s+\S+$/, '');
  return exitCode ? `ImageMagick exited with code ${exitCode}` : 'ImageMagick produced no output';
}

export class MagickEngine {
  private modulePromise: Promise<MagickModule> | null = null;
  private generation = 0;
  /** Serialize jobs: the worker handles one at a time anyway, and a timeout must only blame its own job. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly loader: MagickLoader = defaultLoader,
    private readonly timeoutMs = 180_000,
  ) {}

  private load(): Promise<MagickModule> {
    this.modulePromise ??= this.loader(this.generation).then(
      (mod) => {
        if (!mod || typeof mod.call !== 'function') {
          throw new EngineError(`${MAGICK_API_PATH} loaded, but call() is missing — wrong file?`, 'load');
        }
        return mod;
      },
      (err) => {
        this.modulePromise = null; // allow retry
        throw new EngineError(`Could not load ${MAGICK_API_PATH} (${describe(err)})`, 'load');
      },
    );
    return this.modulePromise;
  }

  async init(): Promise<void> {
    await this.load();
  }

  /** Drops the current module/worker; next call spawns a fresh one. */
  reset(): void {
    this.generation++;
    this.modulePromise = null;
  }

  /** Raw call, serialized and guarded by the timeout. */
  exec(files: { name: string; content: Uint8Array }[], argv: string[]): Promise<MagickCallResult> {
    const next = this.chain.then(() => this.execNow(files, argv));
    this.chain = next.catch(() => {});
    return next;
  }

  private async execNow(files: { name: string; content: Uint8Array }[], argv: string[]): Promise<MagickCallResult> {
    const mod = await this.load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.reset();
        reject(new EngineError('timeout', 'timeout'));
      }, this.timeoutMs);
    });
    try {
      // The library transfers input buffers to the worker — pass copies so
      // the caller's bytes stay usable (e.g. for a retry).
      return await Promise.race([mod.call(files.map((f) => ({ name: f.name, content: f.content.slice() })), argv), timeout]);
    } catch (err) {
      if (err instanceof EngineError) throw err;
      throw new EngineError(describe(err), 'magick');
    } finally {
      clearTimeout(timer);
    }
  }

  /** `convert -list format` output lines. */
  async listFormats(): Promise<string[]> {
    const r = await this.exec([], ['convert', '-list', 'format']);
    return r.stdout ?? [];
  }

  async run(job: EngineRun): Promise<Uint8Array> {
    const result = await this.exec([{ name: job.inputName, content: job.bytes }], job.argv);
    const files = result.outputFiles ?? [];
    const out = files.find((f) => f.name === job.outName) ?? files[0];
    if (!out) {
      throw new EngineError(summarizeStderr(result.stderr, result.exitCode), result.exitCode ? 'magick' : 'no-output');
    }
    const buffer = out.buffer ?? (out.blob ? await out.blob.arrayBuffer() : null);
    if (!buffer || buffer.byteLength === 0) throw new EngineError(summarizeStderr(result.stderr, result.exitCode), 'no-output');
    return new Uint8Array(buffer);
  }
}
