# Notes for Claude

## User-facing text

Keep user-facing text in the app minimal. Don't add explanatory lines, taglines, subtitles, helper captions or reassurance copy (for example "Pick a game, play as long as you like" or "No ads, works offline") unless asked for. Show only the labels and information a screen needs to work. Comments and explanation in code are fine.

## Working on this repo

- Plain HTML, CSS and JavaScript, no build step. See README.md for the layout.
- When files change, bump `VERSION` in `sw.js` (and the matching "Version N" at the bottom of `index.html`) and list any new file in `APP_FILES`.
- Run `npm test` before pushing.
