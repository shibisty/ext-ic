import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __TARGET__: JSON.stringify('chrome') },
  plugins: [
    {
      // The real wasm-imagemagick only exists in the built extension; unit
      // tests inject a fake loader, so a stub is enough here.
      name: 'magick-stub',
      enforce: 'pre',
      resolveId: (source) => (source.includes('lib/wasm-imagemagick/') ? '\0magick-stub' : null),
      load: (id) => (id === '\0magick-stub' ? 'export function call() { throw new Error("magick.wasm is not available in unit tests"); }' : null),
    },
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
