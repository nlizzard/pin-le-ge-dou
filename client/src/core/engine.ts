import type { LevelDef, Objective } from './level';
import type { PropId } from './props';

/** 一次操作引起的单个豆子移动，供渲染层播放飞行动画 */
export type Move =
  | { kind: 'cellToCell'; color: number; from: number; to: number }
  | { kind: 'cellToSlot'; color: number; from: number; slot: number }
  | { kind: 'slotToCell'; color: number; slot: number; to: number };

/** 一次操作顺带触发的特殊格子事件 */
export interface Events {
  stars: number[]; // 归位的星星豆（每颗 +3 秒）
  unlocked: number[]; // 解锁的锁链格
  bombs: { cell: number; scrambled: number[] }[]; // 爆炸的炸弹及被打乱的格子
  defused: number[]; // 被拆掉的炸弹
  fogCleared: number[];
}

export type TapResult =
  | { type: 'ignored' }
  | { type: 'locked'; cell: number } // 点了已归位的豆子
  | { type: 'blocked'; cell: number; lockColor: number } // 锁链格，还没解锁
  | { type: 'ice'; cell: number; events: Events } // 敲碎了冰
  | { type: 'moved'; moves: Move[]; placed: number; newChain: boolean; won: boolean; groupSize: number; moved: number; events: Events }
  | { type: 'burst'; cell: number; group: number[] }; // 空槽放不下这一组豆子

export type GameState = 'ready' | 'playing' | 'won' | 'burst';

export const COMBO_WINDOW = 1.5; // 秒
export const TIMER_TAP_LIMIT = 3;
export const TIMER_TAP_BONUS = 10; // 秒
export const STAR_BONUS = 3; // 秒
export const MAX_REVIVES = 2;
export const UNDO_STEPS = 3;

export interface Stats {
  placements: number;
  newChains: number;
  slotPeak: number;
  combo: number;
  maxCombo: number;
  score: number;
  propsUsed: number;
  revives: number;
}

interface Snapshot {
  beads: Int16Array;
  slots: number[];
  ice: Uint8Array;
  locked: Uint8Array;
  bomb: Int16Array;
  star: Uint8Array;
  fog: Uint8Array;
}

function emptyEvents(): Events {
  return { stars: [], unlocked: [], bombs: [], defused: [], fogCleared: [] };
}

export class Game {
  readonly def: LevelDef;
  readonly w: number;
  readonly h: number;
  readonly target: Int16Array;
  readonly beads: Int16Array;
  /** 空槽里的豆子颜色，按颜色排序 */
  slots: number[] = [];
  capacity: number;
  /** 所需颜色 → 需要它的空位 */
  readonly emptyByColor = new Map<number, Set<number>>();
  /** 豆子颜色 → 放着这种错位豆子的格子（含冰封 / 锁链格） */
  readonly wrongByColor = new Map<number, Set<number>>();
  readonly total: number;
  correct = 0;

  // 特殊格子
  readonly ice: Uint8Array;
  readonly star: Uint8Array;
  readonly fog: Uint8Array;
  readonly locked: Uint8Array;
  readonly lockColor: number;
  readonly bomb: Int16Array; // -1 = 没有炸弹，否则为剩余步数

  state: GameState = 'ready';
  /** 已用时间（秒，游戏内时间，弹窗时暂停） */
  elapsed = 0;
  /** 实际游玩时间，不受沙漏、星星或冻结影响；暂停由界面停止 tick。 */
  playedSeconds = 0;
  /** 点击计时器和沙漏加的时间（不计入「闪电手」） */
  addedTime = 0;
  /** 星星豆奖励的时间（计入「闪电手」） */
  starBonus = 0;
  timerTaps = 0;
  overtime = false;
  /** 时光琥珀：剩余冻结秒数 */
  freezeLeft = 0;
  cloverActive = false;
  /** 本局各道具使用次数 */
  readonly propUses: Partial<Record<PropId, number>> = {};
  private lastPlaceAt = -99;
  private undoStack: Snapshot[] = [];
  private ev: Events = emptyEvents();

  stats: Stats = { placements: 0, newChains: 0, slotPeak: 0, combo: 0, maxCombo: 0, score: 0, propsUsed: 0, revives: 0 };

  constructor(def: LevelDef) {
    this.def = def;
    this.w = def.w;
    this.h = def.h;
    this.target = def.target;
    this.beads = Int16Array.from(def.beads);
    this.capacity = def.capacity;
    const n = this.target.length;
    this.ice = new Uint8Array(n);
    this.star = new Uint8Array(n);
    this.fog = new Uint8Array(n);
    this.locked = new Uint8Array(n);
    this.bomb = new Int16Array(n).fill(-1);
    const el = def.elements;
    el.ice.forEach((c) => (this.ice[c] = 1));
    el.star.forEach((c) => (this.star[c] = 1));
    el.fog.forEach((c) => (this.fog[c] = 1));
    el.bombs.forEach((b) => (this.bomb[b.cell] = b.steps));
    this.lockColor = el.lock ? el.lock.color : -1;
    el.lock?.cells.forEach((c) => (this.locked[c] = 1));

    let total = 0;
    for (let i = 0; i < n; i++) {
      const t = this.target[i];
      if (t < 0) continue;
      total++;
      const b = this.beads[i];
      if (b === t) this.correct++;
      else this.addTo(this.wrongByColor, b, i);
    }
    this.total = total;
  }

  // ---------- 计时 ----------

  get timeLeft(): number {
    return this.def.timeLimit + this.addedTime + this.starBonus - this.elapsed;
  }

  tick(dt: number): boolean {
    if (this.state !== 'playing') return false;
    this.playedSeconds += dt;
    if (this.def.mode === 'custom') {
      this.elapsed += dt;
      this.freezeLeft = Math.max(0, this.freezeLeft - dt);
      return false;
    }
    if (this.freezeLeft > 0) {
      this.freezeLeft = Math.max(0, this.freezeLeft - dt);
      return false;
    }
    this.elapsed += dt;
    if (!this.overtime && this.timeLeft <= 0) {
      this.overtime = true; // 不可逆：本局之后只能拿半星
      return true;
    }
    return false;
  }

  /** 点击倒计时：未超时且次数未用完时 +10 秒 */
  tapTimer(): boolean {
    if (this.state !== 'playing' || this.overtime || this.timerTaps >= TIMER_TAP_LIMIT) return false;
    this.timerTaps++;
    this.addedTime += TIMER_TAP_BONUS;
    return true;
  }

  start() {
    if (this.state === 'ready') this.state = 'playing';
  }

  // ---------- 查询 ----------

  isInside(i: number) {
    return i >= 0 && i < this.target.length && this.target[i] >= 0;
  }

  isCorrect(i: number) {
    return this.target[i] >= 0 && this.beads[i] === this.target[i];
  }

  /** 能被玩家拿起的错位豆子（不是冰封、不是锁链） */
  movable(i: number) {
    const b = this.beads[i];
    return this.isInside(i) && b >= 0 && b !== this.target[i] && !this.ice[i] && !this.locked[i];
  }

  neededColors(): { color: number; count: number }[] {
    const out: { color: number; count: number }[] = [];
    for (const [color, set] of this.emptyByColor) if (set.size) out.push({ color, count: set.size });
    return out.sort((a, b) => a.color - b.color);
  }

  emptyCells(): number[] {
    const out: number[] = [];
    for (const set of this.emptyByColor.values()) out.push(...set);
    return out;
  }

  /** 所有未归位的格子（错位 + 空位） */
  unfixedCells(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.target.length; i++) if (this.target[i] >= 0 && this.beads[i] !== this.target[i]) out.push(i);
    return out;
  }

  get progress() {
    return this.correct / this.total;
  }

  get freeSlots() {
    return this.capacity - this.slots.length;
  }

  uses(id: PropId) {
    return this.propUses[id] ?? 0;
  }

  /** 与 i 上下左右相连、颜色相同、可移动的错位豆子（含 i），按离 i 的距离排序 */
  groupAt(i: number): number[] {
    if (!this.movable(i)) return [];
    const color = this.beads[i];
    const seen = new Set<number>([i]);
    const out = [i];
    for (let q = 0; q < out.length; q++) {
      const c = out[q];
      for (const n of this.neighbors4(c)) {
        if (seen.has(n)) continue;
        if (this.movable(n) && this.beads[n] === color) {
          seen.add(n);
          out.push(n);
        }
      }
    }
    return out;
  }

  // ---------- 核心操作 ----------

  /** 无副作用的本次移动预览，与实际点击采用相同分批规则。 */
  batchAt(i: number): number[] {
    const group = this.groupAt(i);
    if (!group.length) return [];
    const needed = this.emptyByColor.get(this.beads[i])?.size ?? 0;
    if (needed) return group.slice(0, needed);
    return this.freeSlots > 0 ? this.slotBatch(group) : [];
  }

  /** 放不下整组时，只选当前局面有收益的一批；不预演或改变后续棋盘。 */
  private slotBatch(group: number[]): number[] {
    if (group.length <= this.freeSlots) return group;
    const available = new Map<number, number>();
    for (const color of this.slots) available.set(color, (available.get(color) ?? 0) + 1);
    const selected = [group[0]];
    const consume = (cell: number) => {
      const need = this.target[cell];
      const count = available.get(need) ?? 0;
      if (count > 0) available.set(need, count - 1);
      return count > 0;
    };
    let refill = consume(group[0]);
    for (const cell of group.slice(1)) {
      if (selected.length >= this.freeSlots) break;
      if (consume(cell)) { selected.push(cell); refill = true; }
    }
    // 有回填机会就只拿够用的；否则批量开链，尽可能留一格缓冲。
    return refill ? selected : group.slice(0, Math.max(1, this.freeSlots - 1));
  }

  /**
   * 点击一颗错位豆子，连着的同色错位豆子一起移动。两种去向互斥：
   * - 有空位需要这个颜色：能填几个空位就飞几颗过去（离点击处近的优先），其余留在原地；
   * - 没有空位需要：整组进入空槽；若放不下，优先选可触发槽内回填的豆子，
   *   否则按容量分批并尽量留一格；始终包含点击的豆子。空槽全满时才爆槽。
   * 之后每个被腾出的格子若在空槽里有它要的颜色，会自动飞回来填上（连锁）。
   */
  tap(i: number): TapResult {
    if (this.state !== 'playing' || !this.isInside(i)) return { type: 'ignored' };
    const color = this.beads[i];
    if (color < 0) return { type: 'ignored' }; // 空位
    if (color === this.target[i]) return { type: 'locked', cell: i };
    if (this.locked[i]) return { type: 'blocked', cell: i, lockColor: this.lockColor };

    this.ev = emptyEvents();
    if (this.ice[i]) {
      this.pushUndo();
      this.ice[i] = 0;
      this.tickBombs();
      return { type: 'ice', cell: i, events: this.ev };
    }

    const group = this.groupAt(i);
    const empties = this.emptyByColor.get(color);
    const toCells = empties ? empties.size > 0 : false;

    // 连一颗的位置都没有才爆槽。
    const overflow = !toCells && group.length > this.freeSlots;
    if (overflow && this.freeSlots <= 0) {
      this.state = 'burst';
      return { type: 'burst', cell: i, group };
    }

    this.pushUndo();
    const moves: Move[] = [];
    let placed = 0;
    const movers = toCells ? group.slice(0, Math.min(group.length, empties!.size)) : this.slotBatch(group);

    // 1. 拿起本批豆子：全部去正确位置或全部进空槽。
    for (const cell of movers) {
      if (toCells) {
        const dest = this.nearest(empties, cell);
        this.setBead(cell, -1, false);
        this.setBead(dest, color);
        placed++;
        moves.push({ kind: 'cellToCell', color, from: cell, to: dest });
      } else {
        this.setBead(cell, -1, false);
        const slot = this.insertSlot(color);
        moves.push({ kind: 'cellToSlot', color, from: cell, slot });
      }
    }
    if (!toCells && this.freezeLeft <= 0) this.stats.newChains++;
    this.stats.slotPeak = Math.max(this.stats.slotPeak, this.slots.length);

    // 2. 腾出的格子变空位；空槽里有它要的颜色就自动飞回来
    for (const cell of movers) {
      const need = this.target[cell];
      const k = this.slots.indexOf(need);
      if (k >= 0) {
        this.slots.splice(k, 1);
        this.setBead(cell, need);
        placed++;
        moves.push({ kind: 'slotToCell', color: need, slot: k, to: cell });
      } else {
        this.markEmpty(cell);
      }
    }

    this.countPlacements(placed);
    this.tickBombs();
    const won = this.checkWin();
    return { type: 'moved', moves, placed, newChain: !toCells, won, groupSize: group.length, moved: movers.length, events: this.ev };
  }

  /** 点击空槽里的豆子：有空位需要它就飞过去（正常情况下会自动填走，这里是兜底） */
  tapSlot(k: number): TapResult {
    if (this.state !== 'playing' || k < 0 || k >= this.slots.length) return { type: 'ignored' };
    const color = this.slots[k];
    const dest = this.nearest(this.emptyByColor.get(color), -1);
    if (dest < 0) return { type: 'ignored' };
    this.ev = emptyEvents();
    this.slots.splice(k, 1);
    this.setBead(dest, color);
    this.countPlacements(1);
    const won = this.checkWin();
    return { type: 'moved', moves: [{ kind: 'slotToCell', color, slot: k, to: dest }], placed: 1, newChain: false, won, groupSize: 1, moved: 1, events: this.ev };
  }

  // ---------- 道具（引擎部分） ----------

  /** 记一次道具使用；返回 false 表示本局次数已用完 */
  consumeProp(id: PropId, perGame: number): boolean {
    if (this.def.mode !== 'custom' && this.uses(id) >= perGame) return false;
    this.propUses[id] = this.uses(id) + 1;
    this.stats.propsUsed++;
    return true;
  }

  /**
   * 让格子 t 归位（所有「修正」类道具共用）：
   * 优先从空槽取所需颜色，否则从棋盘上找最近的同色错位豆子互换；
   * 被换下来的豆子去对方的位置，不额外占用空槽。
   */
  fixCell(t: number): { moves: Move[]; events: Events } {
    this.ev = emptyEvents();
    const moves: Move[] = [];
    if (!this.isInside(t) || this.isCorrect(t)) return { moves, events: this.ev };
    const need = this.target[t];
    const displaced = this.beads[t];
    this.ice[t] = 0;
    this.locked[t] = 0;
    const k = this.slots.indexOf(need);
    if (k >= 0) {
      this.slots.splice(k, 1);
      this.setBead(t, need);
      moves.push({ kind: 'slotToCell', color: need, slot: k, to: t });
      if (displaced >= 0) {
        const e = this.nearest(this.emptyByColor.get(displaced), t);
        if (e >= 0) {
          this.setBead(e, displaced);
          moves.push({ kind: 'cellToCell', color: displaced, from: t, to: e });
        } else {
          const slot = this.insertSlot(displaced);
          moves.push({ kind: 'cellToSlot', color: displaced, from: t, slot });
        }
      }
    } else {
      const s = this.findSource(need, t);
      if (s < 0) return { moves, events: this.ev }; // 理论上不会发生
      this.ice[s] = 0;
      this.locked[s] = 0;
      this.setBead(s, -1, false);
      this.setBead(t, need);
      moves.push({ kind: 'cellToCell', color: need, from: s, to: t });
      if (displaced >= 0) {
        this.setBead(s, displaced);
        moves.push({ kind: 'cellToCell', color: displaced, from: t, to: s });
      } else {
        const sn = this.target[s];
        const j = this.slots.indexOf(sn);
        if (j >= 0) {
          this.slots.splice(j, 1);
          this.setBead(s, sn);
          moves.push({ kind: 'slotToCell', color: sn, slot: j, to: s });
        } else this.markEmpty(s);
      }
    }
    this.countPlacements(moves.filter((m) => m.kind !== 'cellToSlot' && this.isCorrect(m.to)).length);
    this.undoStack = []; // 道具改变了棋盘，不能撤回到之前
    this.checkWin();
    return { moves, events: this.ev };
  }

  /** 磁铁：某颜色的未归位格子，最多 max 个 */
  magnetTargets(color: number, max = 20): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.target.length && out.length < max; i++) if (this.target[i] === color && !this.isCorrect(i)) out.push(i);
    return out;
  }

  /** 有未归位格子的颜色（磁铁可选） */
  magnetColors(): number[] {
    const set = new Set<number>();
    for (let i = 0; i < this.target.length; i++) if (this.target[i] >= 0 && !this.isCorrect(i)) set.add(this.target[i]);
    return [...set].sort((a, b) => a - b);
  }

  /**
   * 扫把：清空空槽，所有可移动的未归位豆子重新洗牌，保底至少 20% 恰好落对。
   * 返回内容变化的格子。
   */
  broom(rand: () => number): number[] {
    this.ev = emptyEvents();
    const cells: number[] = [];
    for (let i = 0; i < this.target.length; i++) {
      if (this.target[i] < 0 || this.isCorrect(i) || this.ice[i] || this.locked[i]) continue;
      cells.push(i);
    }
    const pool: number[] = [];
    for (const c of cells) if (this.beads[c] >= 0) pool.push(this.beads[c]);
    pool.push(...this.slots);
    this.slots = [];
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    // 保底：至少 20% 落对
    const want = Math.ceil(cells.length * 0.2);
    let ok = cells.filter((c, k) => pool[k] === this.target[c]).length;
    for (let k = 0; k < cells.length && ok < want; k++) {
      if (pool[k] === this.target[cells[k]]) continue;
      const j = pool.findIndex((p, m) => p === this.target[cells[k]] && pool[m] !== this.target[cells[m]]);
      if (j < 0) continue;
      [pool[k], pool[j]] = [pool[j], pool[k]];
      ok = cells.filter((c, m) => pool[m] === this.target[c]).length;
    }
    const changed: number[] = [];
    cells.forEach((c, k) => {
      if (this.beads[c] !== pool[k]) changed.push(c);
      this.setBead(c, pool[k]);
    });
    this.undoStack = [];
    this.checkWin();
    return changed;
  }

  addTime(sec: number) {
    this.addedTime += sec;
  }

  /** 放大镜：现在点了就能直接归位的豆子；没有空位时给出最小的一组（最佳开链） */
  hintCells(): number[] {
    const out: number[] = [];
    for (const { color } of this.neededColors()) for (const c of this.wrongByColor.get(color) ?? []) if (this.movable(c)) out.push(c);
    if (out.length) return out;
    let best: number[] = [];
    for (const set of this.wrongByColor.values()) {
      for (const c of set) {
        if (!this.movable(c)) continue;
        const g = this.groupAt(c);
        if (!best.length || g.length < best.length) best = g;
      }
    }
    return best;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  // ---------- 中断存档（checkpoint） ----------

  /** 可 JSON 序列化的完整局面；恢复后撤销栈为空（撤回仅限本局连续操作） */
  saveCheckpoint(): Record<string, unknown> {
    return {
      state: this.state,
      beads: Array.from(this.beads),
      slots: [...this.slots],
      capacity: this.capacity,
      ice: Array.from(this.ice),
      locked: Array.from(this.locked),
      bomb: Array.from(this.bomb),
      star: Array.from(this.star),
      fog: Array.from(this.fog),
      correct: this.correct,
      elapsed: this.elapsed,
      playedSeconds: this.playedSeconds,
      addedTime: this.addedTime,
      starBonus: this.starBonus,
      timerTaps: this.timerTaps,
      overtime: this.overtime,
      freezeLeft: this.freezeLeft,
      cloverActive: this.cloverActive,
      lastPlaceAt: this.lastPlaceAt,
      propUses: { ...this.propUses },
      stats: { ...this.stats },
      wrongByColor: [...this.wrongByColor.entries()].map(([c, s]) => [c, [...s]]),
      emptyByColor: [...this.emptyByColor.entries()].map(([c, s]) => [c, [...s]]),
    };
  }

  /** 从存档恢复局面；数据不完整时返回 false 并保持原状 */
  restoreCheckpoint(data: Record<string, unknown> | null | undefined): boolean {
    if (!data || !Array.isArray(data.beads) || !Array.isArray(data.slots)) return false;
    const n = this.target.length;
    if (data.beads.length !== n) return false;
    try {
      this.beads.set(Int16Array.from(data.beads as number[]));
      this.slots = [...(data.slots as number[])];
      this.capacity = Number.isFinite(data.capacity as number) ? (data.capacity as number) : this.def.capacity;
      if (Array.isArray(data.ice) && data.ice.length === n) this.ice.set(Uint8Array.from(data.ice as number[]));
      if (Array.isArray(data.locked) && data.locked.length === n) this.locked.set(Uint8Array.from(data.locked as number[]));
      if (Array.isArray(data.bomb) && data.bomb.length === n) this.bomb.set(Int16Array.from(data.bomb as number[]));
      if (Array.isArray(data.star) && data.star.length === n) this.star.set(Uint8Array.from(data.star as number[]));
      if (Array.isArray(data.fog) && data.fog.length === n) this.fog.set(Uint8Array.from(data.fog as number[]));
      // 索引优先用存档里的（保留集合内部顺序），不匹配则全量重建
      const wrong = data.wrongByColor as [number, number[]][] | undefined;
      const empty = data.emptyByColor as [number, number[]][] | undefined;
      if (Array.isArray(wrong) && Array.isArray(empty)) {
        this.wrongByColor.clear();
        for (const [c, cells] of wrong) this.wrongByColor.set(c, new Set(cells));
        this.emptyByColor.clear();
        for (const [c, cells] of empty) this.emptyByColor.set(c, new Set(cells));
        this.correct = Number(data.correct ?? 0);
      } else {
        this.rebuildIndexes();
      }
      this.state = (['ready', 'playing', 'won', 'burst'] as const).includes(data.state as GameState) ? (data.state as GameState) : 'playing';
      this.elapsed = Number(data.elapsed ?? 0);
      this.playedSeconds = Number(data.playedSeconds ?? 0);
      this.addedTime = Number(data.addedTime ?? 0);
      this.starBonus = Number(data.starBonus ?? 0);
      this.timerTaps = Number(data.timerTaps ?? 0);
      this.overtime = !!data.overtime;
      this.freezeLeft = Number(data.freezeLeft ?? 0);
      this.cloverActive = !!data.cloverActive;
      this.lastPlaceAt = Number(data.lastPlaceAt ?? -99);
      Object.assign(this.propUses, data.propUses ?? {});
      if (data.stats && typeof data.stats === 'object') Object.assign(this.stats, data.stats);
      this.undoStack = [];
      return true;
    } catch {
      this.rebuildIndexes();
      return false;
    }
  }

  /** 撤回最近最多 3 次点击，时间不回退 */
  undo(): boolean {
    if (!this.undoStack.length) return false;
    const steps = Math.min(UNDO_STEPS, this.undoStack.length);
    const snap = this.undoStack[this.undoStack.length - steps];
    this.undoStack.length -= steps;
    this.beads.set(snap.beads);
    this.ice.set(snap.ice);
    this.locked.set(snap.locked);
    this.bomb.set(snap.bomb);
    this.star.set(snap.star);
    this.fog.set(snap.fog);
    this.slots = [...snap.slots];
    this.rebuildIndexes();
    return true;
  }

  /** 爆槽后续命：增加空槽后继续 */
  revive(extraSlots: number): boolean {
    if (this.state !== 'burst' || !this.canRevive) return false;
    this.stats.revives++;
    this.capacity += extraSlots;
    this.state = 'playing';
    return true;
  }

  /** 爆槽后用扫把续命 */
  reviveWithBroom(rand: () => number): number[] | null {
    if (this.state !== 'burst' || !this.canRevive) return null;
    this.stats.revives++;
    this.state = 'playing';
    return this.broom(rand);
  }

  get canRevive() {
    return this.def.mode === 'custom' || this.stats.revives < MAX_REVIVES;
  }

  /** 凤凰羽毛：清空空槽（豆子回到空位上）并 +30 秒，不占续命次数 */
  phoenix(rand: () => number): number[] {
    const empties = this.emptyCells();
    for (let k = empties.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [empties[k], empties[j]] = [empties[j], empties[k]];
    }
    const slots = this.slots;
    this.slots = [];
    this.ev = emptyEvents();
    empties.forEach((c, k) => slots[k] !== undefined && this.setBead(c, slots[k]));
    this.addedTime += 30;
    this.state = 'playing';
    this.undoStack = [];
    return empties;
  }

  freeze(sec: number) {
    this.freezeLeft += sec;
  }

  // ---------- 结算 ----------

  objectiveMet(o: Objective): boolean {
    const s = this.stats;
    switch (o.type) {
      case 'timeLeft': {
        // 点击计时器 / 沙漏加的时间不计入；星星豆奖励计入
        const left = this.def.timeLimit + this.starBonus - this.elapsed;
        return !this.overtime && left / this.def.timeLimit >= o.value;
      }
      case 'slotPeak':
        return s.slotPeak <= o.value;
      case 'newChains':
        return s.newChains <= o.value;
      case 'maxCombo':
        return s.maxCombo >= o.value;
      case 'noProps':
        return s.propsUsed === 0 && s.revives === 0;
    }
  }

  /** 星级：超时通关 0.5；否则 1 + 达成的加星目标数 */
  stars(): number {
    if (this.state !== 'won') return 0;
    if (this.overtime) return 0.5;
    return 1 + this.def.objectives.filter((o) => this.objectiveMet(o)).length;
  }

  finalScore(): number {
    const timeBonus = this.overtime ? 0 : Math.max(0, Math.floor(this.timeLeft)) * 5;
    return this.stats.score + timeBonus;
  }

  checkWin(): boolean {
    if (this.correct === this.total && this.state === 'playing') this.state = 'won';
    return this.state === 'won';
  }

  // ---------- 内部 ----------

  /** 设置格子里的豆子，并维护索引与特殊格子事件。indexEmpty=false 时暂不登记为空位 */
  private setBead(cell: number, b: number, indexEmpty = true) {
    const t = this.target[cell];
    const old = this.beads[cell];
    if (old === b) return;
    if (old < 0) this.emptyByColor.get(t)?.delete(cell);
    else if (old !== t) this.wrongByColor.get(old)?.delete(cell);
    else this.correct--;
    // 炸弹跟着豆子走：豆子被拿走 / 换掉就拆除
    if (this.bomb[cell] >= 0) {
      this.bomb[cell] = -1;
      this.ev.defused.push(cell);
    }
    this.beads[cell] = b;
    if (b < 0) {
      if (indexEmpty) this.addTo(this.emptyByColor, t, cell);
    } else if (b !== t) this.addTo(this.wrongByColor, b, cell);
    else {
      this.correct++;
      this.onBecameCorrect(cell);
    }
  }

  private markEmpty(cell: number) {
    if (this.beads[cell] < 0) this.addTo(this.emptyByColor, this.target[cell], cell);
  }

  private onBecameCorrect(cell: number) {
    this.ice[cell] = 0;
    if (this.star[cell]) {
      this.star[cell] = 0;
      this.starBonus += STAR_BONUS;
      this.ev.stars.push(cell);
    }
    for (const n of [cell, ...this.neighbors4(cell)]) {
      if (this.fog[n]) {
        this.fog[n] = 0;
        this.ev.fogCleared.push(n);
      }
    }
    if (this.lockColor >= 0 && this.target[cell] === this.lockColor) {
      let done = true;
      for (let i = 0; i < this.target.length; i++) {
        if (this.target[i] === this.lockColor && this.beads[i] !== this.lockColor) {
          done = false;
          break;
        }
      }
      if (done) {
        for (let i = 0; i < this.locked.length; i++) {
          if (this.locked[i]) {
            this.locked[i] = 0;
            this.ev.unlocked.push(i);
          }
        }
      }
    }
  }

  /** 每次玩家点击后炸弹倒数；归零时把周围 3×3 已归位的豆子打乱 */
  private tickBombs() {
    for (let i = 0; i < this.bomb.length; i++) {
      if (this.bomb[i] < 0) continue;
      this.bomb[i]--;
      if (this.bomb[i] > 0) continue;
      this.bomb[i] = -1;
      const x = i % this.w;
      const y = Math.floor(i / this.w);
      const around: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < this.w && ny < this.h) {
            const n = ny * this.w + nx;
            if (this.isCorrect(n) && !this.locked[n]) around.push(n);
          }
        }
      }
      const colors = around.map((c) => this.beads[c]);
      const rotated = colors.length ? [...colors.slice(1), colors[0]] : [];
      const scrambled: number[] = [];
      around.forEach((c, k) => {
        if (rotated[k] !== this.beads[c]) {
          scrambled.push(c);
          this.setBead(c, rotated[k]);
        }
      });
      this.ev.bombs.push({ cell: i, scrambled });
    }
  }

  private findSource(color: number, near: number): number {
    const set = this.wrongByColor.get(color);
    if (!set || !set.size) return -1;
    let best = -1;
    let bestD = Infinity;
    const fx = near % this.w;
    const fy = Math.floor(near / this.w);
    for (const c of set) {
      if (c === near) continue;
      const dx = (c % this.w) - fx;
      const dy = Math.floor(c / this.w) - fy;
      // 冰封 / 锁链格作为来源时代价更高
      const d = dx * dx + dy * dy + (this.ice[c] || this.locked[c] ? 1e6 : 0);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private pushUndo() {
    this.undoStack.push({
      beads: Int16Array.from(this.beads),
      slots: [...this.slots],
      ice: Uint8Array.from(this.ice),
      locked: Uint8Array.from(this.locked),
      bomb: Int16Array.from(this.bomb),
      star: Uint8Array.from(this.star),
      fog: Uint8Array.from(this.fog),
    });
    if (this.undoStack.length > 10) this.undoStack.shift();
  }

  private rebuildIndexes() {
    this.emptyByColor.clear();
    this.wrongByColor.clear();
    this.correct = 0;
    for (let i = 0; i < this.target.length; i++) {
      const t = this.target[i];
      if (t < 0) continue;
      const b = this.beads[i];
      if (b < 0) this.addTo(this.emptyByColor, t, i);
      else if (b === t) this.correct++;
      else this.addTo(this.wrongByColor, b, i);
    }
  }

  private neighbors4(c: number): number[] {
    const x = c % this.w;
    const out: number[] = [];
    if (x > 0) out.push(c - 1);
    if (x < this.w - 1) out.push(c + 1);
    if (c - this.w >= 0) out.push(c - this.w);
    if (c + this.w < this.target.length) out.push(c + this.w);
    return out.filter((n) => this.target[n] >= 0);
  }

  private countPlacements(n: number) {
    for (let j = 0; j < n; j++) {
      const s = this.stats;
      s.combo = this.elapsed - this.lastPlaceAt <= COMBO_WINDOW ? s.combo + 1 : 1;
      this.lastPlaceAt = this.elapsed;
      s.maxCombo = Math.max(s.maxCombo, s.combo);
      s.placements++;
      s.score += Math.round(10 * Math.min(3, 1 + s.combo * 0.1));
    }
  }

  private insertSlot(color: number): number {
    let k = this.slots.length;
    while (k > 0 && this.slots[k - 1] > color) k--;
    this.slots.splice(k, 0, color);
    return k;
  }

  private nearest(set: Set<number> | undefined, from: number): number {
    if (!set || set.size === 0) return -1;
    if (from < 0) return set.values().next().value as number;
    const fx = from % this.w;
    const fy = Math.floor(from / this.w);
    let best = -1;
    let bestD = Infinity;
    for (const c of set) {
      const dx = (c % this.w) - fx;
      const dy = Math.floor(c / this.w) - fy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private addTo(map: Map<number, Set<number>>, key: number, cell: number) {
    let s = map.get(key);
    if (!s) map.set(key, (s = new Set()));
    s.add(cell);
  }
}
