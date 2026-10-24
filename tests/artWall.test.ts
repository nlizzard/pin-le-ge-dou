import { describe, expect, it } from 'vitest';
import { normalizePlacement, normalizeWallSettings, wallWorkBounds, workShareData, type WallWork } from '../client/src/artWallStore';
import { buildCustomLevel } from '../client/src/core/custom';
import { defaultCardOptions } from '../client/src/render/shareCard';

describe('作品墙布局与再编辑', () => {
  it('拖动、缩放与旋转的边界不会把作品移出墙面', () => {
    expect(normalizePlacement({ x: -2, y: 8, size: 99, rotation: -90, z: 0, onWall: false }))
      .toEqual({ x: 0, y: 1, size: 32, rotation: -12, z: 1, onWall: false });
    const p = normalizePlacement({ x: NaN, y: Infinity, size: -1, rotation: 90, z: Infinity, onWall: true });
    expect(Object.values(p).every(v => typeof v !== 'number' || Number.isFinite(v))).toBe(true);
  });
  it('无效墙面配置恢复为可用的默认值', () => {
    expect(normalizeWallSettings({ title: '  ' })).toEqual({ title: '我的小画室', theme: 'cream', decor: 'flowers' });
    expect(normalizeWallSettings({ title: '  我的收藏  ', theme: 'night', decor: 'none' })).toEqual({ title: '我的收藏', theme: 'night', decor: 'none' });
  });
  it('最大竖幅画旋转后拖到任一边缘仍完整留在墙内', () => {
    const p = { x: 0, y: 0, size: 32, rotation: 12, z: 1, onWall: true };
    const b = wallWorkBounds(720, 540, p, '9:16');
    const a = Math.PI / 15;
    const overX = (b.width * Math.cos(a) + b.height * Math.sin(a) - b.width) / 2;
    const overY = (b.height * Math.cos(a) + b.width * Math.sin(a) - b.height) / 2;
    expect(b.marginX - overX).toBeCloseTo(16);
    expect(b.marginY - overY).toBeCloseTo(16);
    expect(b.marginX + b.rangeX + b.width + overX).toBeLessThanOrEqual(720);
    expect(b.marginY + b.rangeY + b.height + overY).toBeLessThanOrEqual(540);
  });
  it('保存的原图可以重新生成分享卡，并能重新创建可解的关卡', () => {
    const work: WallWork = { id: 'custom-test', name: '小小收藏', grid: { w: 2, h: 2, colors: ['#ff0000', '#00ff00'], target: new Int16Array([0, 1, -1, 0]) },
      seconds: 45, propsUsed: 2, completedAt: 123, options: defaultCardOptions(), placement: { x: .3, y: .4, size: 20, rotation: 3, z: 1, onWall: true } };
    const data = workShareData(work);
    expect(data.seconds).toBe(45); expect(data.level.name).toBe(work.name);
    expect([...data.level.target]).toEqual([0, 1, -1, 0]);
    const replay = buildCustomLevel(work.grid, work.name, 42);
    expect(replay.wrongCount).toBeGreaterThan(0);
    replay.target[0] = 1;
    expect(work.grid.target[0]).toBe(0);
  });
});
