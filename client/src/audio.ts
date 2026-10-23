/** 用 Web Audio 实时合成的小音效，无需音频文件 */
let ac: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

function ctx(): AudioContext | null {
  if (!enabled) return null;
  if (!ac) {
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    ac = new C();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function tone(freq: number, dur = 0.08, type: OscillatorType = 'sine', vol = 0.15, delay = 0, slide = 0) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur = 0.3, vol = 0.3, delay = 0, lowpass = 1200) {
  const a = ctx();
  if (!a) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

const SCALE = [523, 587, 659, 698, 784, 880, 988, 1047, 1175, 1319, 1397, 1568];

export const sfx = {
  pick: () => tone(420, 0.06, 'triangle', 0.12),
  /** 归位音：随连击升调 */
  place: (combo: number) => tone(SCALE[Math.min(SCALE.length - 1, Math.max(0, combo - 1))], 0.12, 'sine', 0.16),
  slot: () => tone(260, 0.1, 'triangle', 0.12, 0, 0.8),
  locked: () => tone(200, 0.05, 'square', 0.05),
  error: () => {
    tone(220, 0.12, 'square', 0.08);
    tone(160, 0.18, 'square', 0.08, 0.1);
  },
  boom: (level: number) => {
    noise(0.25 + level * 0.15, 0.25 + level * 0.1, 0, 700 + level * 500);
    tone(160, 0.3, 'sine', 0.2, 0, 0.4);
    if (level >= 3) for (let k = 0; k < 4; k++) noise(0.2, 0.15, 0.15 + k * 0.16, 3000);
  },
  overtime: () => {
    tone(660, 0.15, 'square', 0.07);
    tone(440, 0.25, 'square', 0.07, 0.15);
  },
  win: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.25, 'triangle', 0.16, k * 0.12)),
  star: (k: number) => tone(784 + k * 200, 0.2, 'sine', 0.16),
  click: () => tone(600, 0.04, 'triangle', 0.08),
};

export function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 部分浏览器不支持 */
  }
}
