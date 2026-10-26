/** Reference samples for bead actions; synthesized cues for actions absent from the video. */
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let generation = 0;
const pending = new Set<() => void>();
const active = new Set<AudioScheduledSourceNode>();

function flushPending() {
  for (const run of [...pending]) run();
}

const urls = {
  pick: new URL('./assets/audio/pick.wav', import.meta.url).href,
  place: new URL('./assets/audio/place.wav', import.meta.url).href,
  slot: new URL('./assets/audio/slot.wav', import.meta.url).href,
  complete: new URL('./assets/audio/complete.wav', import.meta.url).href,
  win: new URL('./assets/audio/win.wav', import.meta.url).href,
};
type Sample = keyof typeof urls;
const raw = new Map<Sample, Promise<ArrayBuffer | null>>();
const decoded = new Map<Sample, AudioBuffer>();
const decoding = new Map<Sample, Promise<AudioBuffer | null>>();

function load(name: Sample) {
  let pending = raw.get(name);
  if (!pending) {
    pending = fetch(urls[name]).then(r => {
      if (!r.ok) throw new Error(`Sound ${name}: ${r.status}`);
      return r.arrayBuffer();
    }).catch(() => null);
    raw.set(name, pending);
  }
  return pending;
}

function buffer(a: AudioContext, name: Sample) {
  let pending = decoding.get(name);
  if (!pending) {
    pending = load(name).then(data => data ? a.decodeAudioData(data.slice(0)) : null)
      .then(value => { if (value && a === ac) decoded.set(name, value); return value; })
      .catch(() => null);
    decoding.set(name, pending);
  }
  return pending;
}

export function setSoundEnabled(value: boolean) {
  if (enabled !== value) generation++;
  enabled = value;
  if (master && ac) master.gain.setValueAtTime(value ? 0.8 : 0, ac.currentTime);
  if (!value) {
    pending.clear();
    for (const node of active) { try { node.stop(); } catch { /* already ended */ } }
    active.clear();
  }
}

function context(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ac || ac.state === 'closed') {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (!C) return null;
      ac = new C({ latencyHint: 'interactive' });
      master = ac!.createGain();
      master.gain.value = 0.8;
      master.connect(ac!.destination);
      decoded.clear(); decoding.clear(); pending.clear();
      ac!.addEventListener('statechange', flushPending);
    }
    return ac;
  } catch { return null; }
}

/** Resume inside the gesture, but schedule only after the audio clock is running. */
function withAudio(play: (a: AudioContext) => void) {
  const a = context();
  if (!a) return;
  const epoch = generation;
  const requestedAt = performance.now();
  const run = () => {
    // Do not replay an old burst after returning from a long interruption.
    if (!enabled || epoch !== generation || a !== ac || performance.now() - requestedAt > 1000) {
      pending.delete(run);
      return;
    }
    if (a.state !== 'running') return;
    pending.delete(run);
    play(a);
  };
  if (a.state === 'running') run();
  else {
    // Bound callbacks while the browser/device is unable to output audio.
    flushPending();
    if (pending.size >= 128) pending.delete(pending.values().next().value!);
    pending.add(run);
    try {
      // A touch pointerdown may leave resume() pending until a later activation.
      // Every new gesture must be able to call resume again, even with an old promise pending.
      void a.resume().then(flushPending).catch(() => { pending.delete(run); });
    } catch { pending.delete(run); }
  }
}

function track(node: AudioScheduledSourceNode, gain?: GainNode) {
  active.add(node);
  node.onended = () => { active.delete(node); node.disconnect(); gain?.disconnect(); };
}

/** Preload on entry; unlock on both mouse press and touch/pen release. */
export function primeAudio() {
  withAudio(a => { for (const name of Object.keys(urls) as Sample[]) void buffer(a, name); });
}
if (typeof window !== 'undefined') {
  for (const name of Object.keys(urls) as Sample[]) void load(name);
  window.addEventListener('pointerdown', primeAudio, { passive: true, capture: true });
  window.addEventListener('pointerup', primeAudio, { passive: true, capture: true });
  window.addEventListener('touchend', primeAudio, { passive: true, capture: true });
  window.addEventListener('click', primeAudio, { capture: true });
  window.addEventListener('keydown', primeAudio, { capture: true });
}

function sample(name: Sample, fallback: () => void, volume = 1) {
  const epoch = generation;
  withAudio(a => {
    const play = (value: AudioBuffer | null) => {
      if (!enabled || epoch !== generation || a !== ac) return;
      if (!value) { fallback(); return; }
      // A fresh source per event: rapid taps and simultaneous landings never cut each other off.
      withAudio(current => {
        if (current !== a) return;
        const source = a.createBufferSource();
        source.buffer = value;
        const gain = a.createGain();
        gain.gain.value = volume;
        source.connect(gain).connect(master!);
        track(source, gain);
        source.start(a.currentTime);
      });
    };
    const cached = decoded.get(name);
    if (cached) play(cached);
    else void buffer(a, name).then(play);
  });
}

function tone(freq: number, dur = 0.08, type: OscillatorType = 'sine', vol = 0.15, delay = 0, slide = 0) {
  withAudio(a => {
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master!);
    track(o, g);
    o.start(t); o.stop(t + dur + 0.02);
  });
}

function noise(dur = 0.3, vol = 0.3, delay = 0, freq = 1200) {
  withAudio(a => {
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = a.createBufferSource(); src.buffer = buf;
    const filter = a.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = freq;
    const gain = a.createGain(); gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(master!);
    track(src, gain);
    src.addEventListener('ended', () => filter.disconnect(), { once: true });
    src.start(a.currentTime + delay);
  });
}

const pick = () => sample('pick', () => tone(650, 0.095, 'sine', 0.18, 0, 2.3));
export const sfx = {
  pick,
  // The reference repeats the same short pop; combos do not change its pitch.
  place: (_combo: number) => sample('place', () => tone(640, 0.046, 'sine', 0.2, 0, 1.48)),
  slot: () => sample('slot', () => tone(260, 0.044, 'triangle', 0.18, 0, 0.5)),
  drop: pick,
  wrongHole: pick,
  locked: pick,
  click: pick,
  complete: () => sample('complete', () => {
    tone(1000, 0.65, 'sine', 0.11); tone(1550, 0.6, 'sine', 0.065);
  }),
  win: () => sample('win', () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.25, 'triangle', 0.16, k * 0.12))),
  error: () => { tone(220, 0.12, 'square', 0.08); tone(160, 0.18, 'square', 0.08, 0.1); },
  boom: (level: number) => {
    noise(0.25 + level * 0.15, 0.25 + level * 0.1, 0, 700 + level * 500);
    tone(160, 0.3, 'sine', 0.2, 0, 0.4);
    if (level >= 3) for (let k = 0; k < 4; k++) noise(0.2, 0.15, 0.15 + k * 0.16, 3000);
  },
  overtime: () => { tone(660, 0.15, 'square', 0.07); tone(440, 0.25, 'square', 0.07, 0.15); },
  star: (k: number) => tone(784 + k * 200, 0.2, 'sine', 0.16),
};

export function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 部分浏览器不支持 */
  }
}
