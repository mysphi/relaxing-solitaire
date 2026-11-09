// A logic-only solver. It looks at what the player can see (opened cells and their
// numbers) and works out which hidden cells are certainly safe or certainly mines.
// It is used to build no-guessing boards and to give hints.

export function neighbourList(cols, rows) {
  const list = [];
  for (let i = 0; i < cols * rows; i++) {
    const r = Math.floor(i / cols), c = i % cols, out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
      }
    }
    list.push(out);
  }
  return list;
}

// open[i]: true when the cell is showing its number. adj[i]: that number.
// Returns { safe, mine }: sets of hidden cells that logic proves are safe or mines.
export function deduce({ nbrs, open, adj, totalMines }) {
  const n = open.length;
  const mine = new Set();
  const safe = new Set();
  const known = (i) => mine.has(i) || safe.has(i);

  // Number cells that still touch something hidden.
  const clues = [];
  for (let i = 0; i < n; i++) {
    if (open[i] && adj[i] > 0 && nbrs[i].some((j) => !open[j])) clues.push(i);
  }

  let progress = true;
  while (progress) {
    progress = false;

    // Each clue becomes "these unknown cells hold this many mines".
    const cons = [];
    for (const i of clues) {
      const unknown = [];
      let need = adj[i];
      for (const j of nbrs[i]) {
        if (open[j]) continue;
        if (mine.has(j)) need--;
        else if (!safe.has(j)) unknown.push(j);
      }
      if (unknown.length) cons.push({ cells: unknown, need });
    }

    const markAll = (cells, asMine) => {
      for (const j of cells) {
        if (known(j)) continue;
        (asMine ? mine : safe).add(j);
        progress = true;
      }
    };

    // Simple rule: a number already satisfied, or one that needs every cell it touches.
    for (const k of cons) {
      if (k.need === 0) markAll(k.cells, false);
      else if (k.need === k.cells.length) markAll(k.cells, true);
    }
    if (progress) continue;

    // Pair rule: compare two nearby numbers that share cells.
    const byCell = new Map();
    cons.forEach((k, idx) => k.cells.forEach((c) => {
      if (!byCell.has(c)) byCell.set(c, []);
      byCell.get(c).push(idx);
    }));
    for (let a = 0; a < cons.length && !progress; a++) {
      const A = cons[a], setA = new Set(A.cells);
      const partners = new Set();
      A.cells.forEach((c) => byCell.get(c).forEach((b) => { if (b !== a) partners.add(b); }));
      for (const b of partners) {
        const B = cons[b];
        const setB = new Set(B.cells);
        const onlyB = B.cells.filter((c) => !setA.has(c));
        const onlyA = A.cells.filter((c) => !setB.has(c));
        const shared = A.cells.length - onlyA.length;
        // How many mines can sit in the shared cells, given both numbers?
        const lo = Math.max(0, A.need - onlyA.length, B.need - onlyB.length);
        const hi = Math.min(shared, A.need, B.need);
        if (lo > hi) continue; // inconsistent view (cannot happen on a real board)
        // Then each side's own cells hold need minus that.
        for (const [own, need] of [[onlyA, A.need], [onlyB, B.need]]) {
          if (!own.length) continue;
          if (need - lo === 0) markAll(own, false);
          else if (need - hi === own.length) markAll(own, true);
        }
        if (progress) break;
      }
    }
    if (progress) continue;

    // Mine count rule: once every mine is found, the rest are safe, and so on.
    let hidden = 0;
    for (let i = 0; i < n; i++) if (!open[i] && !known(i)) hidden++;
    const left = totalMines - mine.size;
    if (hidden > 0 && left === 0) {
      for (let i = 0; i < n; i++) if (!open[i] && !known(i)) { safe.add(i); progress = true; }
    } else if (hidden > 0 && left === hidden) {
      for (let i = 0; i < n; i++) if (!open[i] && !known(i)) { mine.add(i); progress = true; }
    }
  }
  return { safe, mine };
}

// Can this board be cleared by logic alone, starting from one tap on `start`?
export function solvableFrom({ cols, rows, mines, isMine, adj, nbrs }, start) {
  const n = cols * rows;
  const open = new Array(n).fill(false);
  const flood = (i) => {
    const stack = [i];
    while (stack.length) {
      const k = stack.pop();
      if (open[k]) continue;
      open[k] = true;
      if (adj[k] === 0) for (const j of nbrs[k]) if (!open[j] && !isMine[j]) stack.push(j);
    }
  };
  if (isMine[start]) return false;
  flood(start);
  const safeTotal = n - mines;
  for (;;) {
    let opened = 0;
    for (let i = 0; i < n; i++) if (open[i]) opened++;
    if (opened === safeTotal) return true;
    const { safe } = deduce({ nbrs, open, adj, totalMines: mines });
    if (!safe.size) return false;
    for (const i of safe) {
      if (isMine[i]) return false; // never happens with sound logic; guards against bugs
      flood(i);
    }
  }
}
