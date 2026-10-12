/**
 * Background (Chrome: service worker, Firefox: event page).
 * Only owns the context menu; all conversion happens in the UI pages,
 * because the wasm worker and Blob URLs need a document.
 */
import { PENDING_KEY, type PendingImage } from '../platform/pending-image';

type Api = typeof chrome & { sidebarAction?: { open(): Promise<void> } };
const api: Api = ((globalThis as { browser?: Api }).browser ?? chrome) as Api;

const MENU_CONVERT = 'ic-convert-image';
const MENU_OPEN = 'ic-open-panel';

function msg(key: string, fallback: string): string {
  try { return api.i18n.getMessage(key) || fallback; } catch { return fallback; }
}

async function createMenus(): Promise<void> {
  // Promise form works in both Chrome MV3 and Firefox (browser.* has no callbacks).
  try { await api.contextMenus.removeAll(); } catch { /* none yet */ }
  api.contextMenus.create({ id: MENU_CONVERT, title: msg('contextMenuConvert', 'Convert with Image Converter'), contexts: ['image'] });
  api.contextMenus.create({ id: MENU_OPEN, title: msg('contextMenuOpenPanel', 'Open Image Converter panel'), contexts: ['action'] });
}

api.runtime.onInstalled.addListener(() => void createMenus());

if (api.sidePanel?.setPanelBehavior) {
  api.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
}

/**
 * Opens the panel SYNCHRONOUSLY (no await before it) so the context-menu
 * click still counts as a user gesture — otherwise Chrome rejects
 * sidePanel.open() and Firefox rejects sidebarAction.open().
 */
function openPanel(tab: chrome.tabs.Tab | undefined): void {
  try {
    if (api.sidebarAction?.open) {
      api.sidebarAction.open().catch(() => {});
    } else if (api.sidePanel?.open && tab?.windowId != null) {
      api.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  } catch { /* nothing more we can do */ }
}

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_CONVERT && info.srcUrl) {
    openPanel(tab);
    const pending: PendingImage = { url: info.srcUrl, ts: Date.now() };
    api.storage.local.set({ [PENDING_KEY]: pending }).catch(() => {});
  } else if (info.menuItemId === MENU_OPEN) {
    openPanel(tab);
  }
});
