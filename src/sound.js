// Soft card sounds. Placing a card and shuffling use short real recordings
// (sounds/, about 28 KB together); the smaller sounds are made on the fly from
// filtered noise. Real card sounds sit almost entirely between 1.5 and 10 kHz,
// so nothing here has any low, woody body to it. Off unless enabled.

let ctx = null;
let enabled = false;
let noiseBuf = null;
const samples = {};
const SAMPLE_FILES = { down: 'card-down.m4a', shuffle: 'shuffle.m4a' };

export function setEnabled(on) {
  enabled = on;
  if (on) preload();
}

// Phones only allow audio to start from a touch, so wake it up on each one.
// It also retries loading the recordings if an earlier attempt failed.
export function unlock() {
  if (!enabled) return;
  try { audio(); preload(); } catch {}
}

// Fetch and decode the recordings once. The audio can be created (paused)
// without a touch, which is enough to decode them ahead of time.
let loading = null;
function preload() {
  if (loading) return;
  try {
    const a = audio();
    if (!a) return;
    loading = Promise.all(Object.entries(SAMPLE_FILES).map(async ([name, file]) => {
      const res = await fetch(new URL(`../sounds/${file}`, import.meta.url));
      samples[name] = await a.decodeAudioData(await res.arrayBuffer());
    })).catch(() => { loading = null; });
  } catch {}
}

function sample(a, t, name, { gain = 1, rate = 1 } = {}) {
  const buf = samples[name];
  if (!buf) return false;
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(g).connect(a.destination);
  src.start(t);
  return true;
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

// Setting a card down: the recording, with a touch of variation each time
// so repeated moves don't sound identical.
function place(a, t, loud = 1) {
  if (sample(a, t, 'down', { gain: 0.8 * loud, rate: 0.94 + Math.random() * 0.12 })) return;
  // Until the recording has loaded: a light, high papery tap with no low end.
  burst(a, t, { length: 0.05, type: 'highpass', freq: 2000, freqEnd: 3500, q: 0.5, gain: 0.05 * loud, attack: 0.012 });
  burst(a, t + 0.035, { length: 0.03, freq: 3500, q: 0.8, gain: 0.09 * loud });
}

// Turning a card over: a quick, light flick.
function flip(a, t) {
  burst(a, t, { length: 0.04, freq: 3800, freqEnd: 2200, q: 1.0, gain: 0.07, attack: 0.008 });
}

// Turning the waste back over onto the stock: a light paper sweep, then the
// cards set down.
function gather(a, t) {
  burst(a, t, { length: 0.16, type: 'highpass', freq: 2500, freqEnd: 4000, q: 0.5, gain: 0.04, attack: 0.05 });
  place(a, t + 0.12, 0.8);
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
      // Stretch or squeeze the recording slightly so it ends as the deal does.
      sample(a, t, 'shuffle', {
        gain: 0.8,
        rate: samples.shuffle && opts?.duration > 0 ? samples.shuffle.duration / opts.duration : 1,
      });
      break;
    case 'gather':
      gather(a, t);
      break;
    case 'win':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(a, t + i * 0.16, f));
      break;
  }
}
