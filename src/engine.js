// Klondike rules. Pure functions over plain state objects, no DOM.
// Every action returns a new state (or null if the move is illegal),
// so undo is just keeping the previous states.

export const SUITS = ['S', 'H', 'D', 'C'];
export const RED = new Set(['H', 'D']);

export const SCORING = {
  standard: 'standard',
  vegas: 'vegas',
  none: 'none',
};

// Small seeded RNG so "Restart this deal" can replay the same shuffle.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: suit + rank, suit, rank, up: false });
    }
  }
  return deck;
}

export function shuffle(deck, seed) {
  const rand = mulberry32(seed);
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function newGame({ seed = Date.now() >>> 0, drawCount = 1, scoring = SCORING.standard } = {}) {
  const deck = shuffle(makeDeck(), seed);
  const tableau = [[], [], [], [], [], [], []];
  let k = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row <= col; row++) {
      const card = { ...deck[k++] };
      card.up = row === col;
      tableau[col].push(card);
    }
  }
  const stock = deck.slice(k).map((c) => ({ ...c, up: false }));
  return {
    seed,
    drawCount,
    scoring,
    stock,
    waste: [],
    foundations: [[], [], [], []],
    tableau,
    score: scoring === SCORING.vegas ? -52 : 0,
    moves: 0,
    passes: 0,
  };
}

export function clone(state) {
  return {
    ...state,
    stock: state.stock.map((c) => ({ ...c })),
    waste: state.waste.map((c) => ({ ...c })),
    foundations: state.foundations.map((p) => p.map((c) => ({ ...c }))),
    tableau: state.tableau.map((p) => p.map((c) => ({ ...c }))),
  };
}

export const isRed = (card) => RED.has(card.suit);
const top = (pile) => pile[pile.length - 1];

export function canPlaceOnTableau(card, pile) {
  const t = top(pile);
  if (!t) return card.rank === 13;
  return t.up && isRed(t) !== isRed(card) && t.rank === card.rank + 1;
}

export function canPlaceOnFoundation(card, pile) {
  const t = top(pile);
  if (!t) return card.rank === 1;
  return t.suit === card.suit && t.rank === card.rank - 1;
}

// A source is { pile: 'waste' | 'tableau' | 'foundation', index, cardIndex }.
// Returns the cards that would move, or null if that pick-up isn't allowed.
export function pickUp(state, from) {
  if (from.pile === 'waste') {
    const c = top(state.waste);
    return c ? [c] : null;
  }
  if (from.pile === 'foundation') {
    const c = top(state.foundations[from.index]);
    return c ? [c] : null;
  }
  if (from.pile === 'tableau') {
    const pile = state.tableau[from.index];
    const i = from.cardIndex ?? pile.length - 1;
    if (i < 0 || i >= pile.length || !pile[i].up) return null;
    const run = pile.slice(i);
    for (let j = 1; j < run.length; j++) {
      const a = run[j - 1];
      const b = run[j];
      if (isRed(a) === isRed(b) || a.rank !== b.rank + 1) return null;
    }
    return run;
  }
  return null;
}

export function isLegalMove(state, from, to) {
  const cards = pickUp(state, from);
  if (!cards) return false;
  if (to.pile === from.pile && to.index === from.index) return false;
  if (to.pile === 'foundation') {
    return cards.length === 1 && canPlaceOnFoundation(cards[0], state.foundations[to.index]);
  }
  if (to.pile === 'tableau') {
    return canPlaceOnTableau(cards[0], state.tableau[to.index]);
  }
  return false;
}

function addScore(state, points) {
  if (state.scoring === SCORING.none) return;
  state.score += points;
  if (state.scoring === SCORING.standard && state.score < 0) state.score = 0;
}

function standardPoints(from, to) {
  if (from.pile === 'waste' && to.pile === 'tableau') return 5;
  if (from.pile === 'waste' && to.pile === 'foundation') return 10;
  if (from.pile === 'tableau' && to.pile === 'foundation') return 10;
  if (from.pile === 'foundation' && to.pile === 'tableau') return -15;
  return 0;
}

export function move(state, from, to) {
  if (!isLegalMove(state, from, to)) return null;
  const s = clone(state);
  let cards;
  if (from.pile === 'waste') cards = [s.waste.pop()];
  else if (from.pile === 'foundation') cards = [s.foundations[from.index].pop()];
  else {
    const pile = s.tableau[from.index];
    const i = from.cardIndex ?? pile.length - 1;
    cards = pile.splice(i);
  }
  const dest = to.pile === 'foundation' ? s.foundations[to.index] : s.tableau[to.index];
  dest.push(...cards);

  if (s.scoring === SCORING.standard) addScore(s, standardPoints(from, to));
  if (s.scoring === SCORING.vegas) {
    if (to.pile === 'foundation') addScore(s, 5);
    if (from.pile === 'foundation') addScore(s, -5);
  }

  // Turn over the newly exposed card.
  if (from.pile === 'tableau') {
    const t = top(s.tableau[from.index]);
    if (t && !t.up) {
      t.up = true;
      if (s.scoring === SCORING.standard) addScore(s, 5);
    }
  }
  s.moves += 1;
  return s;
}

// Tap on the stock: deal one or three to the waste, or turn the waste back over.
export function draw(state) {
  const s = clone(state);
  if (s.stock.length === 0) {
    if (s.waste.length === 0) return null;
    s.stock = s.waste.reverse().map((c) => ({ ...c, up: false }));
    s.waste = [];
    s.passes += 1;
    if (s.scoring === SCORING.standard) addScore(s, s.drawCount === 1 ? -100 : -20);
  } else {
    const n = Math.min(s.drawCount, s.stock.length);
    for (let i = 0; i < n; i++) {
      const c = s.stock.pop();
      c.up = true;
      s.waste.push(c);
    }
  }
  s.moves += 1;
  return s;
}

export function isWon(state) {
  return state.foundations.every((p) => p.length === 13);
}

// All remaining cards face up with nothing left to draw: the game can finish itself.
export function canAutoComplete(state) {
  if (isWon(state)) return false;
  if (state.stock.length || state.waste.length) return false;
  return state.tableau.every((p) => p.every((c) => c.up));
}

// One step of auto-complete: the lowest card that can go to a foundation.
export function nextFoundationMove(state) {
  let best = null;
  const consider = (from, card) => {
    for (let f = 0; f < 4; f++) {
      if (canPlaceOnFoundation(card, state.foundations[f])) {
        if (!best || card.rank < best.card.rank) best = { from, to: { pile: 'foundation', index: f }, card };
        return;
      }
    }
  };
  const w = top(state.waste);
  if (w) consider({ pile: 'waste' }, w);
  state.tableau.forEach((p, i) => {
    const t = top(p);
    if (t && t.up) consider({ pile: 'tableau', index: i, cardIndex: p.length - 1 }, t);
  });
  return best;
}

// Best place for a tapped card, or null. Foundation first, then a tableau column
// (non-empty columns before empty ones, so kings don't hop about needlessly).
export function bestDestination(state, from) {
  const cards = pickUp(state, from);
  if (!cards) return null;
  if (cards.length === 1 && from.pile !== 'foundation') {
    for (let f = 0; f < 4; f++) {
      const to = { pile: 'foundation', index: f };
      if (isLegalMove(state, from, to)) return to;
    }
  }
  const order = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => (state.tableau[a].length === 0) - (state.tableau[b].length === 0));
  for (const i of order) {
    const to = { pile: 'tableau', index: i };
    if (isLegalMove(state, from, to)) {
      // Moving a king from the bottom of one column to an empty one achieves nothing.
      if (from.pile === 'tableau' && state.tableau[i].length === 0 && from.cardIndex === 0) continue;
      return to;
    }
  }
  return null;
}

// A helpful move for the Hint button. Returns { from, to } or { draw: true } or null.
export function findHint(state) {
  const fm = nextFoundationMove(state);
  if (fm) return { from: fm.from, to: fm.to };

  // Moves that turn over a face-down card.
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const firstUp = pile.findIndex((c) => c.up);
    if (firstUp <= 0) continue;
    const from = { pile: 'tableau', index: i, cardIndex: firstUp };
    for (let j = 0; j < 7; j++) {
      const to = { pile: 'tableau', index: j };
      if (isLegalMove(state, from, to)) return { from, to };
    }
  }
  // Waste card onto the tableau.
  if (state.waste.length) {
    const from = { pile: 'waste' };
    for (let j = 0; j < 7; j++) {
      const to = { pile: 'tableau', index: j };
      if (isLegalMove(state, from, to)) return { from, to };
    }
  }
  // King run into an empty column, when it frees face-down cards.
  for (let i = 0; i < 7; i++) {
    const pile = state.tableau[i];
    const firstUp = pile.findIndex((c) => c.up);
    if (firstUp > 0 && pile[firstUp].rank === 13) {
      for (let j = 0; j < 7; j++) {
        if (state.tableau[j].length === 0) return { from: { pile: 'tableau', index: i, cardIndex: firstUp }, to: { pile: 'tableau', index: j } };
      }
    }
  }
  if (state.stock.length || state.waste.length) return { draw: true };
  return null;
}
