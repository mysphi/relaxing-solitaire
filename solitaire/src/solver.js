// A Klondike solver, used to find deals that can definitely be won.
// It runs ahead of time (tools/find-winnable.js), never on the phone.
//
// It searches moves depth-first, remembers positions it has already seen, and
// gives up after a node limit. A deal counts as winnable only when it finds a
// complete winning line, which the caller then replays through engine.js to check.
// Giving up proves nothing, so the deal is simply left out.

import { newGame, move, draw, canPlaceOnFoundation } from './engine.js';

const SUIT_INDEX = { S: 0, H: 1, D: 2, C: 3 };
const RED = [false, true, true, false];

// Cards are numbers 0..51: suit * 13 + (rank - 1).
const suitOf = (c) => (c / 13) | 0;
const rankOf = (c) => (c % 13) + 1;
const red = (c) => RED[suitOf(c)];
const toNum = (card) => SUIT_INDEX[card.suit] * 13 + card.rank - 1;

function fromGame(g) {
  return {
    cols: g.tableau.map((p) => p.map(toNum)),
    down: g.tableau.map((p) => p.filter((c) => !c.up).length),
    stock: g.stock.map(toNum), // last element is the top
    waste: g.waste.map(toNum),
    found: [0, 0, 0, 0], // highest rank on each suit's foundation
    draw: g.drawCount,
  };
}

function copy(s) {
  return {
    cols: s.cols.map((c) => c.slice()),
    down: s.down.slice(),
    stock: s.stock.slice(),
    waste: s.waste.slice(),
    found: s.found.slice(),
    draw: s.draw,
  };
}

function key(s) {
  // Column order doesn't matter for solvability, so sort them to merge mirror positions.
  const cols = s.cols.map((c, i) => s.down[i] + ':' + String.fromCharCode(...c.map((x) => x + 48))).sort();
  return s.found.join(',') + '|' + cols.join('|') + '|' +
    String.fromCharCode(...s.waste.map((x) => x + 48)) + '/' + String.fromCharCode(...s.stock.map((x) => x + 48));
}

const canFound = (s, c) => s.found[suitOf(c)] === rankOf(c) - 1;
const canStack = (c, onto) => onto !== undefined && red(c) !== red(onto) && rankOf(onto) === rankOf(c) + 1;

// A card is safe to send up when no card still in play could need it as a base.
function safeToFound(s, c) {
  const r = rankOf(c);
  if (r <= 2) return true;
  const opp = red(c) ? [0, 3] : [1, 2];
  return s.found[opp[0]] >= r - 1 && s.found[opp[1]] >= r - 1;
}

function flip(s, i) {
  if (s.down[i] > 0 && s.down[i] === s.cols[i].length) s.down[i] -= 1;
}

// Moves are { t: type, ... } and are applied to a copy.
function apply(s, m) {
  const n = copy(s);
  switch (m.t) {
    case 'wf': { const c = n.waste.pop(); n.found[suitOf(c)]++; break; }
    case 'tf': { const c = n.cols[m.a].pop(); n.found[suitOf(c)]++; flip(n, m.a); break; }
    case 'wt': n.cols[m.b].push(n.waste.pop()); break;
    case 'tt': { const run = n.cols[m.a].splice(m.k); n.cols[m.b].push(...run); flip(n, m.a); break; }
    case 'ft': n.found[m.suit]--; n.cols[m.b].push(m.suit * 13 + n.found[m.suit]); break;
    case 'dr':
      if (n.stock.length) {
        for (let i = 0; i < n.draw && n.stock.length; i++) n.waste.push(n.stock.pop());
      } else {
        n.stock = n.waste.reverse();
        n.waste = [];
      }
      break;
  }
  return n;
}

function moves(s) {
  const out = [];
  const w = s.waste[s.waste.length - 1];
  // Foundation moves first.
  for (let i = 0; i < 7; i++) {
    const col = s.cols[i];
    if (col.length && canFound(s, col[col.length - 1])) out.push({ t: 'tf', a: i });
  }
  if (w !== undefined && canFound(s, w)) out.push({ t: 'wf' });

  // Tableau to tableau, only when it turns over a card, empties a column for a
  // useful king, or frees the card underneath for a foundation.
  for (let a = 0; a < 7; a++) {
    const col = s.cols[a];
    const firstUp = s.down[a];
    for (let k = firstUp; k < col.length; k++) {
      const c = col[k];
      const reveals = k === firstUp && k > 0;
      const frees = k > firstUp && canFound(s, col[k - 1]);
      if (!reveals && !frees) continue;
      for (let b = 0; b < 7; b++) {
        if (b === a) continue;
        const dest = s.cols[b];
        if (dest.length ? canStack(c, dest[dest.length - 1]) : rankOf(c) === 13) {
          out.push({ t: 'tt', a, b, k });
          if (!dest.length) break; // one empty column is as good as another
        }
      }
    }
  }
  // Waste onto the tableau.
  if (w !== undefined) {
    for (let b = 0; b < 7; b++) {
      const dest = s.cols[b];
      if (dest.length ? canStack(w, dest[dest.length - 1]) : rankOf(w) === 13) {
        out.push({ t: 'wt', b });
        if (!dest.length) break;
      }
    }
  }
  // Draw or recycle.
  if (s.stock.length || s.waste.length) out.push({ t: 'dr' });
  // Bringing a card back down from a foundation, rarely needed, tried last.
  for (let suit = 0; suit < 4; suit++) {
    const r = s.found[suit];
    if (r < 3) continue;
    const c = suit * 13 + r - 1;
    for (let b = 0; b < 7; b++) {
      const dest = s.cols[b];
      if (dest.length && canStack(c, dest[dest.length - 1])) { out.push({ t: 'ft', suit, b }); break; }
    }
  }
  return out;
}

const won = (s) => s.found.every((r) => r === 13);

// Returns the list of solver moves that wins, or null if none was found in time.
export function solve(game, { limit = 200000 } = {}) {
  const seen = new Set();
  let nodes = 0;
  const path = [];

  function dfs(s) {
    if (won(s)) return true;
    if (++nodes > limit) return false;
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);

    // Safe foundation moves are always right, so make one without branching.
    for (const m of moves(s)) {
      if ((m.t === 'tf' || m.t === 'wf')) {
        const c = m.t === 'wf' ? s.waste[s.waste.length - 1] : s.cols[m.a][s.cols[m.a].length - 1];
        if (safeToFound(s, c)) {
          path.push(m);
          if (dfs(apply(s, m))) return true;
          path.pop();
          return false;
        }
      }
    }
    for (const m of moves(s)) {
      path.push(m);
      if (dfs(apply(s, m))) return true;
      path.pop();
      if (nodes > limit) return false;
    }
    return false;
  }

  return dfs(fromGame(game)) ? path.slice() : null;
}

export function solveSeed(seed, drawCount, opts) {
  return solve(newGame({ seed, drawCount }), opts);
}

// Plays a solver line through the real rules in engine.js and returns the final
// state, or null if any step is illegal. This is the check that a deal really wins.
export function replay(seed, drawCount, path) {
  let g = newGame({ seed, drawCount });
  const slotFor = (card) => g.foundations.findIndex((f) => canPlaceOnFoundation(card, f));
  for (const m of path) {
    let next = null;
    if (m.t === 'dr') next = draw(g);
    else if (m.t === 'wf') next = move(g, { pile: 'waste' }, { pile: 'foundation', index: slotFor(g.waste[g.waste.length - 1]) });
    else if (m.t === 'tf') {
      const p = g.tableau[m.a];
      next = move(g, { pile: 'tableau', index: m.a, cardIndex: p.length - 1 }, { pile: 'foundation', index: slotFor(p[p.length - 1]) });
    } else if (m.t === 'wt') next = move(g, { pile: 'waste' }, { pile: 'tableau', index: m.b });
    else if (m.t === 'tt') next = move(g, { pile: 'tableau', index: m.a, cardIndex: m.k }, { pile: 'tableau', index: m.b });
    else if (m.t === 'ft') {
      const f = g.foundations.findIndex((pile) => pile.length && SUIT_INDEX[pile[0].suit] === m.suit);
      next = move(g, { pile: 'foundation', index: f }, { pile: 'tableau', index: m.b });
    }
    if (!next) return null;
    g = next;
  }
  return g;
}
