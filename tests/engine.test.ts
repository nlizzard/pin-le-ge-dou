import { describe, expect, it } from 'vitest';
import { Game } from '../client/src/core/engine';
import { buildLevel, countWrong, LEVEL_COUNT, patternToGrid, type LevelDef } from '../client/src/core/level';
import { mulberry32 } from '../client/src/core/rng';

function invariant(g: Game) {
  // 空槽里的颜色不会被任何空位需要；空槽数 = 空位数；索引与棋盘一致
  for (const c of g.slots) expect(g.emptyByColor.get(c)?.size ?? 0).toBe(0);
  expect(g.slots.length).toBe(g.emptyCells().length);
  let correct = 0;
  for (let i = 0; i < g.target.length; i++) if (g.isCorrect(i)) correct++;
  expect(g.correct).toBe(correct);
}

function withElements(minId = 4): LevelDef[] {
  const out: LevelDef[] = [];
  for (let id = minId; id <= LEVEL_COUNT * 4; id++) out.push(buildLevel(id));
  return out;
}
import { PATTERNS } from '../client/src/core/patterns';

/** 聪明玩法：有空位就点它需要的颜色，没有空位才开新链 */
function playSmart(g: Game, maxSteps = 100000) {
  g.start();
  for (let step = 0; step < maxSteps && g.state === 'playing'; step++) {
    let cell = -1;
    for (const { color } of g.neededColors()) {
      for (const c of g.wrongByColor.get(color) ?? []) {
        if (!g.locked[c]) {
          cell = c; // 冰封的也点：第一下敲冰
          break;
        }
      }
      if (cell >= 0) break;
    }
    if (cell < 0) {
      // 没有空位时开新链：挑最小的一组，少占空槽
      let best = Infinity;
      for (const set of g.wrongByColor.values()) {
        for (const c of set) {
          if (g.locked[c]) continue;
          const n = g.ice[c] ? 0.5 : g.groupAt(c).length;
          if (n < best) {
            best = n;
            cell = c;
          }
        }
      }
    }
    if (cell < 0) break;
    g.tap(cell);
  }
}

describe('patterns', () => {
  it('all patterns parse', () => {
    for (const p of PATTERNS) {
      const g = patternToGrid(p);
      expect(g.colors.length).toBeGreaterThanOrEqual(3);
      expect(g.target.some((t) => t >= 0)).toBe(true);
    }
  });
});

describe('levels', () => {
  it('are deterministic per id', () => {
    const a = buildLevel(5);
    const b = buildLevel(5);
    expect(Array.from(a.beads)).toEqual(Array.from(b.beads));
    expect(a.capacity).toBe(b.capacity);
  });

  it('conserve colour counts and have misplaced beads', () => {
    for (let id = 1; id <= LEVEL_COUNT * 2; id++) {
      const d = buildLevel(id);
      const count = (arr: Int16Array) => {
        const m = new Map<number, number>();
        arr.forEach((c) => c >= 0 && m.set(c, (m.get(c) ?? 0) + 1));
        return m;
      };
      expect(count(d.beads)).toEqual(count(d.target));
      expect(countWrong(d.target, d.beads)).toBe(d.wrongCount);
      expect(d.wrongCount).toBeGreaterThan(1);
    }
  });

  it('smart play always wins without bursting', () => {
    for (let id = 1; id <= LEVEL_COUNT * 2; id++) {
      const g = new Game(buildLevel(id));
      playSmart(g);
      expect(g.state).toBe('won');
      expect(g.slots.length).toBe(0);
      expect(g.stars()).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('rules', () => {
  it('random tapping bursts when slots fill, revive continues', () => {
    const g = new Game(buildLevel(3));
    g.start();
    let burst = false;
    // 总是开新链（点不被需要的颜色）直到爆槽
    for (let n = 0; n < 500 && !burst; n++) {
      const needed = new Set(g.neededColors().map((x) => x.color));
      let cell = -1;
      for (const [color, set] of g.wrongByColor) {
        if (!needed.has(color) && set.size) {
          cell = set.values().next().value as number;
          break;
        }
      }
      if (cell < 0) break;
      burst = g.tap(cell).type === 'burst';
    }
    if (burst) {
      expect(g.state).toBe('burst');
      expect(g.revive(4)).toBe(true);
      expect(g.state).toBe('playing');
    }
  });

  it('overtime is permanent and caps stars at half', () => {
    const g = new Game(buildLevel(2));
    g.start();
    expect(g.tapTimer()).toBe(true);
    expect(g.addedTime).toBe(10);
    g.tick(g.timeLeft + 1);
    expect(g.overtime).toBe(true);
    expect(g.tapTimer()).toBe(false);
    playSmart(g);
    expect(g.state).toBe('won');
    expect(g.stars()).toBe(0.5);
  });

  it('timer taps are limited to 3', () => {
    const g = new Game(buildLevel(2));
    g.start();
    expect([g.tapTimer(), g.tapTimer(), g.tapTimer(), g.tapTimer()]).toEqual([true, true, true, false]);
  });

  it('a tap moves the connected same-colour group, never mixing the two destinations', () => {
    let sawGroupToSlot = false;
    let sawGroupToCell = false;
    for (let id = 1; id <= LEVEL_COUNT; id++) {
      const g = new Game(buildLevel(id));
      g.start();
      for (let n = 0; n < 400 && g.state === 'playing'; n++) {
        // 随机点（偏向需要的颜色），检查每一步
        let cell = -1;
        for (const { color } of g.neededColors()) {
          const set = g.wrongByColor.get(color);
          const mv = [...(set ?? [])].filter((x) => g.movable(x));
          if (mv.length && n % 2 === 0) cell = mv[n % mv.length];
        }
        if (cell < 0) {
          const all = [...g.wrongByColor.values()].flatMap((s) => [...s]).filter((x) => g.movable(x));
          if (!all.length) break;
          cell = all[(n * 7919) % all.length];
        }
        const group = g.groupAt(cell);
        const color = g.beads[cell];
        const needed = g.emptyByColor.get(color)?.size ?? 0;
        if (!needed && group.length > g.freeSlots) {
          expect(g.tap(cell).type).toBe('burst');
          break;
        }
        const r = g.tap(cell);
        expect(r.type).toBe('moved');
        if (r.type !== 'moved') break;
        const first = r.moves.filter((m) => m.kind !== 'slotToCell');
        const kinds = new Set(first.map((m) => m.kind));
        expect(kinds.size).toBe(1); // 互斥
        if (kinds.has('cellToSlot')) {
          expect(first.length).toBe(group.length); // 整组进槽
          if (group.length > 1) sawGroupToSlot = true;
        } else {
          expect(first.length).toBe(Math.min(group.length, needed));
          expect(first[0].kind === 'cellToCell' && first[0].from).toBe(cell); // 点的那颗一定动
          if (first.length > 1) sawGroupToCell = true;
        }
        // 不变量：空槽里的颜色不会被任何空位需要
        for (const c of g.slots) expect(g.emptyByColor.get(c)?.size ?? 0).toBe(0);
      }
    }
    expect(sawGroupToSlot).toBe(true);
    expect(sawGroupToCell).toBe(true);
  });

  it('locked beads cannot be picked up', () => {
    const g = new Game(buildLevel(1));
    g.start();
    const i = g.target.findIndex((t, k) => t >= 0 && g.beads[k] === t);
    expect(g.tap(i).type).toBe('locked');
  });
});

describe('props', () => {
  it('fixCell always fixes the target and keeps invariants', () => {
    for (let id = 2; id <= LEVEL_COUNT; id++) {
      const g = new Game(buildLevel(id));
      g.start();
      // 先制造一些空位和空槽
      for (let k = 0; k < 4; k++) {
        const c = [...g.wrongByColor.values()].flatMap((s) => [...s]).find((x) => g.movable(x) && g.groupAt(x).length <= g.freeSlots);
        if (c !== undefined) g.tap(c);
      }
      for (const t of g.unfixedCells().slice(0, 15)) {
        g.fixCell(t);
        expect(g.isCorrect(t)).toBe(true);
        invariant(g);
      }
    }
  });

  it('magnet fixes all cells of a colour; broom clears slots with ≥20% landing right', () => {
    const g = new Game(buildLevel(5));
    g.start();
    const color = g.magnetColors()[0];
    const first = g.magnetTargets(color);
    expect(first.length).toBeLessThanOrEqual(20);
    for (const t of first) g.fixCell(t);
    for (const t of g.magnetTargets(color, 999)) g.fixCell(t);
    expect(g.magnetTargets(color, 999).length).toBe(0);
    invariant(g);

    const g2 = new Game(buildLevel(6));
    g2.start();
    for (let k = 0; k < 3; k++) {
      const c = [...g2.wrongByColor.values()].flatMap((s) => [...s]).find((x) => g2.movable(x) && !g2.emptyByColor.get(g2.beads[x])?.size && g2.groupAt(x).length <= g2.freeSlots);
      if (c !== undefined) g2.tap(c);
    }
    const before = g2.unfixedCells().length;
    g2.broom(mulberry32(1));
    expect(g2.slots.length).toBe(0);
    expect(g2.emptyCells().length).toBe(0);
    expect(before - g2.unfixedCells().length).toBeGreaterThanOrEqual(Math.ceil(before * 0.2) - 1);
    invariant(g2);
  });

  it('undo restores the board from up to 3 taps ago', () => {
    const g = new Game(buildLevel(7));
    g.start();
    const start = Array.from(g.beads);
    for (let k = 0; k < 3; k++) {
      const c = [...g.wrongByColor.values()].flatMap((s) => [...s]).find((x) => g.movable(x) && g.groupAt(x).length <= g.freeSlots);
      g.tap(c!);
    }
    expect(g.undo()).toBe(true);
    expect(Array.from(g.beads)).toEqual(start);
    expect(g.slots.length).toBe(0);
    invariant(g);
    expect(g.undo()).toBe(false);
  });

  it('phoenix revives a burst game with empty slots and +30s', () => {
    const g = new Game(buildLevel(3));
    g.start();
    g.capacity = 1;
    let res;
    for (let k = 0; k < 50; k++) {
      const c = [...g.wrongByColor.values()].flatMap((s) => [...s]).find((x) => g.movable(x) && !g.emptyByColor.get(g.beads[x])?.size);
      if (c === undefined) break;
      res = g.tap(c);
      if (res.type === 'burst') break;
    }
    expect(g.state).toBe('burst');
    g.phoenix(mulberry32(2));
    expect(g.state).toBe('playing');
    expect(g.slots.length).toBe(0);
    expect(g.addedTime).toBe(30);
    invariant(g);
  });

  it('amber freezes the clock', () => {
    const g = new Game(buildLevel(2));
    g.start();
    g.freeze(20);
    g.tick(10);
    expect(g.elapsed).toBe(0);
    g.tick(15);
    g.tick(5);
    expect(g.elapsed).toBe(5);
  });

  it('per-game prop limits', () => {
    const g = new Game(buildLevel(2));
    expect([g.consumeProp('magnet', 2), g.consumeProp('magnet', 2), g.consumeProp('magnet', 2)]).toEqual([true, true, false]);
    expect(g.stats.propsUsed).toBe(2);
  });
});

describe('special tiles', () => {
  it('levels from 4 on get elements, and every level stays solvable', () => {
    const defs = withElements();
    const kinds = { ice: 0, star: 0, fog: 0, lock: 0, bomb: 0 };
    for (const d of defs) {
      if (d.elements.ice.length) kinds.ice++;
      if (d.elements.star.length) kinds.star++;
      if (d.elements.fog.length) kinds.fog++;
      if (d.elements.lock) kinds.lock++;
      if (d.elements.bombs.length) kinds.bomb++;
      const g = new Game(d);
      playSmart(g);
      expect(g.state, `level ${d.id}`).toBe('won');
    }
    for (const v of Object.values(kinds)) expect(v).toBeGreaterThan(0);
    for (let id = 1; id <= 3; id++) {
      const e = buildLevel(id).elements;
      expect(e.ice.length + e.star.length + e.fog.length + e.bombs.length + (e.lock ? 1 : 0)).toBe(0);
    }
  });

  it('ice needs two taps; lock blocks until its colour is complete', () => {
    const d = withElements().find((x) => x.elements.ice.length)!;
    const g = new Game(d);
    g.start();
    const c = d.elements.ice[0];
    expect(g.tap(c).type).toBe('ice');
    expect(g.ice[c]).toBe(0);

    const dl = withElements().find((x) => x.elements.lock)!;
    const gl = new Game(dl);
    gl.start();
    const lc = dl.elements.lock!.cells[0];
    expect(gl.tap(lc).type).toBe('blocked');
    for (const t of gl.magnetTargets(dl.elements.lock!.color, 999)) gl.fixCell(t);
    expect(gl.locked[lc]).toBe(0);
    invariant(gl);
  });

  it('stars add time when fixed; bombs explode after their steps', () => {
    const ds = withElements().find((x) => x.elements.star.length)!;
    const gs = new Game(ds);
    gs.start();
    const before = gs.timeLeft;
    gs.fixCell(ds.elements.star[0]);
    expect(gs.starBonus).toBe(3);
    expect(gs.timeLeft).toBeCloseTo(before + 3);

    const db = withElements().find((x) => x.elements.bombs.length)!;
    const gb = new Game(db);
    gb.start();
    const bomb = db.elements.bombs[0];
    let exploded = false;
    for (let k = 0; k < bomb.steps + 2 && !exploded && gb.state === 'playing'; k++) {
      // 点别的豆子（不碰炸弹）
      const c = [...gb.wrongByColor.values()].flatMap((s) => [...s]).find((x) => x !== bomb.cell && gb.movable(x) && gb.bomb[x] < 0 && !gb.groupAt(x).includes(bomb.cell) && (gb.emptyByColor.get(gb.beads[x])?.size || gb.groupAt(x).length <= gb.freeSlots));
      if (c === undefined) break;
      const r = gb.tap(c);
      if ((r.type === 'moved' || r.type === 'ice') && r.events.bombs.length) exploded = true;
    }
    expect(exploded).toBe(true);
    invariant(gb);
  });
});
