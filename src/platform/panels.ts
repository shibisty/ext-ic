import { ext } from './browser';

export type ViewKind = 'popup' | 'sidepanel' | 'tab';

/** popup.html?view=tab is the "open in a tab" mode. */
export function detectView(doc: Document, search = location.search): ViewKind {
  if (doc.body.classList.contains('is-sidepanel')) return 'sidepanel';
  return new URLSearchParams(search).get('view') === 'tab' ? 'tab' : 'popup';
}

type PanelApi = typeof chrome & { sidebarAction?: { open(): Promise<void> } };

/**
 * Both chrome.sidePanel.open() and Firefox's sidebarAction.open() only work
 * while the click's user gesture is still active, i.e. they must be called
 * synchronously — no `await` before them. That's why the window id is
 * looked up ahead of time (see primeWindowId) instead of inside the handler.
 */
let cachedWindowId: number | undefined;

export async function primeWindowId(): Promise<void> {
  try { cachedWindowId = (await ext().windows.getCurrent()).id; } catch { /* Firefox sidebar has no windows API needs */ }
}

export function openSidePanel(): Promise<void> {
  const api = ext() as PanelApi;
  if (api.sidebarAction?.open) return api.sidebarAction.open();
  if (api.sidePanel?.open && cachedWindowId != null) return api.sidePanel.open({ windowId: cachedWindowId });
  return Promise.resolve();
}

export function openInTab(): void {
  void ext().tabs.create({ url: ext().runtime.getURL('popup.html?view=tab') });
}
