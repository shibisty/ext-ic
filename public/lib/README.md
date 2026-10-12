# wasm-imagemagick (vendored)

Files here are copied into the build **as-is** (they are not processed by Vite):

- `magickApi.js` — ES module API (`Call(inputFiles, argv)`)
- `magick.js` — emscripten glue, runs as a classic Web Worker
- `magick.wasm` — the ImageMagick binary

Source: https://github.com/KnicKnic/WASM-ImageMagick (https://knicknic.github.io/wasm-imagemagick/).

Why they must not be bundled: `magickApi.js` finds `magick.js`/`magick.wasm`
by reading its *own* URL from a stack trace and replacing the file name.
If a bundler inlines it into a chunk, the URL points at that chunk and the
worker can't be found. `src/platform/engine.ts` imports it at runtime by
absolute extension URL with `/* @vite-ignore */`.
