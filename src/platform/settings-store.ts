import { ext } from './browser';
import {
  STORAGE_KEYS, changedSettingKeys, parseStoredSettings, toStorageRecord, type Settings,
} from '../core/settings';

export interface SettingsStore {
  load(): Promise<Settings>;
  save(partial: Partial<Settings>): Promise<void>;
  /** Called with fresh settings + which fields changed (from another view). */
  onExternalChange(cb: (next: Settings, changed: (keyof Settings)[]) => void): void;
}

export function createSettingsStore(navigatorLanguage = navigator.language): SettingsStore {
  return {
    async load() {
      try {
        const raw = await ext().storage.local.get([...STORAGE_KEYS]);
        return parseStoredSettings(raw, navigatorLanguage);
      } catch {
        return parseStoredSettings({}, navigatorLanguage);
      }
    },
    async save(partial) {
      try { await ext().storage.local.set(toStorageRecord(partial)); } catch { /* storage full/unavailable */ }
    },
    onExternalChange(cb) {
      ext().storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;
        const changed = changedSettingKeys(Object.keys(changes));
        if (!changed.length) return;
        const raw = await ext().storage.local.get([...STORAGE_KEYS]);
        cb(parseStoredSettings(raw, navigatorLanguage), changed);
      });
    },
  };
}
