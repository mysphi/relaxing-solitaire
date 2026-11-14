// Builds src/bank.js: a few ready-made puzzles per level, so a new puzzle can start
// at once even before the phone has made its own in the background.
// Run from the repo root: node blocks/tools/make-bank.mjs
import { writeFileSync } from 'node:fs';
import { DIFFICULTIES, generate, pack } from '../src/engine.js';

const PER = 10;
const out = {};
for (const level of Object.keys(DIFFICULTIES)) {
  for (const walls of DIFFICULTIES[level].walls ? [true, false] : [false]) {
    const list = [];
    while (list.length < PER) {
      const p = generate(level, { walls });
      if (p.par < DIFFICULTIES[level].par[0]) continue;
      list.push(pack(p));
      process.stderr.write(`${level} ${walls ? 'walls' : 'open'} ${list.length}/${PER} par ${p.par}\n`);
    }
    out[level + (walls ? '-walls' : '')] = list;
  }
}

const text = `// Made by tools/make-bank.mjs. Ready-made puzzles, used only while the phone is
// still making fresh ones in the background. Each is "size;par;walls;blocks" (see unpack in engine.js).
export const BANK = ${JSON.stringify(out, null, 1)};
`;
writeFileSync(new URL('../src/bank.js', import.meta.url), text);
