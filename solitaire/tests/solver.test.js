import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWon } from '../src/engine.js';
import { solveSeed, replay } from '../src/solver.js';
import { DRAW1, DRAW3 } from '../src/winnable.js';

// Re-check a sample of the shipped winnable deals on every deploy: the solver
// must find a line again, and that line must win under the real rules.
for (const [name, list, drawCount] of [['Draw 1', DRAW1, 1], ['Draw 3', DRAW3, 3]]) {
  test(`${name} winnable list is large, unique and spot-checks as winnable`, () => {
    assert.ok(list.length >= 100);
    assert.equal(new Set(list).size, list.length);
    for (let i = 0; i < 5; i++) {
      const seed = list[Math.floor(Math.random() * list.length)];
      const path = solveSeed(seed, drawCount, { limit: 150000 });
      assert.ok(path, `seed ${seed} should solve`);
      assert.ok(isWon(replay(seed, drawCount, path)), `seed ${seed} should replay to a win`);
    }
  });
}

test('replay rejects an illegal line', () => {
  assert.equal(replay(1, 1, [{ t: 'wt', b: 0 }]), null);
});
