import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTIES, generate, newGame, move, slideRange, occupancy, snapshot, restore, restart, hint,
  solve, pack, unpack, exitRowFor,
} from '../src/engine.js';
import { BANK } from '../src/bank.js';

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

// A hand-made 6 x 6 puzzle: key in row 2, one block standing in its way.
//   . . . . . .
//   . . . . V .
//   K K . . V .
//   . . . . . .
function tiny() {
  return {
    board: {
      size: 6,
      exitRow: 2,
      walls: [],
      blocks: [
        { r: 2, c: 0, len: 2, dir: 'h', key: true, tone: 0 },
        { r: 1, c: 4, len: 2, dir: 'v', tone: 1 },
      ],
    },
    pos: [0, 1],
    par: 2,
  };
}

function checkLegal(board, pos) {
  const occ = occupancy(board, pos);
  let filled = 0;
  for (const v of occ) if (v >= 0) filled++;
  const want = board.blocks.reduce((n, b) => n + b.len, 0);
  assert.equal(filled, want, 'blocks overlap each other or a wall');
  board.blocks.forEach((b, i) => {
    assert.ok(pos[i] >= 0 && pos[i] + b.len <= board.size, 'block sticks out of the board');
  });
}

test('blocks slide only as far as the way is clear', () => {
  const { board, pos } = tiny();
  assert.deepEqual(slideRange(board, pos, 0), [0, 2]); // stopped by the standing block
  assert.deepEqual(slideRange(board, pos, 1), [0, 4]); // free to the top and bottom
});

test('a slide of any length is one move, and the key reaching the exit wins', () => {
  const g = newGame('easy', tiny());
  assert.equal(move(g, 0, 3), 'none'); // blocked by the standing block
  assert.equal(move(g, 1, 5), 'none'); // off the board
  assert.equal(move(g, 0, 2), 'moved');
  assert.equal(g.moves, 1);
  assert.equal(move(g, 1, 3), 'moved'); // down out of the way
  assert.equal(move(g, 0, 4), 'won');
  assert.equal(g.moves, 3);
  assert.equal(g.won, true);
});

test('solver finds par and a first move that leads to it', () => {
  const { board, pos } = tiny();
  const s = solve(board, pos);
  assert.equal(s.par, 2);
  const g = newGame('easy', tiny());
  let steps = 0;
  while (!g.won) {
    const [i, p] = hint(g);
    assert.notEqual(move(g, i, p), 'none');
    steps++;
  }
  assert.equal(steps, 2);
});

test('undo and restart put the blocks back', () => {
  const g = newGame('easy', tiny());
  const s = snapshot(g);
  move(g, 1, 3);
  restore(g, s);
  assert.deepEqual(g.pos, [0, 1]);
  assert.equal(g.moves, 0);
  move(g, 1, 3);
  move(g, 0, 4);
  restart(g);
  assert.deepEqual(g.pos, [0, 1]);
  assert.equal(g.won, false);
});

test('made puzzles are legal, solvable, and par is right', () => {
  for (const level of ['easy', 'medium']) {
    for (let s = 1; s <= 6; s++) {
      const p = generate(level, { rng: rng(s) });
      const d = DIFFICULTIES[level];
      assert.equal(p.board.size, d.size);
      checkLegal(p.board, p.pos);
      assert.equal(p.board.blocks[0].key, true);
      assert.equal(p.board.blocks[0].r, exitRowFor(d.size));
      assert.ok(p.par >= 1 && p.par <= d.par[1]);
      assert.equal(solve(p.board, p.pos).par, p.par);
      // Walls never sit in the exit row.
      for (const w of p.board.walls) assert.notEqual(Math.floor(w / d.size), exitRowFor(d.size));
      // Packing keeps everything.
      const back = unpack(pack(p));
      assert.deepEqual(back.pos, p.pos);
      assert.deepEqual(back.board.walls, p.board.walls);
      assert.equal(back.par, p.par);
    }
  }
});

test('walls appear only when asked for', () => {
  const on = generate('medium', { rng: rng(3), walls: true });
  const off = generate('medium', { rng: rng(3), walls: false });
  assert.equal(on.board.walls.length, 1);
  assert.equal(off.board.walls.length, 0);
});

test('every ready-made puzzle is legal, in its level range, and has the right par', () => {
  for (const [key, list] of Object.entries(BANK)) {
    const [level, w] = key.split('-');
    const d = DIFFICULTIES[level];
    assert.ok(list.length >= 5, key);
    for (const text of list) {
      const p = unpack(text);
      assert.equal(p.board.size, d.size, key);
      assert.equal(p.board.walls.length, w ? d.walls : 0, key);
      checkLegal(p.board, p.pos);
      assert.ok(p.par >= d.par[0] && p.par <= d.par[1], `${key} par ${p.par}`);
      assert.equal(solve(p.board, p.pos).par, p.par, key);
    }
  }
});
