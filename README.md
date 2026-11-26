# Fat Loss Tracker

Offline-first PWA for logging calories, protein, steps and workouts, showing today's net deficit and a rolling 7-day average.
Plain HTML/CSS/JS. All data stays in the browser's localStorage. This repo contains code only.

- `index.html`, `style.css`, `app.js`: the app
- `sw.js`: service worker (precaches every app file; cache-first)
- `manifest.json`, `icon-180.png`, `icon-512.png`
- `tools/make_icons.py`: regenerates the icons (Pillow)
- `tests/e2e.js`: Playwright end-to-end test, including offline (`node tests/e2e.js`)

When changing any app file, bump `CACHE_VERSION` in `sw.js` so installed copies pick up the update.
