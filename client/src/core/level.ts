import { PATTERNS, type Pattern } from './patterns';
import { hashSeed, mulberry32, pick, shuffle, type Rng } from './rng';

export type ObjectiveType = 'timeLeft' | 'slotPeak' | 'newChains' | 'maxCombo' | 'noProps';

export interface Objective {
  type: ObjectiveType;
  value: number;
}

export type Difficulty = '轻松' | '普通' | '烧脑';

export interface LevelDef {
  id: number;
  key: string;
  name: string;
  w: number;
  h: number;
  /** 调色板，十六进制颜色 */
  colors: string[];
  /** 每格正确颜色的下标，-1 表示画布外 */
  target: Int16Array;
  /** 开局时每格豆子的颜色下标，-1 表示画布外 */
  beads: Int16Array;
  wrongCount: number;
  capacity: number;
  timeLimit: number;
  objectives: Objective[];
  difficulty: Difficulty;
  elements: Elements;
}

export type ElementType = 'ice' | 'star' | 'fog' | 'lock' | 'bomb';

/** 特殊格子 */
export interface Elements {
  ice: number[]; // 冰封豆：第一下敲碎冰，第二下才能拿起
  star: number[]; // 星星豆：归位时 +3 秒
  fog: number[]; // 迷雾格：底色被遮住，相邻格归位后雾散
  lock: { color: number; cells: number[] } | null; // 锁链豆：该颜色全部归位后解锁
  bombs: { cell: number; steps: number }[]; // 炸弹豆：步数归零前没拿走，周围已归位的豆子被打乱
}

export const ELEMENT_INFO: Record<ElementType, { icon: string; name: string; desc: string }> = {
  ice: { icon: '❄️', name: '冰封豆', desc: '第一下敲碎冰，第二下才能拿起' },
  star: { icon: '⭐', name: '星星豆', desc: '归位时 +3 秒' },
  fog: { icon: '☁️', name: '迷雾格', desc: '底色被云雾遮住，旁边的格子归位后雾就散了' },
  lock: { icon: '🔒', name: '锁链豆', desc: '锁上标着一种颜色，那种颜色全部归位后自动解锁' },
  bomb: { icon: '💣', name: '炸弹豆', desc: '数字是剩余步数，归零前没把它拿走，周围已归位的豆子会被打乱' },
};

function noElements(): Elements {
  return { ice: [], star: [], fog: [], lock: null, bombs: [] };
}

/** 为第 id 关挑 0–2 种特殊格子（第 4 关起） */
function genElements(id: number, target: Int16Array, beads: Int16Array, colors: number, rng: Rng): Elements {
  const el = noElements();
  if (id < 4) return el;
  const all: ElementType[] = ['ice', 'star', 'fog', 'lock', 'bomb'];
  // 第 4–8 关各介绍一种，之后随机 0–2 种
  const roll = rng();
  const types = id <= 8 ? [all[id - 4]] : shuffle(rng, [...all]).slice(0, roll < 0.2 ? 0 : roll < 0.7 ? 1 : 2);
  const wrong: number[] = [];
  const inside: number[] = [];
  for (let i = 0; i < target.length; i++) {
    if (target[i] < 0) continue;
    inside.push(i);
    if (beads[i] !== target[i]) wrong.push(i);
  }
  const used = new Set<number>();
  const take = (from: number[], k: number, ok: (c: number) => boolean = () => true) => {
    const out: number[] = [];
    for (const c of shuffle(rng, [...from])) {
      if (out.length >= k) break;
      if (used.has(c) || !ok(c)) continue;
      used.add(c);
      out.push(c);
    }
    return out;
  };
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(v)));
  for (const t of types) {
    if (t === 'ice') el.ice = take(wrong, clamp(wrong.length * 0.08, 4, 14));
    if (t === 'star') el.star = take(wrong, clamp(wrong.length * 0.05, 3, 8));
    if (t === 'fog') el.fog = take(inside, clamp(inside.length * 0.08, 6, 20));
    if (t === 'bomb') {
      const steps = clamp(wrong.length * 0.3, 12, 30);
      el.bombs = take(wrong, rng() < 0.5 ? 1 : 2).map((cell) => ({ cell, steps }));
    }
    if (t === 'lock') {
      // 选一种还有错位格子的颜色 L；被锁的格子目标色和豆子都不能是 L，避免死锁
      const candidates: number[] = [];
      for (let c = 0; c < colors; c++) {
        if (wrong.some((i) => target[i] === c)) candidates.push(c);
      }
      if (!candidates.length) continue;
      const L = pick(rng, candidates);
      const cells = take(wrong, clamp(wrong.length * 0.05, 3, 6), (c) => target[c] !== L && beads[c] !== L);
      if (cells.length) el.lock = { color: L, cells };
    }
  }
  return el;
}

/** 可调参数：每颗错位豆子给多少秒 */
export const SECONDS_PER_WRONG = 1.0;
export const BASE_SECONDS = 30;

export interface PatternGrid {
  w: number;
  h: number;
  colors: string[];
  target: Int16Array;
}

export function patternToGrid(p: Pattern): PatternGrid {
  const h = p.rows.length;
  const w = Math.max(...p.rows.map((r) => r.length));
  const colors: string[] = [];
  const charIndex = new Map<string, number>();
  const target = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++) {
    const row = p.rows[y].padEnd(w, '.');
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const hex = p.palette[ch];
      if (!hex) throw new Error(`图案 ${p.key} 第 ${y + 1} 行有未定义颜色 '${ch}'`);
      let idx = charIndex.get(ch);
      if (idx === undefined) {
        idx = colors.length;
        colors.push(hex);
        charIndex.set(ch, idx);
      }
      target[y * w + x] = idx;
    }
  }
  return { w, h, colors, target };
}

/**
 * 打乱：随机挑出 wrongRate 比例的格子，把它们的豆子互相调换位置，
 * 并尽量让每颗都不落回本色。颜色总数守恒，所以一定可解。
 */
export function scramble(target: Int16Array, wrongRate: number, rng: Rng): Int16Array {
  const beads = Int16Array.from(target);
  // 按颜色分组；轮流从各颜色抽格子，避免某种颜色占比过高导致无法错位
  const byColor = new Map<number, number[]>();
  let insideCount = 0;
  for (let i = 0; i < target.length; i++) {
    if (target[i] < 0) continue;
    insideCount++;
    if (!byColor.has(target[i])) byColor.set(target[i], []);
    byColor.get(target[i])!.push(i);
  }
  const groups = shuffle(rng, [...byColor.values()].map((g) => shuffle(rng, g)));
  const k = Math.max(2, Math.round(insideCount * wrongRate));
  const chosen: number[] = [];
  const taken = groups.map(() => 0);
  let progress = true;
  while (chosen.length < k && progress) {
    progress = false;
    groups.forEach((g, gi) => {
      if (chosen.length >= k || taken[gi] >= g.length) return;
      const others = chosen.length - taken[gi];
      if (taken[gi] >= Math.max(1, others)) return; // 单色不超过一半
      chosen.push(g[taken[gi]++]);
      progress = true;
    });
  }
  const colors = shuffle(rng, chosen.map((i) => target[i]));
  // 消除「落回本色」的位置：与另一个位置互换，要求换完后两边都错位
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < colors.length; j++) {
      if (colors[j] !== target[chosen[j]]) continue;
      for (let tries = 0; tries < 40; tries++) {
        const m = Math.floor(rng() * colors.length);
        if (m === j) continue;
        if (colors[m] !== target[chosen[j]] && colors[j] !== target[chosen[m]]) {
          [colors[j], colors[m]] = [colors[m], colors[j]];
          break;
        }
      }
    }
  }
  chosen.forEach((cell, j) => (beads[cell] = colors[j]));
  return beads;
}

export function countWrong(target: Int16Array, beads: Int16Array): number {
  let n = 0;
  for (let i = 0; i < target.length; i++) if (target[i] >= 0 && beads[i] !== target[i]) n++;
  return n;
}

export function difficultyOf(wrong: number, capacity: number): Difficulty {
  const score = wrong / 60 + 12 / capacity;
  if (score < 1.4) return '轻松';
  if (score < 2.6) return '普通';
  return '烧脑';
}

/** 第 id 关（从 1 开始）。参数由关卡号做种子随机，重玩同一关参数不变。 */
export function buildLevel(id: number): LevelDef {
  const p = PATTERNS[(id - 1) % PATTERNS.length];
  const round = Math.floor((id - 1) / PATTERNS.length); // 图案用完后循环，参数重新随机
  const rng = mulberry32(hashSeed('level', id, p.key, round));
  const grid = patternToGrid(p);
  const tutorial = id === 1;

  const wrongRate = tutorial ? 0.3 : 0.3 + rng() * 0.5;
  const beads = scramble(grid.target, wrongRate, rng);
  const wrong = countWrong(grid.target, beads);

  let capacity = tutorial ? 12 : Math.round((wrong * (0.12 + rng() * 0.28)) / 4) * 4;
  capacity = Math.max(12, Math.min(48, capacity));

  const timeFactor = tutorial ? 1.6 : 0.8 + rng() * 0.5;
  const timeLimit = Math.round((BASE_SECONDS + wrong * SECONDS_PER_WRONG) * timeFactor);

  const pool: Objective[] = [
    { type: 'timeLeft', value: tutorial ? 0.2 : pick(rng, [0.2, 0.25, 0.3, 0.35]) },
    { type: 'slotPeak', value: Math.max(4, Math.min(capacity - 2, Math.round(5 + wrong * 0.04))) },
    { type: 'newChains', value: Math.max(4, Math.round(wrong * 0.18) + 2) },
    { type: 'maxCombo', value: Math.max(8, Math.min(40, Math.round(wrong * 0.35))) },
    { type: 'noProps', value: 0 },
  ];
  const objectives = shuffle(rng, pool).slice(0, 2);
  const elements = genElements(id, grid.target, beads, grid.colors.length, mulberry32(hashSeed('elements', id, p.key, round)));
  const extraTime = elements.ice.length + (elements.lock?.cells.length ?? 0) * 2;

  return {
    id,
    key: p.key,
    name: round > 0 ? `${p.name} · 其${round + 1}` : p.name,
    w: grid.w,
    h: grid.h,
    colors: grid.colors,
    target: grid.target,
    beads,
    wrongCount: wrong,
    capacity,
    timeLimit: timeLimit + extraTime,
    objectives,
    difficulty: difficultyOf(wrong + elements.ice.length + elements.bombs.length * 10, capacity),
    elements,
  };
}

export const LEVEL_COUNT = PATTERNS.length;

export const OBJECTIVE_TEXT: Record<ObjectiveType, (v: number) => string> = {
  timeLeft: (v) => `闪电手：剩余时间 ≥ ${Math.round(v * 100)}%`,
  slotPeak: (v) => `稳如磐石：空槽最多占用 ${v} 格`,
  newChains: (v) => `火眼金睛：开新链 ≤ ${v} 次`,
  maxCombo: (v) => `连击达人：最大连击 ≥ ${v}`,
  noProps: () => '纯手艺：全程不用道具、不续命',
};

export const OBJECTIVE_ICON: Record<ObjectiveType, string> = {
  timeLeft: '⚡',
  slotPeak: '🧺',
  newChains: '👁',
  maxCombo: '🔥',
  noProps: '✋',
};
