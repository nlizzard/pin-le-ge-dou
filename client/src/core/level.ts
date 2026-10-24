import { PATTERNS, type Pattern } from './patterns';
import { hashSeed, mulberry32, pick, shuffle, type Rng } from './rng';
import { Game } from './engine';

export type ObjectiveType = 'timeLeft' | 'slotPeak' | 'newChains' | 'maxCombo' | 'noProps';

export interface Objective {
  type: ObjectiveType;
  value: number;
}

export type Difficulty = '轻松' | '普通' | '烧脑';

export interface LevelDef {
  mode?: 'custom';
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

/** 为第 id 关挑 0–2 种特殊格子（第 4 关起）；tier 是全程难度进度，越往后格子越多越紧 */
function genElements(id: number, target: Int16Array, beads: Int16Array, colors: number, rng: Rng, tier: number): Elements {
  const el = noElements();
  if (id < 4) return el;
  const all: ElementType[] = ['ice', 'star', 'fog', 'lock', 'bomb'];
  // 第 4–8 关各介绍一种，之后随机 0–2 种（后期更容易出现两种）
  const roll = rng();
  const twoCut = 0.7 - tier * 0.25;
  const types = id <= 8 ? [all[id - 4]] : shuffle(rng, [...all]).slice(0, roll < 0.15 ? 0 : roll < twoCut ? 1 : 2);
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
  const grow = 1 + tier * 0.7; // 后期特殊格子更密集
  for (const t of types) {
    if (t === 'ice') el.ice = take(wrong, clamp(wrong.length * 0.08 * grow, 4, 10 + Math.round(7 * tier)));
    if (t === 'star') el.star = take(wrong, clamp(wrong.length * 0.05, 3, 8));
    if (t === 'fog') el.fog = take(inside, clamp(inside.length * 0.08 * grow, 6, 14 + Math.round(10 * tier)));
    if (t === 'bomb') {
      // 后期炸弹步数更少，更紧迫
      const steps = clamp(wrong.length * (0.42 - 0.22 * tier), 10, 32);
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

/** 总关数随图案数走（手绘 + 生成 + levels/*.json 网络素材），至少 200 */
export const LEVEL_COUNT = Math.max(200, PATTERNS.length);
/** 同一张图案第 2~5 次出现时的后缀 */
export const ROUND_NAMES = ['', '进阶', '挑战', '大师', '梦幻'];

/** 关卡号在难度曲线上的位置（0 开局 → 1 封顶）。以 200 关为基准，之后新增的关卡全部按最高难度。 */
export function levelProgress(id: number): number {
  return Math.max(0, Math.min(1, (id - 1) / 199));
}

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
 * 同色豆子会按空间连成片（BFS 顺序 + 粘性分配）：大块色团让「乱点」很快把空槽塞爆，
 * 而聪明玩家点「空位需要的颜色」不占空槽，不受影响。
 */
export function scramble(target: Int16Array, wrongRate: number, rng: Rng, w = 0, h = 0): Int16Array {
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
  // 按空间邻接的 BFS 顺序遍历错位格，让接下来的同色分配在地图上连成片；
  // 没有宽高信息时退化为随机顺序（不连片）
  const chosenSet = new Set(chosen);
  const order: number[] = [];
  const seen = new Uint8Array(target.length);
  const neighbours = (c: number) => {
    const x = c % w, y = Math.floor(c / w);
    const out: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (chosenSet.has(n) && !seen[n]) out.push(n);
    }
    return out;
  };
  if (w > 0 && h > 0) {
    for (const start of shuffle(rng, [...chosen])) {
      if (seen[start]) continue;
      seen[start] = 1;
      const stack = [start];
      while (stack.length) {
        const c = stack.pop()!;
        order.push(c);
        for (const n of neighbours(c)) { seen[n] = 1; stack.push(n); }
      }
    }
  } else {
    order.push(...shuffle(rng, [...chosen]));
  }
  // 粘性分配颜色：60% 概率沿用上一格的颜色，形成 2–6 格的小色团
  const counts = new Map<number, number>();
  for (const i of chosen) counts.set(target[i], (counts.get(target[i]) ?? 0) + 1);
  const colors: number[] = [];
  let last = -1;
  for (const _cell of order) {
    let color: number;
    const lastLeft = last >= 0 ? counts.get(last) ?? 0 : 0;
    if (last >= 0 && lastLeft > 0 && rng() < 0.78) {
      color = last;
    } else {
      const avail: [number, number][] = [];
      for (const [c, n] of counts) if (n > 0) avail.push([c, n]);
      const total = avail.reduce((a, [, n]) => a + n, 0);
      let r = rng() * total;
      color = avail[avail.length - 1][0];
      for (const [c, n] of avail) {
        r -= n;
        if (r <= 0) { color = c; break; }
      }
    }
    counts.set(color, (counts.get(color) ?? 0) - 1);
    colors.push(color);
    last = color;
  }
  // 消除「落回本色」的位置：与另一个位置互换，要求换完后两边都错位
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < colors.length; j++) {
      if (colors[j] !== target[order[j]]) continue;
      for (let tries = 0; tries < 40; tries++) {
        const m = Math.floor(rng() * colors.length);
        if (m === j) continue;
        if (colors[m] !== target[order[j]] && colors[j] !== target[order[m]]) {
          [colors[j], colors[m]] = [colors[m], colors[j]];
          break;
        }
      }
    }
  }
  order.forEach((cell, j) => (beads[cell] = colors[j]));
  return beads;
}

export function countWrong(target: Int16Array, beads: Int16Array): number {
  let n = 0;
  for (let i = 0; i < target.length; i++) if (target[i] >= 0 && beads[i] !== target[i]) n++;
  return n;
}

export function difficultyOf(wrong: number, capacity: number): Difficulty {
  const score = wrong / 60 + 12 / capacity;
  if (score < 3.0) return '轻松';
  if (score < 4.0) return '普通';
  return '烧脑';
}

/**
 * 难度参数（tools/tune-difficulty.mjs 用它批量实测：聪明玩法必须能通关、乱点必须爆槽）。
 * tier 是关卡号在全程中的进度（0→1）。
 */
export const DIFFICULTY = {
  /** 错位率 = base + slope × tier，上限 wrongMax */
  wrongBase: 0.5,
  wrongSlope: 0.5,
  wrongMax: 0.85,
  /** 空槽数 = 错位数 × (capBase − capSlope × tier)，偶数，夹在 [capMin, capMax] */
  capBase: 0.06,
  capSlope: 0.05,
  capMin: 2,
  capMax: 48,
  /** 限时 = (30 + 错位数) × (timeBase − timeSlope × tier) */
  timeBase: 1.35,
  timeSlope: 0.6,
  timeMin: 0.7,
};

/**
 * 第 id 关（从 1 开始）。参数由关卡号做种子随机，重玩同一关参数不变。
 * 难度随关卡号逐渐加大：错位率、空槽压力、时间压力全部递进。
 */
export function buildLevel(id: number): LevelDef {
  const p = PATTERNS[(id - 1) % PATTERNS.length];
  const round = Math.floor((id - 1) / PATTERNS.length); // 图案用完后循环，难度按全局进度提升
  const tier = levelProgress(id);
  const rng = mulberry32(hashSeed('level', id, p.key, round));
  const grid = patternToGrid(p);
  const tutorial = id === 1;
  const D = DIFFICULTY;

  // 小图案错位豆太少时，乱点在自动回槽的帮助下磨得过去：画布越小错位率越高
  const inside = grid.target.reduce((a, t) => a + (t >= 0 ? 1 : 0), 0);
  const smallBonus = Math.max(0, Math.min(0.2, (110 - inside) / 400));
  const wrongRate = tutorial ? 0.28 : Math.min(D.wrongMax, D.wrongBase + tier * D.wrongSlope + smallBonus + (rng() - 0.5) * 0.06);
  const beads = scramble(grid.target, wrongRate, rng, grid.w, grid.h);
  const wrong = countWrong(grid.target, beads);

  // 空槽：越到后期越紧，乱点很快爆槽，必须靠连锁归位
  const capRatio = tutorial ? 0.42 : D.capBase - tier * D.capSlope + (rng() - 0.5) * 0.03;
  let capacity = Math.round((wrong * Math.max(0.04, capRatio)) / 2) * 2;
  capacity = Math.max(tutorial ? 12 : D.capMin, Math.min(D.capMax, capacity));

  // 时间系数：开局充裕，后期紧张
  const timeFactor = tutorial ? 1.7 : D.timeBase - tier * D.timeSlope + (rng() - 0.5) * 0.12;
  const timeLimit = Math.round((BASE_SECONDS + wrong * SECONDS_PER_WRONG) * Math.max(D.timeMin, timeFactor));

  const pool: Objective[] = [
    { type: 'timeLeft', value: tutorial ? 0.2 : pick(rng, [0.2, 0.25, 0.3, 0.35]) },
    { type: 'slotPeak', value: Math.max(4, Math.min(capacity - 2, Math.round(5 + wrong * 0.04))) },
    { type: 'newChains', value: Math.max(4, Math.round(wrong * 0.18) + 2) },
    { type: 'maxCombo', value: Math.max(8, Math.min(40, Math.round(wrong * 0.35))) },
    { type: 'noProps', value: 0 },
  ];
  const objectives = shuffle(rng, pool).slice(0, 2);
  const elements = genElements(id, grid.target, beads, grid.colors.length, mulberry32(hashSeed('elements', id, p.key, round)), tier);
  const extraTime = elements.ice.length + (elements.lock?.cells.length ?? 0) * 2;

  const def: LevelDef = {
    id,
    key: p.key,
    name: ROUND_NAMES[round] ? `${p.name} · ${ROUND_NAMES[round]}` : p.name,
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
  // 空槽太紧会把连锁解法卡死：逐步 +2 直到「聪明玩法」模拟可解，保证每关都通得了
  for (let tries = 0; tries < 10 && !solvableBySmartPlay(def); tries++) {
    def.capacity = Math.min(48, def.capacity + 2);
    def.objectives = def.objectives.map((o) => (o.type === 'slotPeak' ? { ...o, value: Math.max(4, Math.min(def.capacity - 2, o.value)) } : o));
  }
  return def;
}

/** 用「有空位就归位、没空位才开小链」的解法模拟一局，验证关卡可解 */
function solvableBySmartPlay(def: LevelDef): boolean {
  const g = new Game(def);
  g.start();
  for (let step = 0; step < 100000 && g.state === 'playing'; step++) {
    let cell = -1;
    for (const { color } of g.neededColors()) {
      for (const c of g.wrongByColor.get(color) ?? []) {
        if (!g.locked[c]) { cell = c; break; }
      }
      if (cell >= 0) break;
    }
    if (cell < 0) {
      let best = Infinity;
      for (const set of g.wrongByColor.values()) {
        for (const c of set) {
          if (g.locked[c]) continue;
          const n = g.ice[c] ? 0.5 : g.groupAt(c).length;
          if (n < best) { best = n; cell = c; }
        }
      }
    }
    if (cell < 0) break;
    g.tap(cell);
  }
  return g.state === 'won';
}

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

/* ---------- 关卡数据来自本地 SQLite（服务端）时的读取层 ----------
 * 服务端把 200 关的完整定义写进 data/picture-play.db 并提供 /api/levels。
 * 连不上服务端时自动退回本地确定性生成，游戏照常可玩。 */

export interface LevelInfo {
  id: number;
  key: string;
  name: string;
  difficulty: Difficulty;
  timeLimit: number;
  capacity: number;
  wrongCount: number;
  objectives: Objective[];
  elements: Elements;
}

const apiMetas = new Map<number, LevelInfo>();

/** 启动时拉取关卡元数据（地图页用）；失败静默，退回本地生成 */
export async function initLevels(): Promise<void> {
  try {
    const res = await fetch('/api/levels');
    if (!res.ok) return;
    const list = (await res.json()) as LevelInfo[];
    if (!Array.isArray(list)) return;
    for (const m of list) if (m && typeof m.id === 'number') apiMetas.set(m.id, m);
  } catch {
    /* 离线：用本地生成 */
  }
}

/** 关卡元信息：优先 SQLite，离线时本地生成 */
export function levelInfo(id: number): LevelInfo {
  const meta = apiMetas.get(id);
  if (meta) return meta;
  const d = buildLevel(id);
  return { id: d.id, key: d.key, name: d.name, difficulty: d.difficulty, timeLimit: d.timeLimit, capacity: d.capacity, wrongCount: d.wrongCount, objectives: d.objectives, elements: d.elements };
}

function parseApiLevel(raw: any, id: number): LevelDef | null {
  if (!raw || !Array.isArray(raw.target) || !Array.isArray(raw.beads) || !Array.isArray(raw.colors)) return null;
  return {
    mode: undefined,
    id,
    key: String(raw.key ?? ''),
    name: String(raw.name ?? `第${id}关`),
    w: raw.w,
    h: raw.h,
    colors: raw.colors.map(String),
    target: Int16Array.from(raw.target),
    beads: Int16Array.from(raw.beads),
    wrongCount: raw.wrongCount,
    capacity: raw.capacity,
    timeLimit: raw.timeLimit,
    objectives: Array.isArray(raw.objectives) ? raw.objectives : [],
    difficulty: raw.difficulty,
    elements: raw.elements ?? noElements(),
  };
}

/** 完整关卡定义：优先 SQLite，离线时本地生成 */
export async function loadLevelDef(id: number): Promise<LevelDef> {
  try {
    const res = await fetch(`/api/levels/${id}`);
    if (res.ok) {
      const def = parseApiLevel(await res.json(), id);
      if (def) return def;
    }
  } catch {
    /* 离线：用本地生成 */
  }
  return buildLevel(id);
}
