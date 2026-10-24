import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, move, draw, isLegalMove, canAutoComplete, isWon, findHint,
  bestDestination, nextFoundationMove, autoCompleteStep, SCORING,
} from '../src/engine.js';

const card = (id, up = true) => ({ id, suit: id[0], rank: Number(id.slice(1)), up });

function emptyState(extra = {}) {
  return {
    seed: 1, drawCount: 1, scoring: SCORING.standard,
    stock: [], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    score: 0, moves: 0, passes: 0, ...extra,
  };
}

test('deal has 28 tableau cards, 24 in stock, one face up per column', () => {
  const s = newGame({ seed: 42 });
  assert.equal(s.tableau.flat().length, 28);
  assert.equal(s.stock.length, 24);
  s.tableau.forEach((pile, i) => {
    assert.equal(pile.length, i + 1);
    assert.equal(pile.filter((c) => c.up).length, 1);
    assert.ok(pile[pile.length - 1].up);
  });
  const ids = new Set([...s.stock, ...s.tableau.flat()].map((c) => c.id));
  assert.equal(ids.size, 52);
});

test('same seed gives the same deal', () => {
  const a = newGame({ seed: 7 });
  const b = newGame({ seed: 7 });
  assert.deepEqual(a.tableau, b.tableau);
  assert.deepEqual(a.stock, b.stock);
});

test('tableau needs alternating colour, one rank lower', () => {
  const s = emptyState({ tableau: [[card('S9')], [card('H8')], [card('C8')], [], [], [], []] });
  assert.ok(isLegalMove(s, { pile: 'tableau', index: 1 }, { pile: 'tableau', index: 0 }));
  assert.ok(!isLegalMove(s, { pile: 'tableau', index: 2 }, { pile: 'tableau', index: 0 }));
});

test('only a king goes in an empty column', () => {
  const s = emptyState({ tableau: [[card('H12')], [card('S13')], [], [], [], [], []] });
  assert.ok(!isLegalMove(s, { pile: 'tableau', index: 0 }, { pile: 'tableau', index: 2 }));
  assert.ok(isLegalMove(s, { pile: 'tableau', index: 1, cardIndex: 0 }, { pile: 'tableau', index: 2 }));
});

test('foundation builds up by suit from the ace', () => {
  const s = emptyState({ waste: [card('H1')], tableau: [[card('H2')], [card('S2')], [], [], [], [], []] });
  const s1 = move(s, { pile: 'waste' }, { pile: 'foundation', index: 0 });
  assert.ok(s1);
  assert.equal(s1.score, 10);
  assert.ok(move(s1, { pile: 'tableau', index: 0 }, { pile: 'foundation', index: 0 }));
  assert.equal(move(s1, { pile: 'tableau', index: 1 }, { pile: 'foundation', index: 0 }), null);
});

test('moving a run flips the newly exposed card and scores it', () => {
  const s = emptyState({
    tableau: [[card('C5', false), card('H9'), card('S8')], [card('C10')], [], [], [], [], []],
  });
  const s1 = move(s, { pile: 'tableau', index: 0, cardIndex: 1 }, { pile: 'tableau', index: 1 });
  assert.ok(s1);
  assert.deepEqual(s1.tableau[1].map((c) => c.id), ['C10', 'H9', 'S8']);
  assert.ok(s1.tableau[0][0].up);
  assert.equal(s1.score, 5);
  assert.equal(s1.moves, 1);
});

test('a broken run cannot be picked up', () => {
  const s = emptyState({ tableau: [[card('H9'), card('D8')], [card('C10')], [], [], [], [], []] });
  assert.ok(!isLegalMove(s, { pile: 'tableau', index: 0, cardIndex: 0 }, { pile: 'tableau', index: 1 }));
});

test('draw 3 deals three and recycling turns the waste back', () => {
  let s = newGame({ seed: 3, drawCount: 3 });
  s = draw(s);
  assert.equal(s.waste.length, 3);
  assert.equal(s.stock.length, 21);
  for (let i = 0; i < 7; i++) s = draw(s);
  assert.equal(s.stock.length, 0);
  s = draw(s);
  assert.equal(s.waste.length, 0);
  assert.equal(s.stock.length, 24);
  assert.equal(s.passes, 1);
});

test('standard score never drops below zero', () => {
  let s = newGame({ seed: 5 });
  for (let i = 0; i < 25; i++) s = draw(s);
  assert.equal(s.score, 0);
});

test('vegas starts at -52 and pays 5 per foundation card', () => {
  const s = newGame({ seed: 1, scoring: SCORING.vegas });
  assert.equal(s.score, -52);
  const t = emptyState({ scoring: SCORING.vegas, score: -52, waste: [card('D1')] });
  assert.equal(move(t, { pile: 'waste' }, { pile: 'foundation', index: 2 }).score, -47);
});

test('no-scoring mode keeps score at zero', () => {
  const s = emptyState({ scoring: SCORING.none, waste: [card('D1')] });
  assert.equal(move(s, { pile: 'waste' }, { pile: 'foundation', index: 0 }).score, 0);
});

test('auto-complete only when everything is face up and nothing to draw', () => {
  const s = emptyState({ tableau: [[card('S1')], [card('S2', false)], [], [], [], [], []] });
  assert.ok(!canAutoComplete(s));
  s.tableau[1][0].up = true;
  assert.ok(canAutoComplete(s));
  assert.equal(nextFoundationMove(s).card.id, 'S1');
});

test('draw 1 can auto-complete with cards still in the stock, draw 3 cannot', () => {
  const s = emptyState({ tableau: [[card('S2')], [], [], [], [], [], []], stock: [card('S1', false)] });
  assert.ok(canAutoComplete(s));
  assert.ok(!canAutoComplete({ ...s, drawCount: 3 }));
});

test('auto-complete steps through the stock and finishes the game', () => {
  const suits = ['S', 'H', 'D', 'C'];
  // Every card face up in the tableau except the four aces, which wait in the stock.
  const tableau = suits.map((s) => Array.from({ length: 12 }, (_, i) => card(s + (13 - i))));
  let s = emptyState({ tableau: [...tableau, [], [], []], stock: suits.map((x) => card(x + 1, false)) });
  assert.ok(canAutoComplete(s));
  for (let i = 0; i < 200 && !isWon(s); i++) s = autoCompleteStep(s);
  assert.ok(isWon(s));
});

test('win is detected', () => {
  const s = emptyState();
  s.foundations = ['S', 'H', 'D', 'C'].map((suit) => Array.from({ length: 13 }, (_, i) => card(suit + (i + 1))));
  assert.ok(isWon(s));
});

test('hint prefers a foundation move, then falls back to drawing', () => {
  const s = emptyState({ tableau: [[card('D1')], [], [], [], [], [], []], stock: [card('C7', false)] });
  assert.equal(findHint(s).to.pile, 'foundation');
  const t = emptyState({ tableau: [[card('D5')], [], [], [], [], [], []], stock: [card('C7', false)] });
  assert.deepEqual(findHint(t), { draw: true });
});

test('tap-to-move sends an ace to the foundation and a card to a matching column', () => {
  const s = emptyState({ waste: [card('H1')], tableau: [[card('S9')], [card('D8')], [], [], [], [], []] });
  assert.equal(bestDestination(s, { pile: 'waste' }).pile, 'foundation');
  assert.deepEqual(bestDestination(s, { pile: 'tableau', index: 1, cardIndex: 0 }), { pile: 'tableau', index: 0 });
});

test('a whole random game of drawing and auto moves stays consistent', () => {
  let s = newGame({ seed: 99 });
  for (let step = 0; step < 300; step++) {
    const h = findHint(s);
    if (!h) break;
    const next = h.draw ? draw(s) : move(s, h.from, h.to);
    if (!next) break;
    s = next;
    const all = [...s.stock, ...s.waste, ...s.foundations.flat(), ...s.tableau.flat()];
    assert.equal(all.length, 52);
    assert.equal(new Set(all.map((c) => c.id)).size, 52);
  }
});
