// Rules for Relaxing Blocks: a square board of sliding blocks. Each block lies across
// ('h') or down ('v') and only slides along its length. The key block lies across in
// the exit row; the puzzle is solved when it reaches the gap in the right-hand wall.
//
// A position is stored as one number per block: its column if it lies across, its row
// if it lies down. Blocks never change order, length or direction, so a whole board
// state is just that list of numbers.

import { hardestInReach, solve } from './solver.js';

export { solve };

export const DIFFICULTIES = {
  easy: { name: 'Easy', size: 6, blocks: [6, 8], par: [4, 8], walls: 0 },
  medium: { name: 'Medium', size: 6, blocks: [8, 11], par: [9, 16], walls: 1 },
  hard: { name: 'Hard', size: 6, blocks: [10, 13], par: [17, 30], walls: 1 },
  expert: { name: 'Expert', size: 7, blocks: [13, 17], par: [20, 40], walls: 2 },
};

export const exitRowFor = (size) => (size === 7 ? 3 : 2);

// Cells a block covers, as row * size + col.
export function cellsOf(b, pos, size) {
  const out = [];
  for (let k = 0; k < b.len; k++) {
    out.push(b.dir === 'h' ? b.r * size + pos + k : (pos + k) * size + b.c);
  }
  return out;
}

// Which block (by index) fills each cell, -1 for empty, -2 for a wall.
export function occupancy(board, pos) {
  const { size, blocks, walls } = board;
  const occ = new Int8Array(size * size).fill(-1);
  for (const w of walls) occ[w] = -2;
  blocks.forEach((b, i) => {
    for (const cell of cellsOf(b, pos[i], size)) occ[cell] = i;
  });
  return occ;
}

// How far block i can slide each way from where it is now: [lowest, highest] position.
export function slideRange(board, pos, i, occ = occupancy(board, pos)) {
  const { size, blocks } = board;
  const b = blocks[i];
  const at = (p) => (b.dir === 'h' ? b.r * size + p : p * size + b.c);
  let lo = pos[i];
  while (lo > 0 && occ[at(lo - 1)] === -1) lo--;
  let hi = pos[i];
  while (hi + b.len < size && occ[at(hi + b.len)] === -1) hi++;
  return [lo, hi];
}

export const keyIndex = (board) => board.blocks.findIndex((b) => b.key);
export const goalPos = (board) => board.size - board.blocks[keyIndex(board)].len;
export const isSolvedPos = (board, pos) => pos[keyIndex(board)] === goalPos(board);

// Wood tones: each block gets one, so neighbours look slightly different.
export const TONES = 8;

function randomBoard(level, rng, walls) {
  const d = DIFFICULTIES[level];
  const size = d.size;
  const exitRow = exitRowFor(size);
  const occ = new Int8Array(size * size).fill(-1);
  const blocks = [];
  const pos = [];
  const wallCells = [];
  const pick = (n) => Math.floor(rng() * n);

  const place = (b, p) => {
    const cells = cellsOf(b, p, size);
    if (cells.some((c) => occ[c] !== -1)) return false;
    cells.forEach((c) => { occ[c] = blocks.length; });
    blocks.push(b);
    pos.push(p);
    return true;
  };

  // Key block, somewhere left of the exit, not already out.
  place({ r: exitRow, c: 0, len: 2, dir: 'h', key: true, tone: 0 }, pick(size - 3));
  blocks[0].c = pos[0];

  // Walls stay out of the exit row, so they never seal the exit.
  for (let w = 0; w < walls; w++) {
    for (let tries = 0; tries < 50; tries++) {
      const cell = pick(size * size);
      if (Math.floor(cell / size) === exitRow || occ[cell] !== -1) continue;
      occ[cell] = -2;
      wallCells.push(cell);
      break;
    }
  }

  const want = d.blocks[0] + pick(d.blocks[1] - d.blocks[0] + 1);
  for (let tries = 0; blocks.length < want && tries < 400; tries++) {
    const len = rng() < 0.28 ? 3 : 2;
    const dir = rng() < 0.5 ? 'h' : 'v';
    const fixed = pick(size); // row of an across block, column of a down block
    const p = pick(size - len + 1);
    // An across block in the exit row could never move out of the key's way.
    if (dir === 'h' && fixed === exitRow) continue;
    const b = dir === 'h'
      ? { r: fixed, c: p, len, dir, tone: 1 + pick(TONES - 1) }
      : { r: p, c: fixed, len, dir, tone: 1 + pick(TONES - 1) };
    place(b, p);
  }
  return { board: { size, exitRow, blocks, walls: wallCells }, pos };
}

// A fresh puzzle for the level: the board, its starting positions and its par.
// Tries random layouts and keeps the hardest board reachable in each, until one lands in
// the level's par range (or the tries run out, when the best found so far is used).
export function generate(level, { rng = Math.random, walls = true, tries = 400 } = {}) {
  const d = DIFFICULTIES[level];
  const [lo, hi] = d.par;
  let best = null;
  for (let t = 0; t < tries; t++) {
    const { board, pos } = randomBoard(level, rng, walls ? d.walls : 0);
    const found = hardestInReach(board, pos);
    if (!found || found.max < 1) continue;
    const target = Math.min(found.max, hi);
    if (!best || target > best.par) {
      // Several boards may share the target distance; take any of them.
      const pickFrom = [];
      found.dist.forEach((v, s) => { if (v === target) pickFrom.push(s); });
      const s = pickFrom[Math.floor(rng() * pickFrom.length)];
      best = { board, pos: Array.from(found.states.subarray(s * found.n, s * found.n + found.n)), par: target };
    }
    if (best.par >= lo) break;
  }
  // Store each block's starting place on the block itself as well.
  best.board.blocks.forEach((b, i) => { if (b.dir === 'h') b.c = best.pos[i]; else b.r = best.pos[i]; });
  return best;
}

// ---------- A game in progress ----------

export function newGame(level, puzzle) {
  return {
    level,
    board: puzzle.board,
    start: puzzle.pos.slice(),
    pos: puzzle.pos.slice(),
    par: puzzle.par,
    moves: 0,
    usedHint: false,
    won: false,
    recorded: false,
  };
}

// Slide block i to position p. Returns 'none', 'moved' or 'won'.
export function move(g, i, p) {
  if (g.won || p === g.pos[i]) return 'none';
  const [lo, hi] = slideRange(g.board, g.pos, i);
  if (p < lo || p > hi) return 'none';
  g.pos[i] = p;
  g.moves++;
  if (isSolvedPos(g.board, g.pos)) { g.won = true; return 'won'; }
  return 'moved';
}

export const snapshot = (g) => ({ pos: g.pos.slice(), moves: g.moves });
export function restore(g, s) {
  g.pos = s.pos.slice();
  g.moves = s.moves;
  g.won = false;
}

export function restart(g) {
  g.pos = g.start.slice();
  g.moves = 0;
  g.won = false;
}

// The next move of a shortest solution from here: [blockIndex, newPos], or null.
export function hint(g) {
  if (g.won) return null;
  return solve(g.board, g.pos)?.move || null;
}

// ---------- Ready-made puzzles (see bank.js) ----------

export function pack({ board, par }) {
  const blocks = board.blocks.map((b) => `${b.r}${b.c}${b.len}${b.dir}${b.tone}`).join(',');
  return `${board.size};${par};${board.walls.join('.')};${blocks}`;
}

// "size;par;walls;blocks" back into a puzzle. Each block is "rcLdT": row, column, length,
// h or v, wood tone. The key block comes first.
export function unpack(text) {
  const [sz, par, walls, blocks] = text.split(';');
  const list = blocks.split(',').map((s, i) => ({
    r: Number(s[0]), c: Number(s[1]), len: Number(s[2]), dir: s[3], tone: Number(s.slice(4)), ...(i === 0 ? { key: true } : {}),
  }));
  const size = Number(sz);
  return {
    board: { size, exitRow: exitRowFor(size), blocks: list, walls: walls ? walls.split('.').map(Number) : [] },
    pos: list.map((b) => (b.dir === 'h' ? b.c : b.r)),
    par: Number(par),
  };
}
