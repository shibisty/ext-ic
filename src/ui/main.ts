/** Entry point for popup.html and sidepanel.html. */
import '../app.css';
import { App } from './app';
import { ext } from '../platform/browser';
import { createSettingsStore } from '../platform/settings-store';
import { createQueueRepo } from '../platform/queue-db';
import { HybridConverter } from '../platform/converter';
import { createDownloader } from '../platform/downloads';
import { detectView, openInTab, openSidePanel, primeWindowId } from '../platform/panels';
import { PENDING_KEY } from '../platform/pending-image';

const view = detectView(document);
if (view === 'popup') void primeWindowId();

const app = new App({
  doc: document,
  view,
  settings: createSettingsStore(),
  queue: createQueueRepo(),
  engine: new HybridConverter(),
  downloads: createDownloader(),
  channel: new BroadcastChannel('ic-queue'),
  openSidePanel,
  openInTab,
  onPendingImage(cb) {
    ext().storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[PENDING_KEY]?.newValue) cb();
    });
  },
});

void app.init();

// Handy for debugging from DevTools.
(globalThis as { icApp?: App }).icApp = app;
