import { optimFormatKey, type OptimValues } from './optim';
import type { ResizeMode } from './settings';

export interface Preset {
  id: string;
  name: string;
  format: string;
  quality: number;
  resizeMode: ResizeMode;
  resizeW: string;
  resizeH: string;
  optim: OptimValues | null;
}

export function newPresetId(existing: readonly Preset[]): string {
  let max = 0;
  for (const p of existing) {
    const n = Number(String(p.id).replace(/\D/g, '')) || 0;
    if (n > max) max = n;
  }
  return `p${max + 1}`;
}

export function upsertPreset(list: readonly Preset[], preset: Preset): Preset[] {
  const idx = list.findIndex((p) => p.id === preset.id);
  if (idx === -1) return [...list, preset];
  const copy = list.slice();
  copy[idx] = preset;
  return copy;
}

type T = (key: string) => string;

export function summarizePreset(preset: Preset, t: T): string {
  const parts = [`${t('presetQualityWord')} ${preset.quality}%`];
  if (preset.resizeMode === 'percent' && preset.resizeW) parts.push(`${preset.resizeW}%`);
  else if (preset.resizeMode === 'exact' && (preset.resizeW || preset.resizeH)) {
    parts.push(`${preset.resizeW || '?'}×${preset.resizeH || '?'}`);
  }
  const key = optimFormatKey(preset.format);
  if (preset.optim && key) {
    if (key === 'png') parts.push(preset.optim.mode === 'lossy' ? t('pngModeLossy') : t('pngModeLossless'));
    if (key === 'webp' && preset.optim.lossless === 'on') parts.push(t('webpLossless'));
    if (key === 'jpg' && preset.optim.progressive === 'on') parts.push(t('jpgProgressive'));
  }
  return parts.join(' · ');
}
