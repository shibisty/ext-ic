import { h } from '../dom';
import { formatBytes, formatTimeAgo } from '../../core/log';
import type { ViewContext } from '../context';

export function renderLogList(container: HTMLElement, ctx: ViewContext): void {
  const { t, s } = ctx;
  container.replaceChildren();
  if (!s.log.length) {
    container.appendChild(h('div', { className: 'queue-empty', textContent: t('noLogEntries') }));
    return;
  }
  for (const e of s.log) {
    container.appendChild(h('div', { className: 'preset-item' },
      h('div', { className: 'preset-item__info' },
        h('div', { className: 'preset-item__name' }, e.isZip && h('span', { className: 'preset-item__format', textContent: 'ZIP' }), e.name),
        h('div', { className: 'preset-item__meta', textContent: `${formatBytes(e.sizeBytes)} · ${formatTimeAgo(e.timestamp, s.lang)}` }),
        h('div', { className: 'log-item__path', title: e.savedAs, textContent: e.savedAs })),
      h('div', { className: 'preset-item__actions' },
        typeof e.downloadId === 'number' && ctx.canShowDownloads
          && h('button', { className: 'icon-btn', type: 'button', title: t('showInFolder'), textContent: '📂', on: { click: () => ctx.showDownload(e.downloadId!) } })),
    ));
  }
}
