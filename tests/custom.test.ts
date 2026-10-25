import { describe, it, expect } from 'vitest';
import { buildCustomLevel, quantizeImage, validateCustomSize } from '../client/src/core/custom';
import { buildLevel } from '../client/src/core/level';
import { Game } from '../client/src/core/engine';
import { PROPS } from '../client/src/core/props';

function grid() {
  const rgba = new Uint8ClampedArray(8 * 6 * 4);
  for (let i = 0; i < 48; i++) rgba.set(i === 0 ? [0,0,0,0] : i % 3 ? [235,70,120,255] : [60,160,200,255], i * 4);
  return quantizeImage(rgba, 8, 6, 8);
}
describe('自由创作关卡', () => {
  it('自定义格子数只接受 16–128 的整数', () => {
    for (const n of [16, 64, 80, 96, 128, 160, 256]) expect(validateCustomSize(n)).toBe(n);
    for (const n of [0, 15, 257, 24.5, NaN, Infinity]) expect(() => validateCustomSize(n)).toThrow('整数');
  });
  it('128 格画布可转换并打乱，越界尺寸被拒绝', () => {
    const pixels = new Uint8ClampedArray(128 * 128 * 4);
    for (let i = 0; i < 128 * 128; i++) pixels.set(i % 2 ? [235,70,120,255] : [60,160,200,255], i * 4);
    const large = quantizeImage(pixels, 128, 128, 8);
    const def = buildCustomLevel(large, '大幅创作', 42);
    expect([def.w, def.h, def.target.length]).toEqual([128, 128, 16384]);
    expect(def.wrongCount).toBeGreaterThan(0);
    expect([...def.beads].sort()).toEqual([...def.target].sort());
    expect(() => quantizeImage(new Uint8ClampedArray(257 * 4), 257, 1, 8)).toThrow('尺寸无效');
  });
  it('保留比例、透明区域与色板索引', () => {
    const g = grid();
    expect([g.w, g.h]).toEqual([8, 6]);
    expect(g.target[0]).toBe(-1);
    expect(g.colors).toHaveLength(2);
    for (const c of g.target) expect(c).toBeLessThan(g.colors.length);
  });
  it('拒绝空白与纯色图片', () => {
    expect(() => quantizeImage(new Uint8ClampedArray(16), 2, 2, 8)).toThrow('可见区域');
    expect(() => quantizeImage(new Uint8ClampedArray(16).fill(255), 2, 2, 8)).toThrow('一种颜色');
  });
  it('多种种子打乱后颜色守恒，修正道具能完成整图', () => {
    for (let seed = 0; seed < 20; seed++) {
      const def = buildCustomLevel(grid(), '测试', seed);
      expect(def.wrongCount).toBeGreaterThan(0);
      expect([...def.beads].sort()).toEqual([...def.target].sort());
      const g = new Game(def); g.start();
      for (let i = 0; i < g.target.length; i++) g.fixCell(i);
      g.checkWin(); expect(g.state).toBe('won');
      expect([...g.beads]).toEqual([...g.target]);
    }
  });
  it('图片身份不依赖名称或打乱种子', () => {
    expect(buildCustomLevel(grid(), 'A', 1).key).toBe(buildCustomLevel(grid(), 'B', 42).key);
  });
  it('不限时，冻结和加时不改实际完成时间', () => {
    const g = new Game(buildCustomLevel(grid(), '计时')); g.start();
    expect(g.tick(4000)).toBe(false); expect(g.overtime).toBe(false);
    g.freeze(20); g.addTime(30); g.tick(10);
    expect(g.playedSeconds).toBe(4010); expect(g.elapsed).toBe(4010);
    g.state = 'won'; g.tick(20); expect(g.playedSeconds).toBe(4010);
  });
  it('全部道具突破每局次数限制，凤凰与续命可重复使用', () => {
    const g = new Game(buildCustomLevel(grid(), '道具'));
    for (const p of PROPS) for (let i = 0; i < p.perGame + 3; i++) expect(g.consumeProp(p.id, p.perGame)).toBe(true);
    for (let i = 0; i < 5; i++) { g.state = 'burst'; expect(g.revive(4)).toBe(true); }
  });
  it('普通关卡仍然倒计时并限制道具，实际时间不受冻结影响', () => {
    const g = new Game(buildLevel(1)); g.start(); g.freeze(20); g.tick(10);
    expect(g.elapsed).toBe(0); expect(g.playedSeconds).toBe(10);
    expect(g.consumeProp('meteor', 1)).toBe(true); expect(g.consumeProp('meteor', 1)).toBe(false);
    g.tick(10); expect(g.tick(9999)).toBe(true); expect(g.overtime).toBe(true);
  });
});
