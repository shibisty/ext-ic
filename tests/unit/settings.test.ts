import { describe, expect, it } from 'vitest';
import {
  changedSettingKeys, defaultOverrides, defaultSettings, detectLang, hasOverrides, parseStoredSettings,
  resolveItemSettings, toStorageRecord,
} from '../../src/core/settings';

describe('parseStoredSettings', () => {
  it('reads a v1.0 storage record (JSON strings, no ic_resize)', () => {
    const s = parseStoredSettings({
      ic_lang: 'ru', ic_theme: 'dark', ic_format: 'jpeg', ic_quality: 80,
      ic_optim: JSON.stringify({ png: { mode: 'lossless' } }),
      ic_presets: JSON.stringify([{ id: 'p3', name: 'Web', format: 'webp', quality: 75, resizeMode: 'none', resizeW: '', resizeH: '', optim: null }]),
      ic_saveFolder: 'Img', ic_askSaveLocation: true, ic_autozip: true,
      ic_log: JSON.stringify([{ id: 'l1', name: 'a.png', savedAs: 'a.png', sizeBytes: 1, downloadId: 1, isZip: false, timestamp: 1 }]),
    });
    expect(s.lang).toBe('ru');
    expect(s.theme).toBe('dark');
    expect(s.format).toBe('jpg');
    expect(s.quality).toBe(80);
    expect(s.optim.png).toMatchObject({ mode: 'lossless', level: '9' }); // merged over defaults
    expect(s.optim.jpg.progressive).toBe('on');
    expect(s.presets).toHaveLength(1);
    expect(s.saveFolder).toBe('Img');
    expect(s.askSaveLocation && s.autoZip).toBe(true);
    expect(s.log).toHaveLength(1);
    expect(s.resize).toEqual({ mode: 'none', w: '', h: '' });
  });

  it('survives garbage and falls back to defaults', () => {
    const s = parseStoredSettings({ ic_lang: 'de', ic_format: 'nope', ic_quality: 500, ic_optim: '{bad json', ic_presets: '"x"', ic_log: 42, ic_resize: { mode: 'weird' } }, 'en-US');
    expect(s).toEqual(defaultSettings('en-US'));
  });

  it('only restores an active profile that still exists', () => {
    const presets = JSON.stringify([{ id: 'p1', name: 'x', format: 'png', quality: 90, resizeMode: 'none', resizeW: '', resizeH: '', optim: null }]);
    expect(parseStoredSettings({ ic_presets: presets, ic_profile: 'p1' }).activeProfileId).toBe('p1');
    expect(parseStoredSettings({ ic_presets: presets, ic_profile: 'p9' }).activeProfileId).toBe('');
  });

  it('round-trips through toStorageRecord', () => {
    const s = { ...defaultSettings('ru'), format: 'webp', resize: { mode: 'percent' as const, w: '50', h: '' } };
    expect(parseStoredSettings(toStorageRecord(s), 'ru')).toEqual(s);
  });
});

describe('detectLang', () => {
  it('maps ru* to ru, everything else to en', () => {
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('uk-UA')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});

describe('resolveItemSettings', () => {
  const s = { ...defaultSettings(), format: 'png', quality: 90, resize: { mode: 'percent' as const, w: '50', h: '' } };

  it('inherits everything by default', () => {
    expect(resolveItemSettings(defaultOverrides(), s)).toEqual({
      format: 'png', quality: 90, resize: { mode: 'percent', percent: 50 }, crop: null, optim: s.optim.png,
    });
  });

  it('applies overrides and picks optim for the overridden format', () => {
    const r = resolveItemSettings({ ...defaultOverrides(), format: 'jpeg', quality: '70', resizeMode: 'exact', resizeW: '800', resizeH: '' }, s);
    expect(r.format).toBe('jpg');
    expect(r.quality).toBe(70);
    expect(r.resize).toEqual({ mode: 'exact', width: 800, height: 0 });
    expect(r.optim).toBe(s.optim.jpg);
  });

  it('"none" override disables the default resize', () => {
    expect(resolveItemSettings({ ...defaultOverrides(), resizeMode: 'none' }, s).resize).toBeNull();
  });

  it('formats without optimization get no optim', () => {
    expect(resolveItemSettings({ ...defaultOverrides(), format: 'gif' }, s).optim).toBeNull();
  });
});

describe('hasOverrides / changedSettingKeys', () => {
  it('detects any override', () => {
    expect(hasOverrides(defaultOverrides())).toBe(false);
    expect(hasOverrides({ ...defaultOverrides(), crop: { x: 0, y: 0, w: 1, h: 1 } })).toBe(true);
    expect(hasOverrides({ ...defaultOverrides(), quality: '80' })).toBe(true);
  });
  it('maps storage keys back to fields', () => {
    expect(changedSettingKeys(['ic_autozip', 'pendingImage', 'ic_resize'])).toEqual(['autoZip', 'resize']);
  });
});
