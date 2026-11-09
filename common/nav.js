// Shared by every game: the way back to the main menu.
// Games save as they go, so leaving mid-game is safe; the game resumes when picked again.
//
// The menu and the games swap places in the same history entry (location.replace), so the
// house button always lands on the menu, whatever happened before. For the phone's Back
// button, each game adds one entry of its own on the first touch; going back from it
// returns to the menu. (Chrome skips entries added before the page is touched.)

const LAST_KEY = 'relaxing-games-last'; // which game was played last (the menu borrows its colours)
const MARK = 'relaxing-games-back';

export function setupHome({ game, save }) {
  try { localStorage.setItem(LAST_KEY, game); } catch { /* storage blocked: nothing to remember */ }
  const hub = new URL('../', location.href).href;
  let leaving = false;
  let armed = history.state?.[MARK] === true;

  const leave = () => {
    if (leaving) return;
    leaving = true;
    save();
    const menu = document.getElementById('menu');
    if (menu) menu.hidden = true;
    location.replace(hub);
  };

  const arm = (e) => {
    if (armed || e.target.closest?.('[data-home]')) return;
    armed = true;
    history.pushState({ [MARK]: true }, '');
  };
  window.addEventListener('pointerup', arm, { capture: true });
  window.addEventListener('keydown', arm, { capture: true });
  window.addEventListener('popstate', () => { if (!history.state?.[MARK]) leave(); });

  // With our entry on top, step back off it and let popstate do the leaving, so the
  // game's entry is replaced too and Back from the menu closes the app.
  const goHome = () => (armed && history.state?.[MARK] ? history.back() : leave());
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', goHome));
  window.addEventListener('pagehide', save);
}
