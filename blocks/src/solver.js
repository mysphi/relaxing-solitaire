// Fast searches over every board a puzzle can reach. Used to make puzzles (find the
// hardest board in reach), to work out par, and for hints.
//
// Each board state is a list of block positions (0 to 7, so 3 bits each). States are
// kept side by side in one byte array and looked up by a number made from those bits,
// which keeps phones quick even when a puzzle has tens of thousands of states.

function compile(board) {
  const { size, blocks, walls } = board;
  const n = blocks.length;
  const pow = new Float64Array(n);
  for (let i = 0; i < n; i++) pow[i] = 8 ** i;
  const base = new Int8Array(size * size).fill(-1);
  for (const w of walls) base[w] = -2;
  const key = blocks.findIndex((b) => b.key);
  return {
    size, n, pow, base, key,
    goal: size - blocks[key].len,
    dir: blocks.map((b) => (b.dir === 'h' ? 1 : size)), // step between a block's cells
    fixed: blocks.map((b) => (b.dir === 'h' ? b.r * size : b.c)), // cell of position 0
    scale: blocks.map((b) => (b.dir === 'h' ? 1 : size)), // cells per position step
    len: blocks.map((b) => b.len),
  };
}

const codeOf = (k, pos) => {
  let c = 0;
  for (let i = 0; i < k.n; i++) c += pos[i] * k.pow[i];
  return c;
};

// Calls visit(i, p, code) for every single slide from pos (code is the new state's number).
function expand(k, pos, code, occ, visit) {
  occ.set(k.base);
  for (let i = 0; i < k.n; i++) {
    let cell = k.fixed[i] + pos[i] * k.scale[i];
    for (let j = 0; j < k.len[i]; j++, cell += k.dir[i]) occ[cell] = i;
  }
  for (let i = 0; i < k.n; i++) {
    const at = (p) => k.fixed[i] + p * k.scale[i];
    const here = pos[i];
    for (let p = here - 1; p >= 0 && occ[at(p)] === -1; p--) visit(i, p, code + (p - here) * k.pow[i]);
    for (let p = here + 1; p + k.len[i] <= k.size && occ[at(p + k.len[i] - 1)] === -1; p++) {
      visit(i, p, code + (p - here) * k.pow[i]);
    }
  }
}

// Every board reachable from pos. Returns { k, states (flat bytes), count, index } or null
// if there are more than `limit` of them.
function reach(board, pos, limit) {
  const k = compile(board);
  const n = k.n;
  let states = new Uint8Array(Math.min(limit, 4096) * n);
  const index = new Map();
  states.set(pos, 0);
  index.set(codeOf(k, pos), 0);
  let count = 1;
  const occ = new Int8Array(k.size * k.size);
  const cur = new Uint8Array(n);
  for (let s = 0; s < count; s++) {
    cur.set(states.subarray(s * n, s * n + n));
    const code = codeOf(k, cur);
    let over = false;
    expand(k, cur, code, occ, (i, p, c) => {
      if (over || index.has(c)) return;
      if (count >= limit) { over = true; return; }
      if ((count + 1) * n > states.length) {
        const bigger = new Uint8Array(states.length * 2);
        bigger.set(states);
        states = bigger;
      }
      const o = count * n;
      states.set(cur, o);
      states[o + i] = p;
      index.set(c, count++);
    });
    if (over) return null;
  }
  return { k, states, count, index };
}

// The hardest boards in reach of pos. Moves can always be undone, so distance to solved
// is found by one search outward from every solved board at once.
// Returns { states, count, dist, max, size: n } or null when unsolvable or too big.
export function hardestInReach(board, pos, limit = 60000) {
  const r = reach(board, pos, limit);
  if (!r) return null;
  const { k, states, count, index } = r;
  const n = k.n;
  const dist = new Int16Array(count).fill(-1);
  let frontier = [];
  for (let s = 0; s < count; s++) {
    if (states[s * n + k.key] === k.goal) { dist[s] = 0; frontier.push(s); }
  }
  if (!frontier.length) return null;
  const occ = new Int8Array(k.size * k.size);
  const cur = new Uint8Array(n);
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      cur.set(states.subarray(s * n, s * n + n));
      expand(k, cur, codeOf(k, cur), occ, (i, p, c) => {
        const t = index.get(c);
        if (dist[t] === -1) { dist[t] = depth + 1; next.push(t); }
      });
    }
    if (!next.length) break;
    depth++;
    frontier = next;
  }
  return { states, count, dist, max: depth, n };
}

// Fewest moves from pos to solved, and the first move of one shortest way:
// { par, move: [blockIndex, newPos] }. null if it can't be solved.
export function solve(board, pos, limit = 300000) {
  const k = compile(board);
  if (pos[k.key] === k.goal) return { par: 0, move: null };
  const first = new Map(); // state number -> first move that led there
  const startCode = codeOf(k, pos);
  first.set(startCode, null);
  let frontier = [Uint8Array.from(pos)];
  const occ = new Int8Array(k.size * k.size);
  for (let depth = 1; frontier.length && first.size < limit; depth++) {
    const next = [];
    let found = null;
    for (const cur of frontier) {
      const code = codeOf(k, cur);
      const from = first.get(code);
      expand(k, cur, code, occ, (i, p, c) => {
        if (found || first.has(c)) return;
        const m = from || [i, p];
        first.set(c, m);
        if (i === k.key && p === k.goal) { found = m; return; }
        const q = cur.slice();
        q[i] = p;
        next.push(q);
      });
      if (found) return { par: depth, move: found };
    }
    frontier = next;
  }
  return null;
}
