/**
 * Types for the vendored KnicKnic wasm-imagemagick API (public/lib/…).
 * The real file is NOT bundled — see vite.config.ts (ic-vendor-external)
 * and src/platform/engine.ts. This path mirrors dist/<target>/lib/… as
 * seen from dist/<target>/assets/main.js.
 */
export interface MagickInputFile { name: string; content: Uint8Array }
export interface MagickOutputFile { name: string; buffer?: ArrayBuffer; blob?: Blob }
export interface MagickCallResult {
  outputFiles: MagickOutputFile[];
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
}
export function call(files: MagickInputFile[], argv: string[]): Promise<MagickCallResult>;
export function Call(files: MagickInputFile[], argv: string[]): Promise<MagickOutputFile[]>;
