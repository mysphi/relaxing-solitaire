# Relaxing Solitaire

A calm game of Klondike solitaire for Android phones. It runs in the browser and installs to the home screen as an app (a Progressive Web App), then works offline.

## Play it

Open the GitHub Pages link on your phone in Chrome, then use the menu (⋮) and choose **Add to Home screen** or **Install app**.

## How it's built

Plain HTML, CSS and JavaScript. No framework and no build step, so there is nothing to install to work on it.

| File | What it does |
| --- | --- |
| `src/engine.js` | The game rules: dealing, legal moves, scoring, hints, auto-complete. No screen code. |
| `src/app.js` | The screen: draws the cards, handles taps and drags, animates moves, menus and settings. |
| `src/storage.js` | Saves the game, undo history, settings and score history on the phone. |
| `styles.css` | The Sage look from the agreed design. |
| `sw.js` | Offline support. Bump `VERSION` in it when files change so phones pick up updates. |
| `tests/engine.test.js` | Automated tests for the rules. |
| `.github/workflows/deploy.yml` | Runs the tests and publishes the site to GitHub Pages on every push to `main`. |

The rules are kept separate from the screen so that a Google Play version, or the next game, can reuse them.

## Working on it

- Run the tests: `npm test` (needs Node 20 or newer; nothing else to install).
- Try it locally: run any static file server in this folder, for example `python -m http.server`, and open `http://localhost:8000`.

## Scoring

- **Standard:** +5 for waste to column, +10 to a foundation, +5 for turning a card over, −15 for taking a card back off a foundation, −100 for recycling the stock (−20 in Draw 3). Never below zero.
- **Vegas:** starts at −52, +5 for each card on a foundation.
- **None:** no score shown.

There is no timer.
