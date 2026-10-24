// Soft card sounds, made on the fly with the browser's audio, so there are no
// sound files to download. Everything is quiet and short. Off unless enabled.
//
// Real card sounds are mostly paper noise: a slide across the table ends in a
// soft, low tap, and a riffle shuffle is dozens of tiny flicks in a burst.
// Each sound here is built from short slices of filtered noise shaped like that.

let ctx = null;
let enabled = false;
let noiseBuf = null;

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

// One second of white noise, made once and reused for every sound.
function noise(a) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// A slice of filtered noise with its own volume shape. The filter can sweep
// from `freq` to `freqEnd`, which is what makes a slide sound like it moves.
function burst(a, t, { length, type = 'bandpass', freq, freqEnd = freq, q = 0.7, gain, attack = 0.003 }) {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(freqEnd, t + length);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.8, length + 0.02);
}

// A card sliding a little way and settling onto the pile: a short papery
// swish, then a soft, muffled tap as it lands.
function place(a, t, loud = 1) {
  burst(a, t, { length: 0.07, freq: 3200, freqEnd: 1400, q: 0.6, gain: 0.05 * loud, attack: 0.02 });
  burst(a, t + 0.055, { length: 0.05, type: 'lowpass', freq: 900, freqEnd: 300, q: 0.9, gain: 0.32 * loud });
  burst(a, t + 0.055, { length: 0.018, freq: 2400, q: 1.5, gain: 0.05 * loud });
}

// Turning a card over: a quick, light flick.
function flip(a, t) {
  burst(a, t, { length: 0.04, freq: 3800, freqEnd: 2200, q: 1.0, gain: 0.07, attack: 0.008 });
}

// A riffle shuffle: two halves of the deck flick together, quickly at first and
// thinning out at the end, then the cards are squared up with a soft knock.
function riffle(a, t) {
  const flicks = 46;
  const span = 0.75;
  let time = t;
  for (let i = 0; i < flicks; i++) {
    const p = i / (flicks - 1);
    const swell = Math.sin(Math.PI * Math.min(1, p * 1.15)) * 0.8 + 0.2;
    burst(a, time, {
      length: 0.012 + Math.random() * 0.008,
      type: 'highpass',
      freq: 2200 + Math.random() * 1800,
      q: 0.5,
      gain: 0.07 * swell * (0.7 + Math.random() * 0.6),
      attack: 0.001,
    });
    // Flicks start close together and spread out as the halves run out.
    time += (span / flicks) * (0.6 + p * 0.9) * (0.8 + Math.random() * 0.4);
  }
  // The cards falling together in the bridge, then tapped square on the table.
  burst(a, time + 0.02, { length: 0.22, freq: 2600, freqEnd: 900, q: 0.5, gain: 0.05, attack: 0.04 });
  burst(a, time + 0.28, { length: 0.05, type: 'lowpass', freq: 700, freqEnd: 250, gain: 0.3 });
  burst(a, time + 0.40, { length: 0.05, type: 'lowpass', freq: 700, freqEnd: 250, gain: 0.22 });
}

// Turning the waste back over onto the stock: one longer sweep.
function gather(a, t) {
  burst(a, t, { length: 0.18, freq: 1800, freqEnd: 3200, q: 0.5, gain: 0.05, attack: 0.05 });
  burst(a, t + 0.16, { length: 0.05, type: 'lowpass', freq: 800, freqEnd: 300, gain: 0.25 });
}

// A soft sine note with a gentle fade, for the win chime.
function note(a, t, freq, length = 0.9, gain = 0.07) {
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
    const a = audio();
    if (!a) return;
    if (a.state === 'running') playNow(a, name, opts);
    // Just woken up by this touch: play as soon as the audio is ready.
    else a.resume().then(() => { try { playNow(a, name, opts); } catch {} }).catch(() => {});
  } catch {}
}

function playNow(a, name, opts) {
  if (!Number.isFinite(a.currentTime)) return;
  const at = Number.isFinite(opts?.at) ? opts.at : 0;
  const count = Number.isFinite(opts?.count) ? opts.count : 1;
  const t = a.currentTime + 0.01 + at;
  switch (name) {
    case 'place':
      place(a, t);
      break;
    case 'flip':
      flip(a, t);
      break;
    case 'deal':
      for (let i = 0; i < count; i++) place(a, t + i * 0.07, 0.7);
      break;
    case 'shuffle':
      riffle(a, t);
      break;
    case 'gather':
      gather(a, t);
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(a, t + i * 0.16, f));
      break;
  }
}
