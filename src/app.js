// The screen: draws the table, handles taps and drags, animates moves.
// Game rules live in engine.js; this file only asks it what is legal.

import * as E from './engine.js';
import * as store from './storage.js';

const SUIT_CHAR = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const MOVE_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;

const $ = (id) => document.getElementById(id);
const board = $('board');

let settings = { ...store.defaultSettings };
let game = null;
let undo = [];
let history = [];
let busy = false; // true while auto-complete is running
let drag = null;
let metrics = null;
const cardEls = new Map();
const slots = { stock: null, foundations: [], tableau: [] };

// ---------- Setup ----------

function init() {
  const saved = store.load();
  if (saved) {
    settings = saved.settings;
    history = saved.history;
    if (saved.game && !E.isWon(saved.game)) {
      game = saved.game;
      undo = saved.undo;
    }
  }
  buildSlots();
  buildCards();
  measure();
  if (game) render({ instant: true });
  else startGame();

  wireControls();
  window.addEventListener('resize', () => { measure(); render({ instant: true }); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function buildSlots() {
  const stock = document.createElement('div');
  stock.className = 'slot stock';
  stock.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>';
  stock.setAttribute('aria-label', 'Stock');
  board.appendChild(stock);
  slots.stock = stock;
  for (const suit of ['S', 'H', 'D', 'C']) {
    const f = document.createElement('div');
    f.className = 'slot';
    f.textContent = SUIT_CHAR[suit];
    board.appendChild(f);
    slots.foundations.push(f);
  }
  for (let i = 0; i < 7; i++) {
    const t = document.createElement('div');
    t.className = 'slot';
    t.style.borderColor = 'rgba(243,241,234,0.18)';
    board.appendChild(t);
    slots.tableau.push(t);
  }
}

function buildCards() {
  for (const c of E.makeDeck()) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = c.id;
    const colour = E.isRed(c) ? 'red' : 'black';
    el.innerHTML =
      `<div class="card-inner"><div class="face ${colour}">` +
      `<div class="corner"><span>${RANK[c.rank]}</span><span class="s">${SUIT_CHAR[c.suit]}</span></div>` +
      `<div class="pip">${SUIT_CHAR[c.suit]}</div></div><div class="back"></div></div>`;
    board.appendChild(el);
    cardEls.set(c.id, el);
  }
}

// ---------- Layout ----------

function measure() {
  const W = board.clientWidth;
  const H = board.clientHeight;
  const pad = 10;
  const gap = 6;
  const cw = (W - pad * 2 - gap * 6) / 7;
  const ch = Math.round(cw * 1.42);
  const topY = 8;
  const tabY = topY + ch + 18;
  // Deck on the right (easier for a right thumb) mirrors the top row.
  const right = settings.deckOnRight;
  const cols = right
    ? { stock: 6, waste: 4, fanDir: 1, found: [0, 1, 2, 3] }
    : { stock: 0, waste: 1, fanDir: 1, found: [3, 4, 5, 6] };
  metrics = { W, H, pad, gap, cw, ch, topY, tabY, cols };
  board.style.setProperty('--cw', cw + 'px');

  const place = (el, x, y) => {
    el.style.width = cw + 'px';
    el.style.height = ch + 'px';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };
  place(slots.stock, colX(cols.stock), topY);
  slots.foundations.forEach((f, i) => place(f, colX(cols.found[i]), topY));
  slots.tableau.forEach((t, i) => place(t, colX(i), tabY));
  for (const el of cardEls.values()) {
    el.style.width = cw + 'px';
    el.style.height = ch + 'px';
  }
}

const colX = (i) => metrics.pad + i * (metrics.cw + metrics.gap);

// Where every card sits for a given state: id -> { x, y, z, up }
function layout(state) {
  const { cw, ch, topY, tabY, H, cols } = metrics;
  const pos = new Map();
  // Cards buried in a stacked pile get no shadow, otherwise the shadows pile up into a dark halo.
  const flat = (pile, i) => i < pile.length - 2;
  state.stock.forEach((c, i) => pos.set(c.id, { x: colX(cols.stock), y: topY, z: 10 + i, up: false, flat: flat(state.stock, i) }));

  const fanFrom = state.drawCount === 3 ? Math.max(0, state.waste.length - 3) : state.waste.length;
  state.waste.forEach((c, i) => {
    const k = i - fanFrom;
    // In Draw 3 the last three cards fan out so you can see all three; only the top one moves.
    const shift = k > 0 ? k * cw * 0.42 * cols.fanDir : 0;
    pos.set(c.id, { x: colX(cols.waste) + shift, y: topY, z: 100 + i, up: true, flat: k < 0 && flat(state.waste, i) });
  });

  state.foundations.forEach((pile, f) => {
    pile.forEach((c, i) => pos.set(c.id, { x: colX(cols.found[f]), y: topY, z: 200 + i, up: true, flat: flat(pile, i) }));
  });

  const avail = H - tabY - 10;
  state.tableau.forEach((pile, col) => {
    const downs = pile.filter((c) => !c.up).length;
    const ups = pile.length - downs;
    const downStep = ch * 0.13;
    let upStep = ch * 0.34;
    const needed = downs * downStep + Math.max(0, ups - 1) * upStep + ch;
    if (needed > avail && ups > 1) {
      upStep = Math.max(ch * 0.2, (avail - ch - downs * downStep) / (ups - 1));
    }
    let y = tabY;
    pile.forEach((c, i) => {
      pos.set(c.id, { x: colX(col), y, z: 300 + i, up: c.up });
      y += c.up ? upStep : downStep;
    });
  });
  return pos;
}

// Which pile a card is in right now.
function locate(state, id) {
  let i = state.stock.findIndex((c) => c.id === id);
  if (i >= 0) return { pile: 'stock', cardIndex: i };
  i = state.waste.findIndex((c) => c.id === id);
  if (i >= 0) return { pile: 'waste', cardIndex: i };
  for (let f = 0; f < 4; f++) {
    i = state.foundations[f].findIndex((c) => c.id === id);
    if (i >= 0) return { pile: 'foundation', index: f, cardIndex: i };
  }
  for (let t = 0; t < 7; t++) {
    i = state.tableau[t].findIndex((c) => c.id === id);
    if (i >= 0) return { pile: 'tableau', index: t, cardIndex: i };
  }
  return null;
}

// ---------- Rendering ----------

function setCard(el, p, { instant = false, delay = 0 } = {}) {
  const moved = el._x !== p.x || el._y !== p.y;
  el.classList.toggle('up', p.up);
  el.classList.toggle('flat', !!p.flat);
  el.classList.toggle('instant', instant);
  el.style.transitionDelay = delay ? delay + 'ms' : '';
  el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  el._x = p.x;
  el._y = p.y;
  clearTimeout(el._zTimer);
  if (moved && !instant && MOVE_MS) {
    // Keep a moving card above everything until it lands, then drop it into place.
    el.style.zIndex = 1000 + p.z;
    el._zTimer = setTimeout(() => { el.style.zIndex = p.z; }, MOVE_MS + delay + 40);
  } else {
    el.style.zIndex = p.z;
  }
}

function render({ instant = false, stagger = false, delays = null } = {}) {
  const pos = layout(game);
  let k = 0;
  for (const [id, p] of pos) {
    const delay = stagger ? k++ * 14 : (delays && delays.get(id)) || 0;
    setCard(cardEls.get(id), p, { instant, delay });
  }
  if (delays) {
    setTimeout(() => { for (const id of delays.keys()) cardEls.get(id).style.transitionDelay = ''; }, MOVE_MS + 300);
  }
  if (instant) {
    void board.offsetWidth;
    for (const el of cardEls.values()) el.classList.remove('instant');
  }
  clearHint();
  updateChrome();
  scheduleSave();
}

function updateChrome() {
  $('score').textContent = game.score;
  $('moves').textContent = game.moves;
  $('score-pill').hidden = game.scoring === 'none' || settings.scoring === 'none';
  $('moves-pill').hidden = !settings.showMoves;
  $('undo-btn').disabled = undo.length === 0 || busy;
  $('finish-btn').hidden = busy || !E.canAutoComplete(game);
}

// ---------- Game flow ----------

function recordUnfinished() {
  if (game && game.moves > 0 && !E.isWon(game)) {
    history.push({ at: Date.now(), won: false, score: game.score, moves: game.moves, drawCount: game.drawCount, scoring: game.scoring });
  }
}

function startGame(seed) {
  recordUnfinished();
  const prev = game;
  game = seed !== undefined
    ? E.newGame({ seed, drawCount: prev.drawCount, scoring: prev.scoring })
    : E.newGame({ drawCount: settings.drawCount, scoring: settings.scoring });
  undo = [];
  // Gather every card on the stock, then deal them out.
  const stockPos = { x: colX(metrics.cols.stock), y: metrics.topY, z: 10, up: false };
  for (const el of cardEls.values()) setCard(el, stockPos, { instant: true });
  void board.offsetWidth;
  for (const el of cardEls.values()) el.classList.remove('instant');
  requestAnimationFrame(() => {
    render({ stagger: true });
    setTimeout(() => { for (const el of cardEls.values()) el.style.transitionDelay = ''; }, 52 * 14 + MOVE_MS);
  });
}

function apply(next, renderOpts) {
  if (!next) return false;
  undo.push(game);
  game = next;
  render(renderOpts);
  if (E.isWon(game)) onWin();
  return true;
}

function doDraw() {
  const next = E.draw(game);
  if (!next) return;
  // Deal the new cards one after another so it is clear how many came off the deck.
  const dealt = next.waste.slice(game.waste.length);
  const delays = new Map(dealt.map((c, i) => [c.id, i * 70]));
  apply(next, { delays });
}

function doUndo() {
  if (!undo.length || busy) return;
  game = undo.pop();
  render();
}

function onWin() {
  history.push({ at: Date.now(), won: true, score: game.score, moves: game.moves, drawCount: game.drawCount, scoring: game.scoring });
  saveNow();
  const scorePart = game.scoring === 'none' ? '' : ` with a score of ${game.score}`;
  $('win-text').textContent = `You finished in ${game.moves} moves${scorePart}.`;
  setTimeout(() => show('win'), MOVE_MS + 400);
}

function autoComplete() {
  busy = true;
  updateChrome();
  let guard = 400;
  const step = () => {
    const next = !E.isWon(game) && guard-- > 0 && E.autoCompleteStep(game);
    if (!next) {
      busy = false;
      updateChrome();
      return;
    }
    apply(next);
    if (!E.isWon(game)) setTimeout(step, 110);
    else { busy = false; updateChrome(); }
  };
  step();
}

// ---------- Hints ----------

let hintTimers = [];
function clearHint() {
  hintTimers.forEach(clearTimeout);
  hintTimers = [];
  board.querySelectorAll('.ghost').forEach((g) => g.remove());
  board.querySelectorAll('.hinted').forEach((c) => c.classList.remove('hinted'));
}

function showHint() {
  if (busy) return;
  clearHint();
  const h = E.findHint(game);
  if (!h) {
    nudge($('hint-btn'));
    return;
  }
  if (h.draw) {
    const topStock = game.stock[game.stock.length - 1];
    if (topStock) bounce(cardEls.get(topStock.id));
    else {
      slots.stock.classList.remove('pulse');
      void slots.stock.offsetWidth;
      slots.stock.classList.add('pulse');
    }
    return;
  }
  // Glide a copy of the card(s) to where they would go, then fade it away.
  const cards = E.pickUp(game, h.from);
  const after = layout(E.move(game, h.from, h.to));
  cards.forEach((c, i) => {
    const el = cardEls.get(c.id);
    el.classList.add('hinted');
    const ghost = el.cloneNode(true);
    ghost.classList.add('ghost', 'instant');
    ghost.style.zIndex = 2000 + i;
    ghost.style.transitionDelay = '';
    board.appendChild(ghost);
    const from = `translate(${el._x}px, ${el._y}px)`;
    const p = after.get(c.id);
    const to = `translate(${p.x}px, ${p.y}px)`;
    const anim = ghost.animate(
      [
        { transform: from, opacity: 0.95 },
        { transform: to, opacity: 0.95, offset: 0.6 },
        { transform: to, opacity: 0.95, offset: 0.85 },
        { transform: to, opacity: 0 },
      ],
      { duration: MOVE_MS ? 1400 : 1, easing: 'ease-in-out', fill: 'forwards' },
    );
    anim.onfinish = () => ghost.remove();
  });
  hintTimers.push(setTimeout(() => {
    board.querySelectorAll('.hinted').forEach((c) => c.classList.remove('hinted'));
  }, 1600));
}

function bounce(el) {
  const base = el.style.transform;
  el.animate(
    [{ transform: base }, { transform: base + ' translateY(-10px)' }, { transform: base }],
    { duration: 450, iterations: 2, easing: 'ease-in-out' },
  );
}

function nudge(el) {
  const base = el.style.transform || '';
  el.animate(
    [{ transform: base }, { transform: base + ' translateX(-5px)' }, { transform: base + ' translateX(5px)' }, { transform: base }],
    { duration: 160 },
  );
}

// ---------- Touch: tap and drag ----------

function sourceFor(loc) {
  if (loc.pile === 'waste') return loc.cardIndex === game.waste.length - 1 ? { pile: 'waste' } : null;
  if (loc.pile === 'foundation') {
    return loc.cardIndex === game.foundations[loc.index].length - 1 ? { pile: 'foundation', index: loc.index } : null;
  }
  if (loc.pile === 'tableau') return { pile: 'tableau', index: loc.index, cardIndex: loc.cardIndex };
  return null;
}

function onPointerDown(e) {
  if (busy || drag) return;
  const el = e.target.closest('.card:not(.ghost)');
  if (!el) {
    if (e.target.closest('.slot.stock')) doDraw();
    return;
  }
  clearHint();
  const loc = locate(game, el.dataset.id);
  if (!loc) return;
  if (loc.pile === 'stock') {
    doDraw();
    return;
  }
  const from = sourceFor(loc);
  const cards = from && E.pickUp(game, from);
  if (!cards) return;
  drag = {
    from,
    els: cards.map((c) => cardEls.get(c.id)),
    x0: e.clientX,
    y0: e.clientY,
    moved: false,
  };
  board.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  if (!drag.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    drag.els.forEach((el, i) => {
      clearTimeout(el._zTimer);
      el.classList.add('dragging');
      el.style.zIndex = 2000 + i;
    });
  }
  drag.dx = dx;
  drag.dy = dy;
  for (const el of drag.els) el.style.transform = `translate(${el._x + dx}px, ${el._y + dy}px)`;
}

function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    if (settings.tapToMove) tapMove(d.from, d.els[0]);
    return;
  }
  d.els.forEach((el) => el.classList.remove('dragging'));
  const lead = d.els[0];
  const to = dropTarget(lead._x + d.dx, lead._y + d.dy, d.from);
  if (!(to && apply(E.move(game, d.from, to)))) render(); // slides back home
}

function dropTarget(x, y, from) {
  const { cw, ch, gap, pad, tabY, cols } = metrics;
  const cx = x + cw / 2;
  const cy = y + ch / 2;
  const nearest = [0, 1, 2, 3, 4, 5, 6].sort(
    (a, b) => Math.abs(cx - (colX(a) + cw / 2)) - Math.abs(cx - (colX(b) + cw / 2)),
  );
  if (cy < tabY) {
    // Top row: any foundation that takes the card, nearest first.
    for (const col of nearest) {
      const f = cols.found.indexOf(col);
      if (f < 0) continue;
      const to = { pile: 'foundation', index: f };
      if (E.isLegalMove(game, from, to)) return to;
    }
    return null;
  }
  // Tableau: the nearest legal column within about one column width.
  for (const col of nearest.slice(0, 2)) {
    if (Math.abs(cx - (colX(col) + cw / 2)) > cw + gap + pad) continue;
    const to = { pile: 'tableau', index: col };
    if (E.isLegalMove(game, from, to)) return to;
  }
  return null;
}

function tapMove(from, el) {
  const to = E.bestDestination(game, from);
  if (!to || !apply(E.move(game, from, to))) nudge(el);
}

// ---------- Menus and dialogs ----------

function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }

let confirmAction = null;
function confirmThen(title, text, okLabel, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  confirmAction = action;
  show('confirm');
}

function askNewGame() {
  if (game.moves === 0) return startGame();
  confirmThen('Start a new game?', 'Your current game will be lost.', 'New game', () => startGame());
}

function askRestart() {
  confirmThen('Restart this deal?', 'You will start this same deal again from the beginning.', 'Restart', () => startGame(game.seed));
}

function syncSettingsUI() {
  document.querySelectorAll('#settings .segmented').forEach((seg) => {
    const key = seg.dataset.setting;
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(String(settings[key]) === b.dataset.value));
    });
  });
  document.querySelectorAll('#settings input[type=checkbox]').forEach((cb) => {
    cb.checked = !!settings[cb.dataset.setting];
  });
}

function renderHistory() {
  const played = history.length;
  const wins = history.filter((h) => h.won);
  const scored = wins.filter((h) => h.scoring !== 'none').map((h) => h.score);
  let streak = 0;
  for (let i = history.length - 1; i >= 0 && history[i].won; i--) streak++;
  const stat = (value, label) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  $('stats').innerHTML =
    stat(played, 'Played') + stat(wins.length, 'Won') +
    stat(scored.length ? Math.max(...scored) : '–', 'Best score') + stat(streak, 'Win streak');

  const list = $('history-list');
  list.innerHTML = '';
  if (!played) {
    list.innerHTML = '<li class="history-empty">Finished games will appear here.</li>';
    return;
  }
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  for (const h of history.slice(-50).reverse()) {
    const li = document.createElement('li');
    const score = h.scoring === 'none' ? '' : `Score ${h.score} · `;
    li.innerHTML = `<span><span class="${h.won ? 'won' : ''}">${h.won ? 'Won' : 'Not finished'}</span> <span class="when">${fmt.format(h.at)}</span></span><span>${score}${h.moves} moves</span>`;
    list.appendChild(li);
  }
}

function wireControls() {
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', () => { if (drag) { drag.els.forEach((el) => el.classList.remove('dragging')); drag = null; render(); } });

  $('menu-btn').addEventListener('click', () => show('menu'));
  for (const id of ['score-pill', 'moves-pill']) {
    $(id).addEventListener('click', () => { renderHistory(); show('history'); });
  }
  $('undo-btn').addEventListener('click', doUndo);
  $('hint-btn').addEventListener('click', showHint);
  $('new-btn').addEventListener('click', askNewGame);
  $('finish-btn').addEventListener('click', autoComplete);

  // Tapping the dimmed area closes a sheet.
  document.querySelectorAll('.overlay').forEach((o) => {
    o.addEventListener('click', (e) => { if (e.target === o && o.id !== 'win') o.hidden = true; });
  });

  $('menu').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    hide('menu');
    if (action === 'new') askNewGame();
    if (action === 'restart') askRestart();
    if (action === 'history') { renderHistory(); show('history'); }
    if (action === 'settings') { syncSettingsUI(); show('settings'); }
  });

  $('confirm').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    hide('confirm');
    if (action === 'ok' && confirmAction) confirmAction();
    confirmAction = null;
  });

  for (const id of ['settings', 'history']) {
    $(id).querySelector('[data-action=close]').addEventListener('click', () => hide(id));
  }

  $('settings').addEventListener('click', (e) => {
    const b = e.target.closest('.segmented button');
    if (!b) return;
    const key = b.closest('.segmented').dataset.setting;
    settings[key] = key === 'drawCount' ? Number(b.dataset.value) : b.dataset.value;
    // Draw 1 or 3 is safe to switch mid-game; scoring waits for the next game.
    if (key === 'drawCount' && game.drawCount !== settings.drawCount) {
      game = { ...game, drawCount: settings.drawCount };
    }
    syncSettingsUI();
    render();
  });
  $('settings').addEventListener('change', (e) => {
    if (e.target.dataset.setting) {
      settings[e.target.dataset.setting] = e.target.checked;
      if (e.target.dataset.setting === 'deckOnRight') measure();
      render({ instant: e.target.dataset.setting === 'deckOnRight' ? false : true });
    }
  });

  $('win').addEventListener('click', (e) => {
    if (e.target.closest('[data-action=again]')) {
      hide('win');
      startGame();
    }
  });
}

// ---------- Saving ----------

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  store.save({ settings, game, undo, history });
}

init();
