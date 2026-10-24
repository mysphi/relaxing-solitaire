// Everything is kept on the phone in localStorage. Nothing leaves the device.

const KEY = 'calm-solitaire-v1';
const MAX_UNDO_SAVED = 300;
const MAX_HISTORY = 200;

export const defaultSettings = {
  drawCount: 1,
  scoring: 'standard',
  tapToMove: true,
  showMoves: true,
};

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
    };
  } catch {
    return null;
  }
}

export function save({ settings, game, undo, history }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      settings,
      game,
      undo: undo.slice(-MAX_UNDO_SAVED),
      history: history.slice(-MAX_HISTORY),
    }));
  } catch {
    // Storage full or blocked: the game still plays, it just won't resume.
  }
}
