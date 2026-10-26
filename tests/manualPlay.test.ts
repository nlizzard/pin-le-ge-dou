import { describe, expect, it } from 'vitest';
import { defaultLockedSlots, Game } from '../client/src/core/engine';
import { buildLevel, LEVEL_COUNT } from '../client/src/core/level';

function invariant(g: Game) {
  // 豆子守恒：空槽里几颗，棋盘上就有几个空孔；索引与棋盘一致
  expect(g.emptyCells().length).toBe(g.slots.length);
  let correct = 0;
  for (let i = 0; i < g.target.length; i++) if (g.isCorrect(i)) correct++;
  expect(g.correct).toBe(correct);
  expect(g.slots.length).toBeLessThanOrEqual(g.capacity);
}

function newGame(id: number) {
  const g = new Game(buildLevel(id));
  g.lockedSlots = defaultLockedSlots(g.capacity);
  g.start();
  return g;
}

/** 合理的手动玩法：空槽里有能归位的就点空槽；有同色空孔的豆子就放；否则挑最小的一组进空槽 */
function playManual(g: Game, maxSteps = 50000) {
  let unlocked = false;
  for (let step = 0; step < maxSteps && g.state === 'playing'; step++) {
    const trayColor = g.slots.find((c) => g.holesFor(c) > 0);
    if (trayColor !== undefined) {
      expect(g.trayToHoles(trayColor).type).toBe('moved');
      invariant(g);
      continue;
    }
    // 冰封的豆子如果颜色有空孔，先敲冰（和经典聪明玩法一致）
    const icy = [...g.target.keys()].find((i) => g.ice[i] && !g.locked[i] && !g.isCorrect(i) && g.beads[i] >= 0 && g.holesFor(g.beads[i]) > 0);
    if (icy !== undefined) { g.tap(icy); continue; }
    let direct: number[] = [];
    let smallest: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < g.target.length; i++) {
      if (seen.has(i) || !g.movable(i)) continue;
      const grp = g.groupAt(i);
      grp.forEach((c) => seen.add(c));
      if (g.holesFor(g.beads[i]) > 0) { direct = grp; break; }
      // 进空槽时挑「腾出的孔正好是空槽里颜色」比例高、又小的一组，和真人思路一致
      const fit = grp.slice(0, Math.max(1, g.freeSlots));
      const score = (gr: number[]) => gr.filter((c) => g.slots.includes(g.target[c])).length / gr.length - gr.length * 0.01;
      if (g.freeSlots > 0 && grp.length > g.freeSlots) continue;
      if (!smallest.length || score(fit) > score(smallest)) smallest = fit;
    }
    if (!direct.length && !smallest.length) {
      for (let i = 0; i < g.target.length; i++) if (g.movable(i)) { const grp = g.groupAt(i); if (!smallest.length || grp.length < smallest.length) smallest = grp; }
    }
    if (!direct.length) {
      const anyIce = [...g.target.keys()].find((i) => g.ice[i] && !g.locked[i] && !g.isCorrect(i) && g.beads[i] >= 0);
      if (anyIce !== undefined && (!smallest.length || smallest.length > 1)) { g.tap(anyIce); continue; }
    }
    if (direct.length) {
      expect(g.placeGroup(direct).type).toBe('moved');
    } else if (smallest.length) {
      if (g.freeSlots <= 0 && g.lockedSlots > 0) { g.unlockSlots(); unlocked = true; }
      g.groupToTray(smallest);
    } else {
      // 只剩冰封 / 锁链：用经典点击敲冰
      const ice = [...g.target.keys()].find((i) => g.ice[i] && !g.isCorrect(i));
      if (ice === undefined) break;
      g.tap(ice);
    }
    if (g.state === 'playing') invariant(g);
  }
  return { g, unlocked };
}

describe('手动玩法（点豆浮起 → 点目的地）', () => {
  it('placeGroup：整组飞进同色空孔，不从空槽自动回填', () => {
    const g = newGame(5);
    // 先把一组放进空槽制造空孔
    const a = [...g.target.keys()].find((i) => g.movable(i))!;
    const grp = g.groupAt(a);
    g.groupToTray(grp);
    const slotsBefore = g.slots.length;
    expect(slotsBefore).toBeGreaterThan(0);
    invariant(g);
    const color = g.slots[0];
    const holes = g.holesFor(color);
    if (holes) {
      const r = g.trayToHoles(color);
      expect(r.type).toBe('moved');
      expect(g.slots.length).toBe(slotsBefore - Math.min(holes, slotsBefore));
    }
  });

  it('锁住的空槽不能用，开启后本关最多 2 星', () => {
    const g = newGame(10);
    const locked = g.lockedSlots;
    expect(g.freeSlots).toBe(g.capacity - locked);
    expect(g.unlockSlots()).toBe(locked > 0);
    if (locked) {
      expect(g.freeSlots).toBe(g.capacity);
      g.state = 'won';
      expect(g.stars()).toBeLessThanOrEqual(2);
    }
  });

  it('空槽一格都没有时再放进空槽 = 爆槽', () => {
    const g = newGame(30);
    for (let k = 0; k < 500 && g.state === 'playing' && g.freeSlots > 0; k++) {
      const a = [...g.target.keys()].find((i) => g.movable(i) && g.holesFor(g.beads[i]) === 0);
      if (a === undefined) return;
      g.groupToTray(g.groupAt(a));
    }
    if (g.state !== 'playing') return;
    const a = [...g.target.keys()].find((i) => g.movable(i));
    if (a === undefined) return;
    expect(g.groupToTray(g.groupAt(a)).type).toBe('burst');
  });

  it('抽样关卡（每 7 关一关）按合理手动玩法能通关', () => {
    let unlockedCount = 0;
    const failed: number[] = [];
    let n = 0;
    for (let id = 1; id <= LEVEL_COUNT; id += 7) {
      n++;
      const { g, unlocked } = playManual(newGame(id));
      if (unlocked) unlockedCount++;
      if (g.state !== 'won') failed.push(id);
    }
    console.log(`manual play: ${n} levels, unlocked locked slots in ${unlockedCount}, not won: ${failed.length} ${failed.slice(0, 20).join(',')}`);
    expect(failed.length / n).toBeLessThan(0.05);
  }, 180000);
});
