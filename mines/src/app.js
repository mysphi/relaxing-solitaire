// The screen: draws the board, handles taps and long-presses, menus and dialogs.
import {
  DIFFICULTIES, HIDDEN, FLAG, QUESTION, OPEN,
  newGame, tap, cycleMark, minesLeft, snapshot, restore, restart, findHint, isOver,
} from './engine.js';
import { load, save, fresh } from './storage.js';
import { setupHome } from '../../common/nav.js';

const LONG_PRESS_MS = 380;
const MOVE_SLOP = 10; // px a finger can drift before a press becomes a scroll
const MAX_UNDO = 1000;

const $ = (id) => document.getElementById(id);
const grid = $('grid');
const wrap = $('board-wrap');

const FLAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21V4" stroke="#22302A" stroke-width="2.2" stroke-linecap="round"/><path d="M7.5 4.5l11 4.2-11 4.3z" fill="var(--flag)"/></svg>';
const MINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.2" fill="#22302A"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5M5.3 5.3l2.5 2.5M16.2 16.2l2.5 2.5M18.7 5.3l-2.5 2.5M7.8 16.2l-2.5 2.5" stroke="#22302A" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="10" r="1.6" fill="#F3F1EA"/></svg>';

let st = load() || fresh();
let g = st.game;
if (!g || !DIFFICULTIES[g.difficulty]) g = st.game = newGame(st.settings.difficulty, { noGuess: st.settings.noGuess });

let cells = [];
let shown = []; // what each cell currently shows, so we only touch cells that changed
let hintCell = -1;
let hintTimer = 0;
let busy = false; // building a no-guess board
let statsTab = g.difficulty;

// ---------- Look ----------
function applyLook() {
  const a = st.settings.appearance;
  const root = document.documentElement;
  const dark = a === 'dark' || (a === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  if (st.settings.table === 'sage') delete root.dataset.table;
  else root.dataset.table = st.settings.table;
  const table = getComputedStyle(root).getPropertyValue('--table').trim();
  document.querySelector('meta[name=theme-color]').setAttribute('content', table);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyLook);

// ---------- Board layout ----------
function buildGrid() {
  const n = g.cols * g.rows;
  grid.innerHTML = '';
  cells = [];
  shown = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.className = 'cell';
    b.dataset.i = i;
    b.setAttribute('role', 'gridcell');
    grid.appendChild(b);
    cells.push(b);
    shown.push('');
  }
  grid.style.setProperty('--cols', g.cols);
  wrap.classList.toggle('scroll', g.rows > 20);
  sizeGrid();
}

function sizeGrid() {
  const easy = g.difficulty === 'easy';
  const gap = easy ? 4 : 2;
  const cs = getComputedStyle(wrap);
  const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let cell = Math.floor((w - (g.cols - 1) * gap) / g.cols);
  if (g.rows <= 20) cell = Math.min(cell, Math.floor((h - (g.rows - 1) * gap) / g.rows));
  else cell = Math.max(cell, 30); // Hard scrolls, so keep cells thumb-sized
  cell = Math.max(18, Math.min(cell, 64));
  grid.style.setProperty('--cell', cell + 'px');
  grid.style.setProperty('--gap', gap + 'px');
  grid.style.setProperty('--radius', (easy ? 9 : 6) + 'px');
  grid.style.setProperty('--font', Math.round(cell * 0.56) + 'px');
  grid.style.setProperty('--icon', Math.round(cell * 0.62) + 'px');
}
new ResizeObserver(() => sizeGrid()).observe(wrap);

// ---------- Drawing ----------
function render() {
  const n = g.cols * g.rows;
  for (let i = 0; i < n; i++) {
    const v = g.view[i];
    let key, cls = 'cell', html = '', label;
    const r = Math.floor(i / g.cols) + 1, c = (i % g.cols) + 1;
    if (v === OPEN) {
      if (g.mine[i]) { cls += ' open boom'; html = MINE_SVG; label = 'mine'; }
      else if (g.adj[i]) { cls += ' open n' + g.adj[i]; html = String(g.adj[i]); label = g.adj[i] + (g.adj[i] === 1 ? ' mine' : ' mines') + ' nearby'; }
      else { cls += ' open'; label = 'empty'; }
    } else if (v === FLAG) { cls += ' flag'; html = FLAG_SVG; label = 'flagged'; }
    else if (v === QUESTION) { cls += ' q'; html = '?'; label = 'question mark'; }
    else label = 'hidden';
    if (i === hintCell) cls += ' hint';
    key = cls + '|' + html;
    if (shown[i] !== key) {
      const b = cells[i];
      b.className = cls;
      b.innerHTML = html;
      b.setAttribute('aria-label', 'Row ' + r + ', column ' + c + ', ' + label);
      shown[i] = key;
    }
  }
  $('mines-left').textContent = minesLeft(g);
  $('moves').textContent = g.moves;
  $('moves-pill').hidden = !st.settings.showMoves;
  $('undo-btn').disabled = !st.undo.length || g.won;
  $('flag-btn').setAttribute('aria-pressed', String(st.flagMode));
  $('flag-label').textContent = st.flagMode ? 'Flag on' : 'Flag';
  const d = DIFFICULTIES[g.difficulty];
  $('board-label').textContent = d.name + ' · ' + g.cols + ' × ' + g.rows + ' · ' + (g.noGuess ? 'No-guess board' : 'Guessing allowed');
}

function persist() {
  st.game = g;
  save(st);
}

// ---------- Messages ----------
let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function buzz(ms) {
  if (st.settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* not supported */ }
  }
}

// ---------- Playing ----------
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function reveal(i) {
  if (busy) return;
  if (isOver(g)) { showEndDialog(); return; }
  const before = snapshot(g);
  if (!g.started && g.noGuess) {
    // Hard no-guess boards can take a moment to build on a phone.
    busy = true;
    grid.classList.add('thinking');
    await nextFrame();
  }
  const result = tap(g, i, { chording: st.settings.chording });
  busy = false;
  grid.classList.remove('thinking');
  if (result === 'none') return;
  st.undo.push(before);
  if (st.undo.length > MAX_UNDO) st.undo.shift();
  clearHint();
  render();
  if (result === 'lost') {
    buzz([30, 60, 30]);
    setTimeout(showEndDialog, 380);
  } else if (result === 'won') {
    recordFinish();
    celebrate(i);
    setTimeout(showEndDialog, 1000);
  }
  persist();
}

function mark(i) {
  if (busy) return;
  if (!cycleMark(g, i, { questionMarks: st.settings.questionMarks })) return;
  if (g.view[i] === FLAG) buzz(15);
  if (i === hintCell) clearHint();
  render();
  persist();
}

function celebrate(from) {
  const fr = Math.floor(from / g.cols), fc = from % g.cols;
  cells.forEach((b, i) => {
    const d = Math.abs(Math.floor(i / g.cols) - fr) + Math.abs((i % g.cols) - fc);
    b.style.setProperty('--d', d * 40 + 'ms');
    b.classList.add('cheer');
    shown[i] = '';
  });
  setTimeout(() => cells.forEach((b) => b.classList.remove('cheer')), 2500);
}

// Win or loss, counted once, and only for games without Undo or Restart.
function recordFinish() {
  if (g.recorded || g.usedUndo || !isOver(g)) return;
  g.recorded = true;
  const s = st.stats[g.difficulty];
  s.played++;
  if (g.won) {
    s.won++;
    if (s.best === null || g.moves < s.best) s.best = g.moves;
  }
  st.history.push({ d: g.difficulty, won: g.won, moves: g.moves, at: new Date().toISOString(), ng: g.noGuess });
}

function undo() {
  const s = st.undo.pop();
  if (!s) return;
  restore(g, s);
  clearHint();
  closeAll();
  render();
  persist();
}

function startNew(difficulty = st.settings.difficulty) {
  if (g.lost >= 0) recordFinish(); // a loss counts when you move on from it
  g = st.game = newGame(difficulty, { noGuess: st.settings.noGuess });
  st.undo = [];
  clearHint();
  closeAll();
  buildGrid();
  render();
  persist();
}

function inProgress() {
  return g.started && !isOver(g);
}

function askNew() {
  if (inProgress()) {
    confirmBox('Start a new game?', "This board will be lost and won't count in your stats.", 'New game', () => startNew());
  } else startNew();
}

function doRestart() {
  if (!g.started) { closeAll(); return; }
  confirmBox('Restart this board?', "You'll play the same board from the start. It won't count in your stats.", 'Restart', () => {
    restart(g);
    st.undo = [];
    clearHint();
    closeAll();
    render();
    persist();
  });
}

function clearHint() {
  if (hintCell >= 0) { hintCell = -1; }
  clearTimeout(hintTimer);
}

function hint() {
  if (busy || isOver(g)) return;
  const h = findHint(g);
  if (!h) return;
  hintCell = h.cell;
  if (h.kind === 'start') toast('Start anywhere. Your first tap is always safe.');
  else if (h.kind === 'wrongFlag') toast("This flag isn't on a mine.");
  else if (h.kind === 'free') toast("Nothing is certain here, so here's a safe cell.");
  render();
  cells[h.cell].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { hintCell = -1; render(); }, 2800);
}

// ---------- Touch: tap opens, long-press flags (swapped in Flag mode) ----------
let press = null;

function short(i) {
  if (st.flagMode && g.view[i] !== OPEN) mark(i);
  else reveal(i);
}
function long(i) {
  if (st.flagMode) reveal(i);
  else mark(i);
}

grid.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.cell');
  if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const i = Number(b.dataset.i);
  press = { i, x: e.clientX, y: e.clientY, id: e.pointerId, long: false, b };
  b.classList.add('pressed');
  press.timer = setTimeout(() => {
    if (!press || press.i !== i) return;
    press.long = true;
    b.classList.remove('pressed');
    long(i);
  }, LONG_PRESS_MS);
});
grid.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_SLOP) cancelPress();
});
grid.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.id) return;
  const p = press;
  cancelPress();
  if (!p.long) short(p.i);
});
grid.addEventListener('pointercancel', cancelPress);
grid.addEventListener('contextmenu', (e) => e.preventDefault());
// Keyboard: Enter/Space opens (or flags in Flag mode), F flags.
grid.addEventListener('click', (e) => {
  const b = e.target.closest('.cell');
  if (b && e.detail === 0) short(Number(b.dataset.i));
});
grid.addEventListener('keydown', (e) => {
  const b = e.target.closest('.cell');
  if (b && (e.key === 'f' || e.key === 'F')) mark(Number(b.dataset.i));
});
function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.b.classList.remove('pressed');
  press = null;
}

// ---------- Overlays ----------
const overlays = ['menu', 'confirm', 'lost', 'won', 'settings', 'stats', 'howto'];
function open(id) {
  overlays.forEach((o) => { $(o).hidden = o !== id; });
}
function closeAll() {
  overlays.forEach((o) => { $(o).hidden = true; });
}

let confirmAction = null;
function confirmBox(title, text, ok, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = ok;
  confirmAction = action;
  open('confirm');
}

function showEndDialog() {
  if (g.lost >= 0) {
    $('lost-note').textContent = g.usedUndo ? '' : "Games where you use Undo don't count towards your stats.";
    open('lost');
  } else if (g.won) {
    const d = DIFFICULTIES[g.difficulty];
    $('won-text').textContent = d.name + ' cleared in ' + g.moves + (g.moves === 1 ? ' move.' : ' moves.');
    const best = st.stats[g.difficulty].best;
    $('won-best').textContent = g.usedUndo
      ? 'You used Undo, so this one is just for fun.'
      : (best === g.moves ? 'Your fewest moves on ' + d.name + '!' : 'Your fewest moves on ' + d.name + ': ' + best);
    open('won');
  }
}

$('menu-btn').addEventListener('click', () => open('menu'));
$('mines-pill').addEventListener('click', () => openStats());
$('moves-pill').addEventListener('click', () => openStats());
$('undo-btn').addEventListener('click', undo);
$('hint-btn').addEventListener('click', hint);
$('new-btn').addEventListener('click', askNew);
$('flag-btn').addEventListener('click', () => {
  st.flagMode = !st.flagMode;
  toast(st.flagMode ? 'Flag mode on: tap flags, long-press opens.' : 'Flag mode off: tap opens, long-press flags.');
  render();
  persist();
});

$('menu').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (e.target === $('menu') || a === 'resume') closeAll();
  else if (a === 'new') askNew();
  else if (a === 'restart') doRestart();
  else if (a === 'stats') openStats();
  else if (a === 'settings') openSettings();
  else if (a === 'howto') open('howto');
});
$('confirm').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'ok') { const f = confirmAction; confirmAction = null; f && f(); }
  else if (a === 'cancel' || e.target === $('confirm')) { confirmAction = null; closeAll(); }
});
$('lost').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'undo') undo();
  else if (a === 'new') startNew();
});
$('won').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'new') startNew();
  else if (a === 'stats') openStats();
});
for (const id of ['settings', 'stats', 'howto']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === $(id) || e.target.closest('[data-action=close]')) closeAll();
  });
}

// ---------- Settings ----------
function openSettings() {
  syncSettings();
  open('settings');
}
function syncSettings() {
  const s = st.settings;
  document.querySelectorAll('#settings [data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!s[key];
    else el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(s[key]))));
  });
}
$('settings').addEventListener('change', (e) => {
  const key = e.target.dataset.setting;
  if (!key) return;
  st.settings[key] = e.target.checked;
  // A board that hasn't been started yet picks up the no-guess change straight away.
  if (key === 'noGuess' && !g.started) g.noGuess = st.settings.noGuess;
  render();
  persist();
});
$('settings').addEventListener('click', (e) => {
  const b = e.target.closest('[data-setting] button');
  if (!b) return;
  const key = b.closest('[data-setting]').dataset.setting;
  const value = b.dataset.value;
  if (key === 'difficulty') {
    if (value === g.difficulty) return;
    const name = DIFFICULTIES[value].name;
    const go = () => { st.settings.difficulty = value; startNew(value); toast('New ' + name + ' board'); };
    if (inProgress()) confirmBox('Start a new ' + name + ' board?', "Your current board will be lost and won't count in your stats.", 'New board', go);
    else go();
    return;
  }
  st.settings[key] = value;
  applyLook();
  syncSettings();
  persist();
});

// ---------- Stats ----------
function openStats() {
  statsTab = g.difficulty;
  drawStats();
  open('stats');
}
$('stats-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  statsTab = b.dataset.value;
  drawStats();
});
function when(iso) {
  const d = new Date(iso), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function drawStats() {
  document.querySelectorAll('#stats-tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === statsTab)));
  const s = st.stats[statsTab];
  const rate = s.played ? Math.round((s.won / s.played) * 100) + '%' : '–';
  const tiles = [[s.played, 'Played'], [s.won, 'Won'], [rate, 'Win rate'], [s.best ?? '–', 'Fewest moves']];
  $('stat-grid').innerHTML = tiles.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  const games = st.history.filter((h) => h.d === statsTab).slice().reverse();
  const list = $('history-list');
  if (!games.length) {
    list.innerHTML = '<li class="history-empty">No finished games yet. They\'ll show here.</li>';
    return;
  }
  const tick = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const mine = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  list.innerHTML = games.map((h) => `<li>
      <span class="dot${h.won ? '' : ' lost'}">${h.won ? tick : mine}</span>
      <span class="what"><b>${h.won ? 'Cleared' : 'Hit a mine'}</b><span>${when(h.at)}${h.ng === false ? ' · guessing allowed' : ''}</span></span>
      <span class="moves">${h.moves} ${h.moves === 1 ? 'move' : 'moves'}</span>
    </li>`).join('');
}

// ---------- Start ----------
setupHome({ game: 'mines', save: persist });
applyLook();
buildGrid();
render();
if (isOver(g)) showEndDialog();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(() => { /* offline support is a bonus */ });
}
