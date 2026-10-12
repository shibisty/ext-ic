# Image Converter (ImageMagick WASM)

Расширение для Chrome и Firefox: локальная конвертация изображений между форматами,
ресайз, обрезка, сжатие PNG/JPG/WebP, пресеты, ZIP-выгрузка. Всё считается в браузере —
ни один файл никуда не отправляется.

## Быстрый старт

```bash
npm install
npm run build          # dist/chrome и dist/firefox
```

- **Chrome:** `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → `dist/chrome`.
- **Firefox (140+):** `about:debugging#/runtime/this-firefox` → «Загрузить временное дополнение» → `dist/firefox/manifest.json`.

Во время разработки: `npm run dev` (Chrome) / `npm run dev:firefox` — пересборка при сохранении,
затем ⟳ на карточке расширения.

## Команды

| Команда | Что делает |
|---|---|
| `npm run build` | сборка обоих таргетов |
| `npm run typecheck` | `tsc --noEmit` (исходники + тесты) |
| `npm test` | unit + UI-тесты (Vitest, jsdom) |
| `npm run test:e2e` | сборка Chrome + Playwright: реальный `magick.wasm` в Chromium |
| `npm run check` | typecheck + тесты + сборка |
| `npm run zip` | `release/` — ZIP для Chrome Web Store, AMO и ZIP исходников для ревью AMO |

Для e2e один раз: `npx playwright install chromium`.

## Структура

```
src/
  manifest.ts            манифест для обоих браузеров (генерируется при сборке)
  background/index.ts    контекстное меню, открытие панели
  core/                  чистая логика без DOM и chrome.* — покрыта unit-тестами
  platform/              chrome.*, IndexedDB, wasm-движок, кодеки браузера
  ui/                    контроллер App + представления (views/)
  i18n/                  строки EN/RU
  popup.html, sidepanel.html
public/
  lib/wasm-imagemagick/  вендорный движок — копируется как есть, НЕ бандлится
  _locales/, icons/
tests/
  unit/                  Vitest
  e2e/convert.e2e.mjs    Playwright
```

Подробности и предложения по развитию — в [ARCHITECTURE.md](ARCHITECTURE.md).
