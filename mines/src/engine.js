// Game rules. No DOM here, so it can be tested with `npm test`.
import { neighbourList, deduce, solvableFrom } from './solver.js';

export const DIFFICULTIES = {
  easy: { cols: 9, rows: 9, mines: 10, name: 'Easy' },
  medium: { cols: 12, rows: 16, mines: 30, name: 'Medium' },
  hard: { cols: 12, rows: 30, mines: 80, name: 'Hard' },
};

// What the player sees in each cell.
export const HIDDEN = 0;
export const FLAG = 1;
export const QUESTION = 2;
export const OPEN = 3;

const nbrCache = new Map();
export function nbrsFor(cols, rows) {
  const key = cols + 'x' + rows;
  if (!nbrCache.has(key)) nbrCache.set(key, neighbourList(cols, rows));
  return nbrCache.get(key);
}

export function newGame(difficulty = 'medium', { noGuess = true } = {}) {
  const d = DIFFICULTIES[difficulty] || DIFFICULTIES.medium;
  const n = d.cols * d.rows;
  return {
    difficulty: DIFFICULTIES[difficulty] ? difficulty : 'medium',
    cols: d.cols,
    rows: d.rows,
    mines: d.mines,
    noGuess,
    started: false,
    mine: [], // 1 where a mine is, filled in on the first tap
    adj: [], // number of neighbouring mines
    view: new Array(n).fill(HIDDEN),
    moves: 0,
    lost: -1, // index of the mine that was hit, or -1
    won: false,
    usedUndo: false, // games where Undo or Restart was used don't count in stats
  };
}

// Place mines after the first tap so it is always safe and always opens an area.
// With noGuess on, keep dealing until the board can be solved by logic alone.
export function layMines(g, start, rng = Math.random, { maxMs = 2500, maxTries = 20000 } = {}) {
  const n = g.cols * g.rows;
  const nbrs = nbrsFor(g.cols, g.rows);
  const keep = new Set([start, ...nbrs[start]]);
  const candidates = [];
  for (let i = 0; i < n; i++) if (!keep.has(i)) candidates.push(i);
  const began = Date.now();
  let tries = 0;
  let board;
  for (;;) {
    tries++;
    board = deal(g, candidates, nbrs, rng);
    if (!g.noGuess) break;
    if (solvableFrom({ ...board, cols: g.cols, rows: g.rows, mines: g.mines, nbrs }, start)) break;
    if (tries >= maxTries || Date.now() - began > maxMs) break; // very unlikely; play the last deal
  }
  g.mine = board.isMine;
  g.adj = board.adj;
  g.started = true;
  return tries;
}

function deal(g, candidates, nbrs, rng) {
  const pool = candidates.slice();
  // Partial Fisher-Yates shuffle: the first `mines` entries become mines.
  for (let k = 0; k < g.mines; k++) {
    const j = k + Math.floor(rng() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  const n = g.cols * g.rows;
  const isMine = new Array(n).fill(0);
  for (let k = 0; k < g.mines; k++) isMine[pool[k]] = 1;
  const adj = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (const j of nbrs[i]) c += isMine[j];
    adj[i] = c;
  }
  return { isMine, adj };
}

function flood(g, i) {
  const nbrs = nbrsFor(g.cols, g.rows);
  const stack = [i];
  while (stack.length) {
    const k = stack.pop();
    if (g.view[k] === OPEN || g.view[k] === FLAG || g.mine[k]) continue;
    g.view[k] = OPEN;
    if (g.adj[k] === 0) for (const j of nbrs[k]) if (g.view[j] !== OPEN) stack.push(j);
  }
}

export function isOver(g) {
  return g.won || g.lost >= 0;
}

// A tap on a cell. Returns 'none' if nothing happened, else 'move', 'lost' or 'won'.
// Opening a hidden cell, or opening around a number (chording), counts as one move.
export function tap(g, i, { chording = true, rng = Math.random } = {}) {
  if (isOver(g)) return 'none';
  if (!g.started) layMines(g, i, rng);
  const v = g.view[i];
  if (v === FLAG) return 'none';
  if (v === OPEN) {
    if (!chording || !g.adj[i]) return 'none';
    const nbrs = nbrsFor(g.cols, g.rows)[i];
    const flags = nbrs.filter((j) => g.view[j] === FLAG).length;
    const todo = nbrs.filter((j) => g.view[j] === HIDDEN || g.view[j] === QUESTION);
    if (flags !== g.adj[i] || !todo.length) return 'none';
    g.moves++;
    for (const j of todo) {
      if (g.mine[j]) { g.view[j] = OPEN; g.lost = j; return 'lost'; }
    }
    for (const j of todo) flood(g, j);
    return checkWin(g) ? 'won' : 'move';
  }
  g.moves++;
  if (g.mine[i]) { g.view[i] = OPEN; g.lost = i; return 'lost'; }
  flood(g, i);
  return checkWin(g) ? 'won' : 'move';
}

function checkWin(g) {
  const opened = g.view.filter((v) => v === OPEN).length;
  if (opened === g.cols * g.rows - g.mines) {
    g.won = true;
    for (let i = 0; i < g.view.length; i++) if (g.mine[i]) g.view[i] = FLAG;
    return true;
  }
  return false;
}

// Long-press: hidden -> flag -> question mark (if on) -> hidden. Not a move.
export function cycleMark(g, i, { questionMarks = true } = {}) {
  if (isOver(g)) return false;
  const v = g.view[i];
  if (v === OPEN) return false;
  if (v === HIDDEN) g.view[i] = FLAG;
  else if (v === FLAG) g.view[i] = questionMarks ? QUESTION : HIDDEN;
  else g.view[i] = HIDDEN;
  return true;
}

export function minesLeft(g) {
  return g.mines - g.view.filter((v) => v === FLAG).length;
}

// Undo snapshots: the visible state only, as a compact string.
export function snapshot(g) {
  return { v: g.view.join(''), m: g.moves, l: g.lost, w: g.won };
}

// Undo takes back opened cells but keeps the flags and question marks the player
// has placed since, so they don't have to place them again.
export function restore(g, s) {
  const old = s.v.split('').map(Number);
  g.view = old.map((v, i) => (g.view[i] !== OPEN && v !== OPEN ? g.view[i] : v));
  g.moves = s.m;
  g.lost = s.l;
  g.won = s.w;
  g.usedUndo = true;
}

// Play the same mines again from the start. It no longer counts in stats.
export function restart(g) {
  g.view = new Array(g.cols * g.rows).fill(HIDDEN);
  g.moves = 0;
  g.lost = -1;
  g.won = false;
  if (g.started) g.usedUndo = true;
}

// Hint: a cell logic proves is safe. If there isn't one, point out a wrong flag,
// and failing that, offer any safe cell next to the opened area.
export function findHint(g) {
  const n = g.cols * g.rows;
  const centre = Math.floor(g.rows / 2) * g.cols + Math.floor(g.cols / 2);
  if (!g.started) return { cell: centre, kind: 'start' };
  if (isOver(g)) return null;
  const nbrs = nbrsFor(g.cols, g.rows);
  const open = g.view.map((v) => v === OPEN);
  const { safe } = deduce({ nbrs, open, adj: g.adj, totalMines: g.mines });
  const pick = [...safe].filter((i) => g.view[i] !== FLAG);
  if (pick.length) {
    // Prefer cells next to the opened area, top to bottom.
    pick.sort((a, b) => a - b);
    return { cell: pick[0], kind: 'safe' };
  }
  for (let i = 0; i < n; i++) if (g.view[i] === FLAG && !g.mine[i]) return { cell: i, kind: 'wrongFlag' };
  for (let i = 0; i < n; i++) {
    if (g.view[i] !== OPEN && g.view[i] !== FLAG && !g.mine[i] && nbrs[i].some((j) => open[j])) return { cell: i, kind: 'free' };
  }
  for (let i = 0; i < n; i++) if (g.view[i] !== OPEN && !g.mine[i]) return { cell: i, kind: 'free' };
  return null;
}
