import { describe, expect, it } from 'vitest';
import { separateColors } from '../client/src/render/sprites';

describe('相近色拉开', () => {
  it('太接近的颜色被拉开且结果确定', () => {
    const src = ['#fff4f6', '#ffb3c4', '#ffb1c2', '#c2185b'];
    const a = separateColors(src);
    const b = separateColors(src);
    expect(a).toEqual(b); // 确定性：同一输入永远同一输出
    expect(new Set(a).size).toBe(a.length); // 拉开后不再有重复色
    expect(a[3]).toBe(src[3]); // 已经足够的颜色不动
    for (const c of a) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('本身分得很开的调色板原样返回', () => {
    const src = ['#e53935', '#ffd54f', '#43a047', '#1e88e5'];
    expect(separateColors(src)).toEqual(src);
  });
  it('完全相同的颜色也会分出可辨的差异', () => {
    const out = separateColors(['#cccccc', '#cccccc', '#cccccc']);
    expect(new Set(out).size).toBe(3);
  });
});
