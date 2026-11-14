// The screen: draws the tray and blocks, handles dragging and tapping, menus and dialogs.
import {
  DIFFICULTIES, newGame, move, slideRange, snapshot, restore, restart, hint as findHint, unpack, pack,
} from './engine.js';
import { BANK } from './bank.js';
import { load, save, fresh, LEVELS } from './storage.js';
import * as sound from './sound.js';
import { setupHome } from '../../common/nav.js';

const MAX_UNDO = 1000;
const READY_EACH = 2; // fresh puzzles kept ready per level
const DRAG_SLOP = 6; // px a finger moves before a press becomes a drag

const $ = (id) => document.getElementById(id);
const tray = $('tray');
const wrap = $('board-wrap');
const blocksEl = $('blocks');

let st = load() || fresh();
let g = st.game;

let els = []; // one button per block
let cellPx = 50, gapPx = 4, padPx = 10;
let selected = -1; // tap-to-move: the block picked first
let hinting = false;
let celebrating = false;
let statsTab = 'medium';

// ---------- Puzzles: ready-made in the background, with a small built-in bank to fall back on ----------
const usesWalls = (level) => st.settings.walls && DIFFICULTIES[level].walls > 0;
const readyKey = (level, walls = usesWalls(level)) => level + (walls ? '-walls' : '');

function takePuzzle(level) {
  const key = readyKey(level);
  const list = st.ready[key] || [];
  if (list.length) {
    const p = unpack(list.shift());
    st.ready[key] = list;
    return p;
  }
  const bank = BANK[key];
  const avoid = g ? pack(g) : '';
  const choices = bank.filter((t) => t.split(';').slice(2).join(';') !== avoid.split(';').slice(2).join(';'));
  return unpack(choices[Math.floor(Math.random() * choices.length)] || bank[0]);
}

let worker = null;
let working = false;
function topUp() {
  if (working) return;
  // The level being played first, then the others, so switching level is instant too.
  const order = [st.settings.difficulty, ...LEVELS.filter((l) => l !== st.settings.difficulty)];
  const level = order.find((l) => (st.ready[readyKey(l)] || []).length < (l === st.settings.difficulty ? READY_EACH : 1));
  if (!level) return;
  try {
    if (!worker) {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        working = false;
        const { level: l, walls, puzzle } = e.data;
        const key = readyKey(l, walls);
        (st.ready[key] ||= []).push(pack(puzzle));
        persist();
        setTimeout(topUp, 400);
      };
      worker.onerror = () => { working = false; worker = null; };
    }
    working = true;
    worker.postMessage({ level, walls: usesWalls(level) });
  } catch {
    working = false; // no workers here: the bank keeps puzzles coming
  }
}

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

// ---------- Board ----------
const step = () => cellPx + gapPx;
const posPx = (b, p) => (b.dir === 'h'
  ? [padPx + p * step(), padPx + b.r * step()]
  : [padPx + b.c * step(), padPx + p * step()]);

function buildBoard() {
  const { size, walls, blocks, exitRow } = g.board;
  const cells = $('cells');
  cells.innerHTML = '';
  for (let i = 0; i < size * size; i++) {
    const d = document.createElement('div');
    if (walls.includes(i)) d.className = 'wall';
    cells.appendChild(d);
  }
  blocksEl.innerHTML = '';
  els = blocks.map((b, i) => {
    const el = document.createElement('button');
    el.className = `block ${b.dir} t${b.key ? 0 : b.tone}`;
    el.dataset.i = i;
    el.style.setProperty('--knot', 20 + ((i * 37) % 60) + '%');
    el.setAttribute('aria-label', b.key ? 'Red block' : (b.dir === 'h' ? 'Block lying across' : 'Block standing up'));
    blocksEl.appendChild(el);
    return el;
  });
  tray.style.setProperty('--size', size);
  selected = -1;
  sizeBoard();
  $('exit').dataset.row = exitRow;
}

function sizeBoard() {
  if (!g) return;
  const { size, exitRow, blocks } = g.board;
  const cs = getComputedStyle(wrap);
  const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2 * 8 - 2 * 10; // rims, room for the gap to show
  const h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 2 * 8;
  gapPx = size === 7 ? 4 : 5;
  padPx = 10;
  const fit = Math.min(w, h) - 2 * padPx - (size - 1) * gapPx;
  cellPx = Math.max(28, Math.min(76, Math.floor(fit / size)));
  const inner = size * cellPx + (size - 1) * gapPx + 2 * padPx;
  tray.style.setProperty('--inner', inner + 'px');
  tray.style.setProperty('--cell', cellPx + 'px');
  tray.style.setProperty('--gap', gapPx + 'px');
  tray.style.setProperty('--pad', padPx + 'px');
  const top = padPx + exitRow * step();
  Object.assign($('exit').style, { top: top + 'px', height: cellPx + 'px' });
  blocks.forEach((b, i) => {
    const el = els[i];
    el.style.width = (b.dir === 'h' ? b.len * cellPx + (b.len - 1) * gapPx : cellPx) + 'px';
    el.style.height = (b.dir === 'v' ? b.len * cellPx + (b.len - 1) * gapPx : cellPx) + 'px';
  });
  place(true);
}
new ResizeObserver(() => sizeBoard()).observe(wrap);

// Put every block where the game says it is (animated unless instant).
function place(instant = false) {
  g.board.blocks.forEach((b, i) => {
    const el = els[i];
    if (instant) el.style.transition = 'none';
    const [x, y] = posPx(b, g.pos[i]);
    el.style.transform = `translate(${x}px, ${y}px)`;
    if (instant) { el.offsetWidth; el.style.transition = ''; }
  });
}

function render() {
  $('moves').textContent = g.moves;
  $('par').textContent = g.par;
  $('moves-pill').hidden = !st.settings.showMoves;
  $('par-pill').hidden = !st.settings.showMoves;
  $('undo-btn').disabled = !st.undo.length || g.won;
  $('hint-btn').disabled = g.won;
  $('board-label').textContent = DIFFICULTIES[g.level].name;
  els.forEach((el, i) => el.classList.toggle('selected', i === selected));
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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function buzz(ms) {
  if (st.settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* not supported */ }
  }
}

// ---------- Playing ----------
function doMove(i, p) {
  const before = snapshot(g);
  const result = move(g, i, p);
  if (result === 'none') { place(); return; }
  st.undo.push(before);
  if (st.undo.length > MAX_UNDO) st.undo.shift();
  selected = -1;
  sound.slide();
  buzz(8);
  place();
  render();
  if (result === 'won') solved();
  persist();
}

function solved() {
  recordFinish();
  celebrating = true;
  const k = g.board.blocks.findIndex((b) => b.key);
  const key = els[k];
  // The red block slides on out through the gap.
  setTimeout(() => {
    const b = g.board.blocks[k];
    const [x, y] = posPx(b, g.pos[k] + b.len + 1);
    key.style.transition = 'transform 420ms cubic-bezier(0.4, 0, 0.6, 1), opacity 420ms ease 120ms';
    key.style.transform = `translate(${x}px, ${y}px)`;
    key.classList.add('gone');
    sound.win();
    buzz([12, 50, 12]);
    els.forEach((el, i) => {
      if (i === k) return;
      const bi = g.board.blocks[i];
      const d = Math.abs(bi.r - b.r) + Math.abs(bi.c - g.board.size);
      el.style.setProperty('--d', d * 45 + 'ms');
      el.classList.add('cheer');
    });
  }, 160);
  setTimeout(() => { celebrating = false; showWon(); }, 1150);
}

// Counted once, and only when no hint was used.
function recordFinish() {
  if (g.recorded || g.usedHint || !g.won) return;
  g.recorded = true;
  const s = st.stats[g.level];
  const over = g.moves - g.par;
  s.solved++;
  s.over += over;
  if (over === 0) {
    s.atPar++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
  } else s.streak = 0;
  st.history.push({ d: g.level, moves: g.moves, par: g.par, at: new Date().toISOString() });
}

function showWon() {
  $('won-text').textContent = g.moves + (g.moves === 1 ? ' move' : ' moves') + ' · Par ' + g.par;
  $('won-note').textContent = g.usedHint ? "You used a hint, so this one isn't in your stats." : '';
  open('won');
}

function undo() {
  if (hinting || celebrating) return;
  const s = st.undo.pop();
  if (!s) return;
  restore(g, s);
  selected = -1;
  closeAll();
  place();
  render();
  persist();
}

function startNew(level = st.settings.difficulty) {
  g = st.game = newGame(level, takePuzzle(level));
  st.undo = [];
  closeAll();
  buildBoard();
  render();
  persist();
  topUp();
}

const inProgress = () => g.moves > 0 && !g.won;

function askNew() {
  if (inProgress()) confirmBox('Start a new puzzle?', "This puzzle won't be finished.", 'New puzzle', () => startNew());
  else startNew();
}

function doRestart() {
  if (!g.moves && !g.won) { closeAll(); return; }
  confirmBox('Restart this puzzle?', 'The blocks go back to where they started.', 'Restart', () => {
    restart(g);
    g.recorded = g.recorded && g.won;
    st.undo = [];
    selected = -1;
    els.forEach((el) => el.classList.remove('gone', 'cheer'));
    closeAll();
    place(true);
    render();
    persist();
  });
}

function hint() {
  if (hinting || celebrating || g.won) return;
  const m = findHint(g);
  if (!m) return;
  const [i, p] = m;
  hinting = true;
  g.usedHint = true;
  selected = -1;
  render();
  els[i].classList.add('hint');
  setTimeout(() => {
    doMove(i, p);
    setTimeout(() => { els[i]?.classList.remove('hint'); hinting = false; }, 650);
  }, 380);
}

// ---------- Touch: drag a block, or tap a block and then a cell ----------
let drag = null;

blocksEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.block');
  if (!el || hinting || celebrating || g.won || (e.pointerType === 'mouse' && e.button !== 0)) return;
  sound.unlock();
  const i = Number(el.dataset.i);
  const b = g.board.blocks[i];
  const [lo, hi] = slideRange(g.board, g.pos, i);
  el.setPointerCapture(e.pointerId);
  drag = { i, el, b, lo, hi, p0: g.pos[i], x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, base: posPx(b, g.pos[i]) };
});

blocksEl.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const { b, lo, hi, p0, el, base } = drag;
  const along = b.dir === 'h' ? e.clientX - drag.x : e.clientY - drag.y;
  if (!drag.moved && Math.abs(along) < DRAG_SLOP) return;
  if (!drag.moved) { drag.moved = true; el.classList.add('dragging'); }
  const min = (lo - p0) * step();
  const max = (hi - p0) * step();
  const d = Math.max(min, Math.min(max, along));
  drag.d = d;
  const [x, y] = b.dir === 'h' ? [base[0] + d, base[1]] : [base[0], base[1] + d];
  el.style.transform = `translate(${x}px, ${y}px)`;
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { i, el, lo, hi, p0, moved } = drag;
  const d = e.type === 'pointercancel' ? 0 : drag.d || 0;
  el.classList.remove('dragging');
  drag = null;
  if (moved) {
    doMove(i, Math.max(lo, Math.min(hi, p0 + Math.round(d / step()))));
    return;
  }
  // A tap on a block.
  if (st.settings.tapToMove) {
    selected = selected === i ? -1 : i;
    render();
  }
}
blocksEl.addEventListener('pointerup', endDrag);
blocksEl.addEventListener('pointercancel', endDrag);

// Tap-to-move: with a block picked, a tap on an empty cell slides it there if the way is clear.
tray.addEventListener('click', (e) => {
  if (!st.settings.tapToMove || selected < 0 || e.target.closest('.block')) return;
  const rect = $('cells').getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left) / step());
  const row = Math.floor((e.clientY - rect.top) / step());
  const { size } = g.board;
  if (col < 0 || row < 0 || col >= size || row >= size) return;
  const i = selected;
  const b = g.board.blocks[i];
  const inLine = b.dir === 'h' ? row === b.r : col === b.c;
  const at = b.dir === 'h' ? col : row;
  const [lo, hi] = slideRange(g.board, g.pos, i);
  const p = at < g.pos[i] ? at : at - b.len + 1;
  if (inLine && p >= lo && p <= hi && p !== g.pos[i]) doMove(i, p);
  else nudge(i);
});

function nudge(i) {
  const el = els[i];
  const b = g.board.blocks[i];
  el.style.setProperty('--nx', b.dir === 'h' ? '4px' : '0');
  el.style.setProperty('--ny', b.dir === 'v' ? '4px' : '0');
  el.classList.remove('nudge');
  el.offsetWidth;
  el.classList.add('nudge');
  sound.bump();
}

// Keyboard: Tab to a block, arrow keys slide it one cell.
blocksEl.addEventListener('keydown', (e) => {
  const el = e.target.closest('.block');
  if (!el || hinting || celebrating) return;
  const i = Number(el.dataset.i);
  const b = g.board.blocks[i];
  const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
  if (!d) return;
  const horizontalKey = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  if (horizontalKey !== (b.dir === 'h')) return;
  e.preventDefault();
  const [lo, hi] = slideRange(g.board, g.pos, i);
  const p = g.pos[i] + d;
  if (p >= lo && p <= hi) doMove(i, p);
  else nudge(i);
});

// ---------- Overlays ----------
const overlays = ['menu', 'confirm', 'won', 'settings', 'stats', 'howto'];
function open(id) { overlays.forEach((o) => { $(o).hidden = o !== id; }); }
function closeAll() { overlays.forEach((o) => { $(o).hidden = true; }); }

let confirmAction = null;
function confirmBox(title, text, ok, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = ok;
  confirmAction = action;
  open('confirm');
}

$('menu-btn').addEventListener('click', () => open('menu'));
$('moves-pill').addEventListener('click', () => openStats());
$('par-pill').addEventListener('click', () => openStats());
$('undo-btn').addEventListener('click', undo);
$('hint-btn').addEventListener('click', hint);
$('restart-btn').addEventListener('click', doRestart);
$('new-btn').addEventListener('click', askNew);

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
$('won').addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'new') startNew();
  else if (a === 'stats') openStats();
});
for (const id of ['settings', 'stats', 'howto']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === $(id) || e.target.closest('[data-action=close]')) {
      closeAll();
      if (g.won && !celebrating) showWon();
    }
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
  if (key === 'sound') { sound.setEnabled(st.settings.sound); sound.unlock(); sound.slide(); }
  if (key === 'tapToMove' && !st.settings.tapToMove) selected = -1;
  if (key === 'walls') { toast('From the next puzzle'); topUp(); }
  render();
  persist();
});
$('settings').addEventListener('click', (e) => {
  const b = e.target.closest('[data-setting] button');
  if (!b) return;
  const key = b.closest('[data-setting]').dataset.setting;
  const value = b.dataset.value;
  if (key === 'difficulty') {
    if (value === g.level && value === st.settings.difficulty) return;
    const name = DIFFICULTIES[value].name;
    const go = () => { st.settings.difficulty = value; startNew(value); };
    if (inProgress()) confirmBox('Start a new ' + name + ' puzzle?', "This puzzle won't be finished.", 'New puzzle', go);
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
  statsTab = g.level;
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
  const avg = s.solved ? '+' + (Math.round((s.over / s.solved) * 10) / 10) : '–';
  const tiles = [[s.solved, 'Solved'], [s.atPar, 'Solved at par'], [avg, 'Average over par'], [s.bestStreak, 'Best streak at par']];
  $('stat-grid').innerHTML = tiles.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  const done = st.history.filter((h) => h.d === statsTab).slice().reverse();
  const list = $('history-list');
  if (!done.length) {
    list.innerHTML = '<li class="history-empty">No solved puzzles yet</li>';
    return;
  }
  const tick = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  list.innerHTML = done.map((h) => {
    const over = h.moves - h.par;
    return `<li>
      <span class="dot${over ? ' over' : ''}">${over ? '+' + over : tick}</span>
      <span class="what"><b>${h.moves} ${h.moves === 1 ? 'move' : 'moves'}</b><span>${when(h.at)} · Par ${h.par}</span></span>
    </li>`;
  }).join('');
}

// ---------- Start ----------
if (!g || !DIFFICULTIES[g.level] || !g.board) g = st.game = newGame(st.settings.difficulty, takePuzzle(st.settings.difficulty));
statsTab = g.level;
sound.setEnabled(st.settings.sound);
setupHome({ game: 'blocks', save: persist });
applyLook();
buildBoard();
render();
if (g.won) {
  els.forEach((el, i) => { if (g.board.blocks[i].key) el.classList.add('gone'); });
  showWon();
}
persist();
setTimeout(topUp, 600);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(() => { /* offline support is a bonus */ });
}
