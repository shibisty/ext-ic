/**
 * The browser's own image codecs, used where the bundled ImageMagick has
 * no coder: WEBP output (canvas encoder) and decoding inputs IM can't read
 * (WEBP, AVIF, and whatever else the browser understands).
 */
export interface BrowserCodecs {
  probe(): Promise<{ encoders: Set<string>; webpLossless: boolean; canDecode: boolean }>;
  /** Encodes PNG bytes into `mime`. quality ∈ (0, 1]. */
  encode(png: Uint8Array, mime: string, quality: number): Promise<Uint8Array>;
  /** Decodes anything the browser can display into PNG bytes. */
  decodeToPng(bytes: Uint8Array, mime?: string): Promise<Uint8Array>;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));
}

async function draw(bytes: Uint8Array, mime?: string): Promise<AnyCanvas> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], mime ? { type: mime } : undefined));
  const c = makeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

const ENCODER_PROBES: [format: string, mime: string][] = [['webp', 'image/webp'], ['avif', 'image/avif'], ['jxl', 'image/jxl']];

export function createBrowserCodecs(): BrowserCodecs {
  let probed: ReturnType<BrowserCodecs['probe']> | null = null;
  return {
    probe() {
      probed ??= (async () => {
        const encoders = new Set<string>();
        let webpLossless = false;
        const canDecode = typeof createImageBitmap === 'function';
        try {
          const c = makeCanvas(2, 2);
          const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
          ctx?.fillRect(0, 0, 1, 1);
          for (const [fmt, mime] of ENCODER_PROBES) {
            // An unsupported type silently falls back to PNG — check the result type.
            const blob = await toBlob(c, mime, 0.8);
            if (blob.type === mime) encoders.add(fmt);
          }
          if (encoders.has('webp')) {
            const lossless = new Uint8Array(await (await toBlob(c, 'image/webp', 1)).arrayBuffer());
            webpLossless = String.fromCharCode(...lossless.subarray(0, 64)).includes('VP8L');
          }
        } catch { /* no canvas — magick only */ }
        return { encoders, webpLossless, canDecode };
      })();
      return probed;
    },
    async encode(png, mime, quality) {
      const c = await draw(png, 'image/png');
      const blob = await toBlob(c, mime, Math.min(1, Math.max(0.01, quality)));
      if (blob.type !== mime) throw new Error(`This browser cannot encode ${mime}`);
      return new Uint8Array(await blob.arrayBuffer());
    },
    async decodeToPng(bytes, mime) {
      const c = await draw(bytes, mime);
      return new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer());
    },
  };
}
