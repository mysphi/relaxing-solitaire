// Soft card sounds, made on the fly with the browser's audio, so there are no
// sound files to download. Everything is quiet and short. Off unless enabled.

let ctx = null;
let enabled = false;

export function setEnabled(on) {
  enabled = on;
}

// Phones only allow audio to start from a touch, so wake it up on each one.
export function unlock() {
  if (!enabled) return;
  try { audio(); } catch {}
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A short burst of filtered noise: the papery tap of a card landing.
function tap({ freq = 1800, q = 0.8, gain = 0.18, length = 0.05, at = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const frames = Math.ceil(a.sampleRate * length);
  const buf = a.createBuffer(1, frames, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

// A soft sine note with a gentle fade, for the win chime.
function note(freq, at, length = 0.9, gain = 0.07) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

// Sound is a nice extra: if the phone's audio misbehaves, stay quiet and let the game carry on.
export function play(name, opts) {
  if (!enabled) return;
  try {
    playUnsafe(name, opts);
  } catch {}
}

function playUnsafe(name, opts) {
  const a = audio();
  if (!a || a.state !== 'running' || !Number.isFinite(a.currentTime)) return;
  const at = Number.isFinite(opts?.at) ? opts.at : 0;
  const count = Number.isFinite(opts?.count) ? opts.count : 1;
  switch (name) {
    case 'place':
      tap({ freq: 1400, gain: 0.2, at });
      break;
    case 'flip':
      tap({ freq: 2600, q: 1.2, gain: 0.12, length: 0.035, at });
      break;
    case 'deal':
      for (let i = 0; i < count; i++) tap({ freq: 2000, gain: 0.12, length: 0.035, at: at + i * 0.07 });
      break;
    case 'shuffle':
      for (let i = 0; i < 10; i++) tap({ freq: 1800 + Math.random() * 600, gain: 0.08, length: 0.03, at: at + i * 0.05 });
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, at + i * 0.16));
      break;
  }
}
