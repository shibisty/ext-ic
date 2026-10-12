import { describe, expect, it } from 'vitest';
import { newPresetId, summarizePreset, upsertPreset, type Preset } from '../../src/core/presets';
import { LOG_LIMIT, addLogEntry, formatBytes, formatSizeDelta, formatTimeAgo } from '../../src/core/log';
import { t } from '../../src/i18n';

const preset = (over: Partial<Preset> = {}): Preset => ({
  id: 'p1', name: 'Web', format: 'png', quality: 90, resizeMode: 'none', resizeW: '', resizeH: '',
  optim: { mode: 'lossy' }, ...over,
});

describe('presets', () => {
  it('newPresetId continues after the highest numeric id', () => {
    expect(newPresetId([])).toBe('p1');
    expect(newPresetId([preset({ id: 'p2' }), preset({ id: 'p10' })])).toBe('p11');
  });
  it('upsert replaces by id or appends', () => {
    const list = [preset()];
    expect(upsertPreset(list, preset({ name: 'X' }))).toEqual([preset({ name: 'X' })]);
    expect(upsertPreset(list, preset({ id: 'p2' }))).toHaveLength(2);
  });
  it('summary is localized', () => {
    expect(summarizePreset(preset({ resizeMode: 'exact', resizeW: '800' }), (k) => t('ru', k))).toBe('качество 90% · 800×? · С потерями (меньше цветов)');
    expect(summarizePreset(preset({ format: 'gif', optim: null }), (k) => t('en', k))).toBe('quality 90%');
  });
});

describe('log', () => {
  it('keeps newest first and caps the length', () => {
    let log = addLogEntry([], { name: 'a', savedAs: 'a', sizeBytes: 1, downloadId: 1, isZip: false, timestamp: 1 });
    for (let i = 0; i < LOG_LIMIT + 5; i++) log = addLogEntry(log, { name: `n${i}`, savedAs: '', sizeBytes: 0, downloadId: null, isZip: false, timestamp: i });
    expect(log).toHaveLength(LOG_LIMIT);
    expect(log[0]!.name).toBe(`n${LOG_LIMIT + 4}`);
    expect(new Set(log.map((e) => e.id)).size).toBe(LOG_LIMIT);
  });
  it('formats sizes, deltas and time', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
    expect(formatSizeDelta(1000, 250)).toBe('−75%');
    expect(formatSizeDelta(1000, 1120)).toBe('+12%');
    expect(formatTimeAgo(0, 'ru', 5 * 60_000)).toBe('5 мин назад');
    expect(formatTimeAgo(0, 'en', 30_000)).toBe('just now');
    expect(formatTimeAgo(0, 'en', 3 * 86_400_000)).toBe('3 d ago');
  });
});

describe('i18n', () => {
  it('falls back to English for missing keys and supports functions', () => {
    expect(t('ru', 'tabLog')).toBe('Журнал');
    expect(t('ru', 'filesCount', 3)).toBe('Файлов: 3');
    expect(t('en', 'no-such-key')).toBe('no-such-key');
  });
});
