// Makes puzzles away from the screen, so the game never stutters while a hard one is found.
import { generate } from './engine.js';

self.onmessage = (e) => {
  const { level, walls, id } = e.data;
  const puzzle = generate(level, { walls });
  self.postMessage({ id, level, walls, puzzle });
};
