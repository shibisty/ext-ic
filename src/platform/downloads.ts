import { ext } from './browser';

export interface Downloader {
  /** Saves a blob; returns the browser download id when available. */
  save(blob: Blob, filename: string, saveAs: boolean): Promise<number | null>;
  canShow(): boolean;
  show(downloadId: number): void;
}

function anchorDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split('/').pop() || filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function createDownloader(): Downloader {
  return {
    async save(blob, filename, saveAs) {
      const url = URL.createObjectURL(blob);
      // Revoke late: the download manager reads the blob asynchronously.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const downloads = ext().downloads;
      if (downloads?.download) {
        try {
          const id = await downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
          return typeof id === 'number' ? id : null;
        } catch (err) {
          // User cancelled the Save As dialog → don't fall back to a second download.
          if (/cancel/i.test(String((err as Error)?.message ?? err))) return null;
        }
      }
      anchorDownload(url, filename);
      return null;
    },
    canShow: () => typeof ext().downloads?.show === 'function',
    show(id) {
      try { ext().downloads.show(id); } catch { /* removed from history */ }
    },
  };
}
