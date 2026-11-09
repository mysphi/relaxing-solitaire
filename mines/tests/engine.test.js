import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES, HIDDEN, FLAG, QUESTION, OPEN,
  newGame, layMines, tap, cycleMark, minesLeft, snapshot, restore, restart, findHint, nbrsFor,
} from '../src/engine.js';
import { deduce, solvableFrom } from '../src/solver.js';

// Small seeded random numbers so tests repeat exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const centre = (g) => Math.floor(g.rows / 2) * g.cols + Math.floor(g.cols / 2);

test('board sizes match the agreed difficulties', () => {
  assert.deepEqual(DIFFICULTIES.easy, { cols: 9, rows: 9, mines: 10, name: 'Easy' });
  assert.deepEqual(DIFFICULTIES.medium, { cols: 12, rows: 16, mines: 30, name: 'Medium' });
  assert.deepEqual(DIFFICULTIES.hard, { cols: 12, rows: 30, mines: 80, name: 'Hard' });
});

test('first tap is never a mine and always opens an area', () => {
  for (const d of Object.keys(DIFFICULTIES)) {
    for (let s = 1; s <= 20; s++) {
      const g = newGame(d, { noGuess: false });
      const first = (s * 7) % (g.cols * g.rows);
      const result = tap(g, first, { rng: rng(s) });
      assert.notEqual(result, 'lost');
      assert.equal(g.mine.filter(Boolean).length, g.mines);
      assert.equal(g.adj[first], 0);
      assert.ok(g.view.filter((v) => v === OPEN).length > 1);
      assert.equal(g.moves, 1);
    }
  }
});

test('no-guess boards can be solved by logic from the first tap', () => {
  for (const d of Object.keys(DIFFICULTIES)) {
    for (let s = 1; s <= 6; s++) {
      const g = newGame(d, { noGuess: true });
      const start = centre(g);
      layMines(g, start, rng(s * 101));
      const ok = solvableFrom({ cols: g.cols, rows: g.rows, mines: g.mines, isMine: g.mine, adj: g.adj, nbrs: nbrsFor(g.cols, g.rows) }, start);
      assert.ok(ok, `${d} seed ${s}`);
    }
  }
});

test('the solver never calls a mine safe, or a safe cell a mine', () => {
  for (let s = 1; s <= 300; s++) {
    const d = ['easy', 'medium', 'hard'][s % 3];
    const g = newGame(d, { noGuess: false });
    const r = rng(s);
    tap(g, Math.floor(r() * g.cols * g.rows), { rng: r });
    // Open a few more safe cells at random to make varied positions.
    for (let k = 0; k < 4; k++) {
      const i = Math.floor(r() * g.cols * g.rows);
      if (!g.mine[i]) tap(g, i);
    }
    const open = g.view.map((v) => v === OPEN);
    const { safe, mine } = deduce({ nbrs: nbrsFor(g.cols, g.rows), open, adj: g.adj, totalMines: g.mines });
    for (const i of safe) assert.equal(g.mine[i], 0, `seed ${s}: cell ${i} called safe`);
    for (const i of mine) assert.equal(g.mine[i], 1, `seed ${s}: cell ${i} called a mine`);
  }
});

test('tapping a mine loses, and undo brings the board back', () => {
  const g = newGame('easy', { noGuess: false });
  tap(g, centre(g), { rng: rng(3) });
  const before = snapshot(g);
  const m = g.mine.findIndex((x, i) => x && g.view[i] !== OPEN);
  assert.equal(tap(g, m), 'lost');
  assert.equal(g.lost, m);
  assert.equal(tap(g, 0), 'none'); // nothing happens after a loss
  restore(g, before);
  assert.equal(g.lost, -1);
  assert.equal(g.moves, 1);
  assert.equal(g.view[m], HIDDEN);
  assert.equal(g.usedUndo, true);
});

test('long-press cycles flag, question mark and blank; flags are not moves', () => {
  const g = newGame('easy');
  tap(g, centre(g), { rng: rng(9) });
  const i = g.view.findIndex((v) => v === HIDDEN);
  const moves = g.moves;
  cycleMark(g, i);
  assert.equal(g.view[i], FLAG);
  assert.equal(minesLeft(g), 9);
  cycleMark(g, i);
  assert.equal(g.view[i], QUESTION);
  cycleMark(g, i);
  assert.equal(g.view[i], HIDDEN);
  cycleMark(g, i, { questionMarks: false });
  cycleMark(g, i, { questionMarks: false });
  assert.equal(g.view[i], HIDDEN);
  assert.equal(g.moves, moves);
  assert.equal(cycleMark(g, centre(g)), false); // open cells can't be flagged
});

test('a flagged cell is not opened by a tap', () => {
  const g = newGame('easy');
  tap(g, centre(g), { rng: rng(4) });
  const i = g.view.findIndex((v) => v === HIDDEN);
  cycleMark(g, i);
  assert.equal(tap(g, i), 'none');
  assert.equal(g.view[i], FLAG);
});

test('chording opens the neighbours of a number with all its flags', () => {
  const g = newGame('medium', { noGuess: false });
  tap(g, centre(g), { rng: rng(12) });
  const nbrs = nbrsFor(g.cols, g.rows);
  // Find an open number whose hidden neighbours include its mines plus at least one safe cell.
  const i = g.view.findIndex((v, k) => v === OPEN && g.adj[k] > 0 &&
    nbrs[k].some((j) => g.view[j] === HIDDEN && !g.mine[j]));
  assert.ok(i >= 0);
  for (const j of nbrs[i]) if (g.mine[j]) g.view[j] = FLAG;
  const moves = g.moves;
  assert.equal(tap(g, i, { chording: false }), 'none');
  const r = tap(g, i);
  assert.ok(r === 'move' || r === 'won');
  assert.equal(g.moves, moves + 1);
  for (const j of nbrs[i]) if (!g.mine[j]) assert.equal(g.view[j], OPEN);
});

test('chording with a wrong flag hits the mine', () => {
  const g = newGame('medium', { noGuess: false });
  tap(g, centre(g), { rng: rng(12) });
  const nbrs = nbrsFor(g.cols, g.rows);
  const i = g.view.findIndex((v, k) => v === OPEN && g.adj[k] > 0 &&
    nbrs[k].filter((j) => g.view[j] === HIDDEN && !g.mine[j]).length >= g.adj[k]);
  assert.ok(i >= 0);
  const wrong = nbrs[i].filter((j) => g.view[j] === HIDDEN && !g.mine[j]).slice(0, g.adj[i]);
  wrong.forEach((j) => { g.view[j] = FLAG; });
  assert.equal(tap(g, i), 'lost');
});

test('opening every safe cell wins and flags the mines', () => {
  const g = newGame('easy');
  tap(g, centre(g), { rng: rng(5) });
  let result;
  for (let i = 0; i < g.view.length; i++) {
    if (!g.mine[i] && g.view[i] !== OPEN) result = tap(g, i);
  }
  assert.equal(result, 'won');
  assert.equal(g.won, true);
  assert.equal(minesLeft(g), 0);
});

test('restart keeps the mines, clears the board and stops the game counting', () => {
  const g = newGame('easy');
  tap(g, centre(g), { rng: rng(6) });
  const mines = g.mine.join('');
  restart(g);
  assert.equal(g.mine.join(''), mines);
  assert.ok(g.view.every((v) => v === HIDDEN));
  assert.equal(g.moves, 0);
  assert.equal(g.usedUndo, true);
});

test('hints point at a safe cell, or a wrong flag', () => {
  const g = newGame('medium');
  assert.deepEqual(findHint(g), { cell: centre(g), kind: 'start' });
  tap(g, centre(g), { rng: rng(21) });
  const h = findHint(g);
  assert.equal(h.kind, 'safe');
  assert.equal(g.mine[h.cell], 0);
  assert.notEqual(g.view[h.cell], OPEN);

  // Put a flag on a safe cell that logic can't see yet: the hint shows it if nothing else is sure.
  const easy = newGame('easy', { noGuess: false });
  tap(easy, centre(easy), { rng: rng(8) });
  const bad = easy.view.findIndex((v, k) => v === HIDDEN && !easy.mine[k]);
  easy.view[bad] = FLAG;
  const hint = findHint(easy);
  assert.ok(hint && easy.mine[hint.cell] === 0);
});
