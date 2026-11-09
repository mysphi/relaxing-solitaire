// Main menu: show where each saved game is up to. Reads the games' own saves; never changes them.

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

function solitaireStatus() {
  const g = read('calm-solitaire-v1')?.game;
  if (!g || !g.foundations || g.foundations.every((p) => p.length === 13)) return null;
  if (!g.moves) return null;
  return 'In progress · ' + plural(g.moves, 'move');
}

function minesStatus() {
  const g = read('relaxing-mines-v1')?.game;
  if (!g || !g.started || g.won || g.lost >= 0) return null;
  const level = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[g.difficulty] || '';
  return level + ' · ' + plural(g.moves, 'move');
}

function showStatus() {
  const s = solitaireStatus();
  const m = minesStatus();
  for (const [id, text] of [['solitaire-status', s], ['mines-status', m]]) {
    const el = document.getElementById(id);
    el.textContent = text || '';
    el.hidden = !text;
  }
}

showStatus();

// Open a game in place of the menu, so there is only ever one screen to go back from.
document.querySelectorAll('a.game').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  location.replace(a.href);
}));
// Coming back from a game with the Back button can reuse this page, so refresh then too.
window.addEventListener('pageshow', showStatus);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
