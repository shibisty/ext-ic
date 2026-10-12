/**
 * The conversion pipeline the UI talks to. Routes each job to:
 *  - ImageMagick (wasm) for everything it can really write, or
 *  - ImageMagick → PNG → the browser's canvas encoder for formats IM lacks
 *    (WEBP in the bundled build),
 * falls back to browser decoding for inputs IM can't read (WEBP, AVIF…),
 * and verifies the output signature so a mislabeled file is never saved.
 */
import { MagickEngine, EngineError } from './engine';
import { createBrowserCodecs, type BrowserCodecs } from './browser-codecs';
import { buildConvertCommand, type ConvertOptions } from '../core/command';
import { buildCaps, outputMatchesFormat, parseFormatList, type EngineCaps } from '../core/capabilities';
import { OUTPUT_FORMATS, mimeFor, normalizeFormat } from '../core/formats';

export interface ConvertJob {
  bytes: Uint8Array;
  /** Original file extension (used by IM to pick the decoder). */
  inputExt: string;
  inputMime?: string;
  options: Omit<ConvertOptions, 'inputName'>;
}

export interface Converter {
  readonly caps: EngineCaps | null;
  init(): Promise<EngineCaps>;
  convert(job: ConvertJob): Promise<Uint8Array>;
}

/** Lossy WebP at quality 1.0 turns lossless in Chromium; keep lossy below it. */
const MAX_LOSSY = 0.99;

export class HybridConverter implements Converter {
  caps: EngineCaps | null = null;
  private initPromise: Promise<EngineCaps> | null = null;

  constructor(
    private readonly magick: Pick<MagickEngine, 'init' | 'run' | 'listFormats'> = new MagickEngine(),
    private readonly codecs: BrowserCodecs = createBrowserCodecs(),
    private readonly candidates: readonly string[] = OUTPUT_FORMATS,
  ) {}

  init(): Promise<EngineCaps> {
    this.initPromise ??= (async () => {
      await this.magick.init();
      let formats = null;
      try {
        const parsed = parseFormatList(await this.magick.listFormats());
        if (parsed.write.size) formats = parsed;
      } catch { /* old/odd build — trust the candidate list */ }
      const b = await this.codecs.probe();
      this.caps = buildCaps(this.candidates, formats, b.encoders, { browserDecode: b.canDecode, webpLossless: b.webpLossless });
      return this.caps;
    })().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  async convert(job: ConvertJob): Promise<Uint8Array> {
    const caps = this.caps ?? (await this.init());
    const fmt = normalizeFormat(job.options.outFormat);
    const route = caps.outputs.get(fmt);
    if (!route) throw new EngineError(`Output format ${fmt.toUpperCase()} is not supported`, 'unsupported', fmt);

    let out: Uint8Array;
    if (route === 'magick') {
      out = await this.runMagick(job, job.options);
    } else {
      const lossless = fmt === 'webp' && job.options.optim?.lossless === 'on';
      if (lossless && !caps.webpLossless) throw new EngineError('Lossless WebP is not available in this browser', 'webp-lossless');
      // Do all pixel work (orient, crop, resize) in IM, hand over a fast lossless PNG.
      const png = await this.runMagick(job, { ...job.options, outFormat: 'png', quality: null, optim: { mode: 'lossless', level: '1' } });
      const q = lossless ? 1 : Math.min(MAX_LOSSY, Math.max(1, Number(job.options.quality) || 90) / 100);
      out = await this.codecs.encode(png, mimeFor(fmt), q);
    }

    if (!outputMatchesFormat(fmt, out)) {
      throw new EngineError(`Output format ${fmt.toUpperCase()} is not supported`, 'unsupported', fmt);
    }
    return out;
  }

  /** IM run with a single retry through the browser decoder for unreadable inputs. */
  private async runMagick(job: ConvertJob, options: ConvertJob['options']): Promise<Uint8Array> {
    const ext = /^[a-z0-9]{1,8}$/.test(job.inputExt) ? job.inputExt : 'dat';
    const attempt = (bytes: Uint8Array, inputName: string) => {
      const cmd = buildConvertCommand({ ...options, inputName });
      return this.magick.run({ bytes, inputName, argv: cmd.argv, outName: cmd.outName });
    };
    try {
      return await attempt(job.bytes, `input.${ext}`);
    } catch (err) {
      if (!(err instanceof EngineError) || err.code === 'timeout' || !this.caps?.browserDecode) throw err;
      let png: Uint8Array;
      try {
        png = await this.codecs.decodeToPng(job.bytes, job.inputMime);
      } catch {
        throw err; // the browser can't read it either — report ImageMagick's error
      }
      return attempt(png, 'input.png');
    }
  }
}
