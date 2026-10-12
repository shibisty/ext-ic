import { h } from '../dom';

export interface Modal {
  overlay: HTMLDivElement;
  modal: HTMLDivElement;
  close(): void;
}

const openModals: Modal[] = [];

/** Overlay + dialog box; closes on backdrop click and Escape. */
export function openModal(title: string, extraClass = ''): Modal {
  const modal = h('div', { className: `crop-modal ${extraClass}`.trim() }, h('div', { className: 'crop-modal__title', textContent: title }));
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const overlay = h('div', { className: 'crop-overlay' }, modal);
  const m: Modal = {
    overlay,
    modal,
    close() {
      overlay.remove();
      const i = openModals.indexOf(m);
      if (i !== -1) openModals.splice(i, 1);
    },
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) m.close(); });
  document.body.appendChild(overlay);
  openModals.push(m);
  return m;
}

/** Closes the top-most modal; returns false if none was open. */
export function closeTopModal(): boolean {
  const m = openModals[openModals.length - 1];
  if (!m) return false;
  m.close();
  return true;
}

/**
 * In-page replacement for window.confirm(), which doesn't work in Firefox
 * popups/sidebars and blocks the page in Chrome.
 */
export function confirmDialog(opts: { title: string; message: string; ok: string; cancel: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const m = openModal(opts.title);
    let done = false;
    const finish = (v: boolean) => { if (done) return; done = true; m.close(); resolve(v); };
    const observer = new MutationObserver(() => { if (!m.overlay.isConnected) { observer.disconnect(); finish(false); } });
    observer.observe(document.body, { childList: true });
    const ok = h('button', { className: 'btn btn-primary btn-danger', textContent: opts.ok, on: { click: () => finish(true) } });
    m.modal.append(
      h('div', { className: 'crop-modal__note', textContent: opts.message }),
      h('div', { className: 'crop-actions' },
        h('button', { className: 'btn btn-ghost', textContent: opts.cancel, on: { click: () => finish(false) } }),
        ok),
    );
    ok.focus();
  });
}
