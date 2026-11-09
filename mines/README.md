# Relaxing Mines

A calm, ad-free mine-clearing puzzle for phones, with no timer. It's an installable web app (PWA) hosted on GitHub Pages, and it works offline once installed.

Live: https://mysphi.github.io/relaxing-mines/

## How it's built

Plain HTML, CSS and JavaScript, with no build step and nothing to install.

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | The screen and the Sage look (light, dark and four board colours) |
| `src/engine.js` | Game rules: boards, opening cells, flags, chording, undo, hints |
| `src/solver.js` | Logic solver used for no-guessing boards and hints |
| `src/app.js` | Touch handling, menus, settings, stats and history |
| `src/storage.js` | Saves the game, settings and stats on the phone (nothing leaves the device) |
| `sw.js` | Offline support. Bump `VERSION` whenever files change |
| `tests/` | Rule tests, run with `npm test` (Node 22) |

Every push to `main` runs the tests in GitHub Actions and, if they pass, deploys to GitHub Pages.
