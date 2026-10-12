/**
 * Single source of truth for manifest.json. vite.config.ts calls
 * buildManifest(target) and emits the result into dist/<target>/.
 *
 * Differences between targets:
 *  - Chrome: MV3 service worker + chrome.sidePanel.
 *  - Firefox: MV3 event page (background.scripts — Firefox does not run
 *    `service_worker`) + sidebar_action; no "sidePanel" permission.
 */
export type Target = 'chrome' | 'firefox';

const ICONS = {
  '16': 'icons/icon16.png',
  '32': 'icons/icon32.png',
  '48': 'icons/icon48.png',
  '128': 'icons/icon128.png',
} as const;

export function buildManifest(target: Target, version: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    manifest_version: 3,
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    version,
    default_locale: 'en',
    icons: ICONS,
    action: {
      default_popup: 'popup.html',
      default_icon: ICONS,
      default_title: '__MSG_extName__',
    },
    permissions: ['storage', 'downloads', 'contextMenus'],
    // Only needed to fetch an image picked via the right-click menu when the
    // site doesn't send CORS headers. Requested per-origin at click time.
    optional_host_permissions: ['<all_urls>'],
    content_security_policy: {
      // 'wasm-unsafe-eval' is required to instantiate magick.wasm.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  };

  if (target === 'chrome') {
    return {
      ...base,
      minimum_chrome_version: '116',
      permissions: [...(base.permissions as string[]), 'sidePanel'],
      background: { service_worker: 'background.js' },
      side_panel: { default_path: 'sidepanel.html' },
    };
  }

  return {
    ...base,
    background: { scripts: ['background.js'] },
    sidebar_action: {
      default_panel: 'sidepanel.html',
      default_icon: { '16': ICONS['16'], '32': ICONS['32'] },
      default_title: '__MSG_extName__',
      open_at_install: false,
    },
    browser_specific_settings: {
      gecko: {
        id: 'image-converter-magick@example.local',
        strict_min_version: '140.0', // ESR 140; needed for data_collection_permissions
        // Nothing leaves the device: conversion is local, no telemetry.
        data_collection_permissions: { required: ['none'] },
      },
    },
  };
}
