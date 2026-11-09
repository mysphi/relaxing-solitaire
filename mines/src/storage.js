// Everything is kept on the phone in localStorage. Nothing leaves the device.

const KEY = 'relaxing-mines-v1';
export const LOOK_KEY = 'relaxing-mines-look'; // read before first paint in index.html
const MAX_UNDO_SAVED = 400;
const MAX_HISTORY = 300;

export const defaultSettings = {
  difficulty: 'medium',
  noGuess: true,
  chording: true,
  questionMarks: true,
  vibrate: true,
  showMoves: true,
  appearance: 'auto', // auto follows the phone's light/dark setting
  table: 'sage',
};

const emptyStats = () => ({ played: 0, won: 0, best: null });

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const stats = data.stats || {};
    return {
      settings: { ...defaultSettings, ...(data.settings || {}) },
      game: data.game || null,
      undo: Array.isArray(data.undo) ? data.undo : [],
      history: Array.isArray(data.history) ? data.history : [],
      stats: { easy: stats.easy || emptyStats(), medium: stats.medium || emptyStats(), hard: stats.hard || emptyStats() },
      flagMode: !!data.flagMode,
    };
  } catch {
    return null;
  }
}

export function fresh() {
  return {
    settings: { ...defaultSettings },
    game: null,
    undo: [],
    history: [],
    stats: { easy: emptyStats(), medium: emptyStats(), hard: emptyStats() },
    flagMode: false,
  };
}

export function save({ settings, game, undo, history, stats, flagMode }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      settings,
      game,
      undo: undo.slice(-MAX_UNDO_SAVED),
      history: history.slice(-MAX_HISTORY),
      stats,
      flagMode,
    }));
    localStorage.setItem(LOOK_KEY, JSON.stringify({ appearance: settings.appearance, table: settings.table }));
  } catch {
    // Storage full or blocked: the game still plays, it just won't resume.
  }
}
