// Soft wooden knocks, made on the fly (no sound files). Off unless turned on in Settings.

let ctx = null;
let enabled = false;

export function setEnabled(on) { enabled = on; }

// Phones only allow audio to start from a touch, so wake it on each one.
export function unlock() {
  if (!enabled) return;
  try { audio()?.resume?.(); } catch { /* no audio */ }
}

function audio() {
  if (!ctx) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    ctx = new A();
  }
  return ctx;
}

// A short, low "tock": a sine dropping in pitch, with a quick fade.
function knock(freq, gain, length = 0.09) {
  if (!enabled) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.005;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + length);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + length + 0.02);
}

export const slide = () => knock(320, 0.18);
export const bump = () => knock(220, 0.08, 0.05);
export function win() {
  knock(392, 0.14, 0.14);
  setTimeout(() => knock(523, 0.12, 0.18), 120);
}
