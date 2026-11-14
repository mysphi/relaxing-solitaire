// Everything is kept on the phone in localStorage. Nothing leaves the device.

const KEY = 'relaxing-blocks-v1';
export const LOOK_KEY = 'relaxing-blocks-look'; // read before first paint in index.html
const MAX_UNDO_SAVED = 400;
const MAX_HISTORY = 300;
export const LEVELS = ['easy', 'medium', 'hard', 'expert'];

export const defaultSettings = {
  difficulty: 'medium',
  tapToMove: false,
  walls: true,
  showMoves: true,
  sound: false,
  vibrate: true,
  appearance: 'auto', // auto follows the phone's light/dark setting
  table: 'sage',
};

// Per level: puzzles solved, solved at par, total moves over par (for the average),
// and runs of puzzles solved at par.
export const emptyStats = () => ({ solved: 0, atPar: 0, over: 0, streak: 0, bestStreak: 0 });

const allStats = (from = {}) => Object.fromEntries(LEVELS.map((l) => [l, { ...emptyStats(), ...(from[l] || {}) }]));

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      settings: { ...defaultSettings, ...(data.settings || {}) },
      game: data.game || null,
      undo: Array.isArray(data.undo) ? data.undo : [],
      history: Array.isArray(data.history) ? data.history : [],
      stats: allStats(data.stats),
      ready: data.ready && typeof data.ready === 'object' ? data.ready : {},
    };
  } catch {
    return null;
  }
}

export function fresh() {
  return { settings: { ...defaultSettings }, game: null, undo: [], history: [], stats: allStats(), ready: {} };
}

export function save({ settings, game, undo, history, stats, ready }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      settings,
      game,
      undo: undo.slice(-MAX_UNDO_SAVED),
      history: history.slice(-MAX_HISTORY),
      stats,
      ready,
    }));
    localStorage.setItem(LOOK_KEY, JSON.stringify({ appearance: settings.appearance, table: settings.table }));
  } catch {
    // Storage full or blocked: the game still plays, it just won't resume.
  }
}
