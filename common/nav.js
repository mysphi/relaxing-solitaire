// Shared by every game: the way back to the main menu.
// Games save as they go, so leaving mid-game is safe; the game resumes when picked again.

const LAST_KEY = 'relaxing-games-last'; // which game was played last (the menu borrows its colours)

export function setupHome({ game, save }) {
  try { localStorage.setItem(LAST_KEY, game); } catch { /* storage blocked: nothing to remember */ }
  const leave = () => {
    save();
    const menu = document.getElementById('menu');
    if (menu) menu.hidden = true;
    goHome();
  };
  document.querySelectorAll('[data-home]').forEach((b) => b.addEventListener('click', leave));
  window.addEventListener('pagehide', save);
}

function goHome() {
  const hub = new URL('../', location.href);
  let cameFromHub = false;
  try { cameFromHub = new URL(document.referrer).pathname === hub.pathname; } catch { /* no referrer */ }
  // Going back keeps the phone's Back button tidy: Back from a game shows the menu,
  // and Back from the menu closes the app.
  if (cameFromHub && history.length > 1) history.back();
  else location.replace(hub.href);
}
