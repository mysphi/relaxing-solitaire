# Relaxing Games

Calm, ad-free games for Android phones, with no timers: **Solitaire** (Klondike) and **Mines** (a mine-clearing puzzle). It runs in the browser and installs to the home screen as one app (a Progressive Web App), then works offline.

Live: https://mysphi.github.io/relaxing-solitaire/

The app opens on a main menu where you pick a game. Inside a game, the house button (top right) or **Main Menu** in the game's menu takes you back. Each game saves as you go, so you can swap and carry on where you left off.

## Play it

Open the link on your phone in Chrome, then use the menu (⋮) and choose **Add to Home screen** or **Install app**.

## How it's built

Plain HTML, CSS and JavaScript. No framework and no build step, so there is nothing to install to work on it. Each game lives in its own folder and keeps its own saves, settings and history.

| Path | What it does |
| --- | --- |
| `index.html`, `menu.css`, `menu.js` | The main menu: pick a game, see which games are in progress. |
| `common/nav.js` | Shared by the games: the way back to the main menu. |
| `solitaire/` | Relaxing Solitaire: `src/engine.js` (rules), `src/app.js` (screen), `src/storage.js`, `src/sound.js`, `src/solver.js` + `src/winnable.js` (winnable deals), `tests/`, `tools/`. |
| `mines/` | Relaxing Mines: `src/engine.js` (rules), `src/solver.js` (no-guess boards and hints), `src/app.js`, `src/storage.js`, `tests/`. |
| `manifest.webmanifest`, `icons/` | The installed app's name and icon. |
| `sw.js` | Offline support for every game. Bump `VERSION` and list any new file in `APP_FILES` when files change. |
| `.github/workflows/deploy.yml` | Runs the tests and publishes the site to GitHub Pages on every push to `main`. |

The rules are kept separate from the screen so that a Google Play version, or the next game, can reuse them. A new game goes in its own folder with its own storage key, a button on the main menu, and the home button wired up with `setupHome` from `common/nav.js`.

## Working on it

- Run the tests: `npm test` (needs Node 20 or newer; nothing else to install).
- Try it locally: run any static file server in this folder, for example `python -m http.server`, and open `http://localhost:8000`.

## Solitaire scoring

- **Standard:** +5 for waste to column, +10 to a foundation, +5 for turning a card over, −15 for taking a card back off a foundation, −100 for recycling the stock (−20 in Draw 3). Never below zero.
- **Vegas:** starts at −52, +5 for each card on a foundation.
- **None:** no score shown.

There is no timer in any game.
