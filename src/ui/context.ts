import type { Settings, ItemOverrides } from '../core/settings';
import type { CropRect } from '../core/command';
import type { Preset } from '../core/presets';
import type { Translator } from '../i18n';
import type { QueueItem } from './types';

/** What views may read and call. Implemented by App (ui/app.ts). */
export interface ViewContext {
  readonly s: Settings;
  readonly t: Translator;
  readonly canShowDownloads: boolean;
  /** Output formats the engine can produce; null until the engine is ready. */
  readonly availableFormats: readonly string[] | null;
  /** Optimization fields that don't apply to how this format is produced. */
  hiddenOptimFields(format: string): string[];
  updateSettings(partial: Partial<Settings>): void;
  // queue
  toggleExpanded(item: QueueItem): void;
  updateOverrides(item: QueueItem, patch: Partial<ItemOverrides>, rerender?: boolean): void;
  setCrop(item: QueueItem, crop: CropRect | null): void;
  convertOne(item: QueueItem): void;
  download(item: QueueItem): void;
  remove(item: QueueItem): void;
  // presets / log
  editPreset(preset: Preset | null): void;
  deletePreset(preset: Preset): void;
  showDownload(id: number): void;
}
