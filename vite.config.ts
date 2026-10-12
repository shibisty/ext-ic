import { defineConfig, build, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildManifest, type Target } from './src/manifest';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function resolveTarget(mode: string): Target {
  return mode === 'firefox' ? 'firefox' : 'chrome';
}

/** Emits manifest.json for the current target. */
function manifestPlugin(target: Target): Plugin {
  return {
    name: 'ic-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(buildManifest(target, pkg.version), null, 2) + '\n',
      });
    },
  };
}

/**
 * The vendored wasm-imagemagick files are copied from public/ verbatim and
 * imported at runtime; keep the import specifier exactly as written.
 */
function vendorExternalPlugin(): Plugin {
  return {
    name: 'ic-vendor-external',
    enforce: 'pre',
    resolveId(source) {
      if (source.includes('lib/wasm-imagemagick/')) return { id: source, external: 'absolute' };
      return null;
    },
  };
}

/**
 * The background script is built separately as one self-contained IIFE:
 * Chrome's service worker and Firefox's background.scripts must not share
 * ES chunks with the UI pages.
 */
function backgroundPlugin(target: Target, outDir: string): Plugin {
  return {
    name: 'ic-background',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        define: { __TARGET__: JSON.stringify(target) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          sourcemap: false,
          lib: {
            entry: resolve(__dirname, 'src/background/index.ts'),
            formats: ['iife'],
            name: 'icBackground',
            fileName: () => 'background.js',
          },
        },
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = resolveTarget(mode);
  const outDir = resolve(__dirname, 'dist', target);
  return {
    root: resolve(__dirname, 'src'),
    publicDir: resolve(__dirname, 'public'),
    base: './',
    define: { __TARGET__: JSON.stringify(target) },
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      minify: false,
      sourcemap: false,
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/popup.html'),
          sidepanel: resolve(__dirname, 'src/sidepanel.html'),
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    plugins: [vendorExternalPlugin(), manifestPlugin(target), backgroundPlugin(target, outDir)],
  };
});
