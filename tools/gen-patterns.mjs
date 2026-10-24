// 程序化生成可爱的对称像素图案，写成静态清单 client/src/core/generatedPatterns.ts。
// 用静态模块而不是 levels/*.json + import.meta.glob：vitest 与 vite SSR 对 glob 行为不一致。
// 每个图案 = 图形家族 + 糖果色；同一家族的每个实例用不同的变体参数（形状/比例）加
// 旋转/镜像变换，保证 200 关的图案**连灰色剪影都不重复**。
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'src', 'core', 'generatedPatterns.ts');
const N = 18;

const COLORS = [
  ['草莓红', '#f2556d'], ['樱花粉', '#ff9db8'], ['蜜桃橘', '#ffab82'], ['柠檬黄', '#ffd75e'],
  ['抹茶绿', '#8fd18a'], ['薄荷青', '#7fd8c8'], ['天空蓝', '#8ec5ff'], ['香芋紫', '#c39bd3'],
  ['薰衣草紫', '#b79bff'], ['玫瑰红', '#e35d8f'], ['焦糖棕', '#d29a6b'], ['珊瑚橙', '#ff8f70'],
  ['莓果紫', '#9b6bb8'], ['海盐蓝', '#a5d8e6'], ['奶油黄', '#ffe3a9'],
];
const LEAF = '#7cb26a', CREAM = '#fff1d6', DOUGH = '#e8b877', BEAK = '#ff9f43', WHITE = '#ffffff';

function darken(hex, f = 0.5) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const to = v => Math.round(v * f).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

function grid() { return Array.from({ length: N }, () => Array(N).fill('.')); }
function set(g, x, y, ch) { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = ch; }
function fillEllipse(g, cx, cy, rx, ry, ch) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.06) set(g, x, y, ch);
    }
}
function fillCircle(g, cx, cy, r, ch) { fillEllipse(g, cx, cy, r, r, ch); }
function fillRect(g, x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(g, x, y, ch); }
function inTriangle(px, py, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([px, py], b, c), d2 = s(a, [px, py], c), d3 = s(a, b, [px, py]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function fillTriangle(g, a, b, c, ch) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inTriangle(x, y, a, b, c)) set(g, x, y, ch);
}
function inPoly(px, py, vs) {
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1], xj = vs[j][0], yj = vs[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function fillPolygon(g, vs, ch) { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inPoly(x, y, vs)) set(g, x, y, ch); }
/** 左半 + 中轴绘制后镜像到右半，保证左右对称 */
function mirror(g) { for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) g[y][N - 1 - x] = g[y][x]; }

function rot90(g) { const o = grid(); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) o[x][N - 1 - y] = g[y][x]; return o; }
function flipH(g) { return g.map(r => r.slice().reverse()); }
function translate(g, dx, dy) {
  const o = grid();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] !== '.') set(o, x + dx, y + dy, g[y][x]);
  return o;
}
const TRANSFORMS = [
  (g) => g, rot90, (g) => rot90(rot90(g)), (g) => rot90(rot90(rot90(g))),
  flipH, (g) => rot90(flipH(g)), (g) => rot90(rot90(flipH(g))), (g) => rot90(rot90(rot90(flipH(g)))),
];

/* ---------- 图形家族：draw(g, p, v)；v 是本家族第几个实例，必须真的改变形状 ---------- */
const FAMILIES = [
  {
    noun: '小花',
    draw(g, p, v) {
      const petals = [5, 6, 7, 8][v % 4];
      const dist = 4.2 + (v % 3) * 0.4, pr = 2.1 + (v % 2) * 0.35;
      for (let k = 0; k < petals; k++) {
        const a = (Math.PI * 2 * k) / petals - Math.PI / 2;
        fillCircle(g, 9 + Math.cos(a) * dist, 8.2 + Math.sin(a) * dist, pr, p.A);
      }
      fillCircle(g, 9, 8.2, 2.4 - (v % 2) * 0.4, p.B);
      fillRect(g, 8, 12, 9, 16, p.L);
      fillEllipse(g, 6.3, 14.5, 1.9, 1, p.L);
    },
  },
  {
    noun: '爱心', hl: true,
    draw(g, p, v) {
      const puff = 2.7 + (v % 3) * 0.3, tip = 14 + (v % 3);
      fillCircle(g, 6.2, 7, puff, p.A);
      fillRect(g, 3.5, 7.5, 8, 9, p.A);
      for (let y = 9; y <= tip; y++) {
        const hw = (tip - y) * (0.6 + (v % 2) * 0.2) + 1.2;
        fillRect(g, 9 - hw, y, 8, y, p.A);
      }
      mirror(g);
      set(g, 5, 6, 'W'); set(g, 6, 7, 'W');
    },
  },
  {
    noun: '星星',
    draw(g, p, v) {
      const R = 5.2 + (v % 3) * 0.5, r = 2.1 + (v % 2) * 0.45, pts = v % 2 ? 5 : 6;
      const vs = [];
      for (let k = 0; k < pts * 2; k++) {
        const rad = k % 2 ? r : R, a = (Math.PI * k) / pts - Math.PI / 2;
        vs.push([9 + Math.cos(a) * rad, 9 + Math.sin(a) * rad]);
      }
      fillPolygon(g, vs, p.A);
      set(g, 4, 4, 'W'); set(g, 13, 12, 'W');
    },
  },
  {
    noun: '小蘑菇',
    draw(g, p, v) {
      const cw = 5.4 + (v % 3) * 0.7;
      fillEllipse(g, 9, 6, cw, 3.6, p.A);
      fillRect(g, Math.round(9 - cw) + 1, 7, Math.round(9 + cw) - 1, 8, p.A);
      fillCircle(g, 5.2 + (v % 2), 5.2 + (v % 3) * 0.6, 1.3, p.B);
      fillCircle(g, 8, 4 + (v % 2) * 0.8, 1.1, p.B);
      mirror(g);
      const sh = 8 + (v % 2);
      fillRect(g, 7, sh + 1, 10, sh + 6, p.C);
      set(g, 7, sh + 3, 'K'); set(g, 10, sh + 3, 'K'); set(g, 8, sh + 4, 'K'); set(g, 9, sh + 4, 'K');
    },
  },
  {
    noun: '气球', hl: true,
    draw(g, p, v) {
      fillEllipse(g, 9, 7, 3.3 + (v % 3) * 0.5, 4.2 + (v % 2) * 0.6, p.A);
      mirror(g);
      set(g, 8, 12, 'B'); set(g, 9, 12, 'B');
      let x = 9;
      for (let y = 13; y <= 16; y++) { set(g, x, y, 'K'); if (y % 2 === 0) x += v % 2 ? 1 : -1; else x -= v % 2 ? 1 : -1; }
      set(g, 6 + (v % 2), 5 + (v % 3), 'B');
    },
  },
  {
    noun: '棒棒糖', hl: true,
    draw(g, p, v) {
      const r = 4.0 + (v % 3) * 0.5;
      fillCircle(g, 8.5, 7.5, r, p.A);
      fillCircle(g, 8.5, 7.5, r - 1.4, p.B);
      fillCircle(g, 8.5, 7.5, r - 2.8, p.A);
      fillCircle(g, 8.5, 7.5, r - 4, p.B);
      fillRect(g, 8, 12 + (v % 2), 9, 17, p.C);
    },
  },
  {
    noun: '糖果', hl: true,
    draw(g, p, v) {
      const r = 2.6 + (v % 3) * 0.4;
      fillTriangle(g, [6, 9], [2, 5], [2, 13], p.B);
      fillCircle(g, 8, 9, r, p.A);
      fillCircle(g, 8, 9, r - 1.5, p.B);
      mirror(g);
    },
  },
  {
    noun: '小鱼',
    draw(g, p, v) {
      const rx = 4.3 + (v % 3) * 0.5;
      fillTriangle(g, [13, 9], [17, 5 + (v % 2)], [17, 13 - (v % 2)], p.B);
      fillEllipse(g, 8.5, 9, rx, 2.6 + (v % 2) * 0.5, p.A);
      fillTriangle(g, [8, 6], [10, 3], [11, 6], p.B);
      fillCircle(g, 8.5, 9.5, 1.4, p.B);
      set(g, 5, 8, 'K');
      set(g, 2, 4, p.B); set(g, 1, 6, p.B);
    },
  },
  {
    noun: '蝴蝶',
    draw(g, p, v) {
      const wr = 2.5 + (v % 3) * 0.45;
      fillCircle(g, 5, 7, wr, p.A);
      fillCircle(g, 5, 12, wr - 0.6, p.B);
      fillRect(g, 8, 6, 8, 13, p.K);
      mirror(g);
      set(g, 7, 4, 'K'); set(g, 6, 3, 'K'); set(g, 11, 4, 'K'); set(g, 12, 3, 'K');
    },
  },
  {
    noun: '兔兔',
    draw(g, p, v) {
      const ear = 3.0 + (v % 3) * 0.5;
      fillEllipse(g, 6, 7.5 - ear / 1.4, 1.3, ear, p.A);
      fillEllipse(g, 6, 7.5 - ear / 1.4, 0.6, ear - 1.2, p.B);
      fillCircle(g, 8, 11, 4.2 - (v % 2) * 0.3, p.A);
      mirror(g);
      set(g, 6, 11, 'K'); set(g, 11, 11, 'K');
      set(g, 8, 12, 'B'); set(g, 9, 12, 'B');
      set(g, 4, 12, 'B'); set(g, 13, 12, 'B');
    },
  },
  {
    noun: '小熊',
    draw(g, p, v) {
      const r = 4.0 + (v % 3) * 0.35;
      fillCircle(g, 5, 6.5, 1.6, p.A);
      fillCircle(g, 5, 6.5, 0.8, p.B);
      fillCircle(g, 8, 10.2, r, p.A);
      mirror(g);
      fillEllipse(g, 8.5, 10.2 + r * 0.42, r * 0.5, r * 0.36, p.C);
      set(g, 8, Math.round(10.2 + r * 0.2), 'K'); set(g, 9, Math.round(10.2 + r * 0.2), 'K');
      set(g, 6, 9, 'K'); set(g, 11, 9, 'K');
    },
  },
  {
    noun: '猫咪',
    draw(g, p, v) {
      const ear = 4 + (v % 3);
      fillTriangle(g, [4, 8], [5, ear - 4], [8, 7], p.A);
      fillTriangle(g, [5, 7], [6, ear - 2], [7, 7], p.B);
      fillCircle(g, 8, 10.2, 4.2 - (v % 2) * 0.3, p.A);
      mirror(g);
      set(g, 6, 10, 'K'); set(g, 11, 10, 'K');
      set(g, 8, 12, 'B'); set(g, 8, 13, 'K');
    },
  },
  {
    noun: '果子', hl: true,
    draw(g, p, v) {
      const r = 4.2 + (v % 3) * 0.45;
      fillCircle(g, 9, 10, r, p.A);
      fillRect(g, 9, Math.round(10 - r) - 2, 9, Math.round(10 - r), p.K);
      fillEllipse(g, 11.5, 5, 1.9, 1, p.L);
    },
  },
  {
    noun: '小幽灵',
    draw(g, p, v) {
      const rx = 4.1 + (v % 3) * 0.5;
      fillEllipse(g, 9, 8, rx, 5 - (v % 2) * 0.5, p.A);
      for (let x = Math.round(9 - rx); x <= Math.round(9 + rx); x++) {
        const cut = x % 2 === 0 ? 12 : 11;
        for (let y = cut; y < 14; y++) if (g[y][x] === p.A) g[y][x] = '.';
      }
      fillRect(g, 6, 8, 7, 9, 'K');
      fillRect(g, 10, 8, 11, 9, 'K');
      fillEllipse(g, 8.5, 10.5, 1, 1.2, 'K');
      set(g, 4, 10, 'B'); set(g, 13, 10, 'B');
    },
  },
  {
    noun: '云朵',
    draw(g, p, v) {
      const r = 2.6 + (v % 3) * 0.35;
      fillCircle(g, 6, 10, r, p.A);
      fillCircle(g, 9, 8.2, r + 0.6, p.A);
      fillCircle(g, 12.5, 10, r, p.A);
      fillRect(g, 4, 10, 13, Math.round(10 + r * 0.7), p.A);
      fillRect(g, 6, 10, 7, 10, 'K');
      fillRect(g, 11, 10, 12, 10, 'K');
      set(g, 5, 12, 'B'); set(g, 12, 12, 'B');
    },
  },
  {
    noun: '宝石', hl: true,
    draw(g, p, v) {
      const hw = 5.6 + (v % 3) * 0.7, hh = 4.2 + (v % 2) * 0.6;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          if (Math.abs(x - 8.5) / hw + Math.abs(y - 9) / hh <= 1) g[y][x] = p.A;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          if (Math.abs(x - 8.5) / (hw * 0.55) + Math.abs(y - 7.5) / (hh * 0.5) <= 1) g[y][x] = p.B;
      set(g, 5, 6, 'W'); set(g, 11, 11, 'W');
    },
  },
  {
    noun: '月牙',
    draw(g, p, v) {
      const R = 5.0 + (v % 3) * 0.4;
      fillCircle(g, 9, 9, R, p.A);
      const ox = 11 + (v % 2), oy = 6 + (v % 3);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const dx = (x - ox) / (R - 1), dy = (y - oy) / (R - 1);
          if (dx * dx + dy * dy <= 1.05) g[y][x] = '.';
        }
      set(g, 3, 4, p.B); set(g, 4, 4, p.B); set(g, 14, 12, p.B); set(g, 13, 13, p.B);
    },
  },
  {
    noun: '杯子蛋糕',
    draw(g, p, v) {
      const fw = 4.4 + (v % 3) * 0.5;
      fillCircle(g, 9, 3, 1.3, p.B);
      fillEllipse(g, 9, 7, fw, 3.2 + (v % 2) * 0.4, p.A);
      for (let y = 8; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === p.A) g[y][x] = '.';
      const top = 10, bot = 15 - (v % 2);
      for (let y = top; y <= bot; y++) {
        const hw = fw - 0.5 - (y - top) * 0.8;
        for (let x = Math.round(8.5 - hw); x <= Math.round(8.5 + hw); x++) set(g, x, y, (x + y) % 3 === 0 ? p.B : p.C);
      }
    },
  },
  {
    noun: '甜甜圈',
    draw(g, p, v) {
      const R = 5.0 + (v % 3) * 0.5;
      fillCircle(g, 9, 9, R, p.D);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const dx = (x - 9) / R, dy = (y - 9) / R;
          if (dx * dx + dy * dy <= 1.06 && y <= 9.5) {
            const hx = (x - 9) / 2, hy = (y - 9) / 2;
            if (hx * hx + hy * hy > 1) g[y][x] = p.A;
          }
        }
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const dx = (x - 9) / 2, dy = (y - 9) / 2;
          if (dx * dx + dy * dy <= 1.05) g[y][x] = '.';
        }
      set(g, 6, 6, p.B); set(g, 11, 5, 'W'); set(g, 13, 8, p.B); set(g, 5, 9, 'W');
    },
  },
  {
    noun: '冰淇淋',
    draw(g, p, v) {
      const spread = 4.6 + (v % 3) * 0.6;
      fillTriangle(g, [8.5, 17], [Math.round(8.5 - spread), 9], [Math.round(8.5 + spread), 9], p.C);
      fillCircle(g, 8.5 - spread + 1.6, 8, 2.6, p.A);
      fillCircle(g, 8.5 + spread - 1.6, 8, 2.6, p.B);
      fillCircle(g, 8.5, 4.8 - (v % 2) * 0.4, 2.6, p.W);
    },
  },
  {
    noun: '星星球',
    draw(g, p, v) {
      const r = 4.0 + (v % 3) * 0.45, ry = 1.8 + (v % 3) * 0.5;
      fillCircle(g, 9, 9, r, p.A);
      for (let t = 0; t < Math.PI * 2; t += 0.05) {
        const x = 9 + Math.cos(t) * (r + 2.6), y = 9 + Math.sin(t) * ry;
        if (x >= 0 && x < N && y >= 0 && y < N) set(g, x, y, p.B);
      }
      fillCircle(g, 7.5, 7.5, 1.2, p.B);
      set(g, 3, 4, 'W'); set(g, 14, 5, 'W');
    },
  },
  {
    noun: '小鸡',
    draw(g, p, v) {
      const r = 4.2 + (v % 3) * 0.35;
      fillCircle(g, 9, 10, r, p.A);
      fillEllipse(g, 6, 10.5, 1.8, 1.2, p.B);
      set(g, 7, 9, 'K'); set(g, 11, 9, 'K');
      fillRect(g, 8, 11, 10, 11, p.O);
      set(g, 9, Math.round(10 - r) + 1, 'K'); set(g, 10, Math.round(10 - r), 'K');
      fillRect(g, 7, 15, 7, 16, 'K'); fillRect(g, 11, 15, 11, 16, 'K');
    },
  },
];

function buildPattern(i, attempt) {
  const famIdx = i % FAMILIES.length;
  const variant = Math.floor(i / FAMILIES.length); // 同一家族的第几个配色
  const fam = FAMILIES[famIdx];
  const ci = (famIdx * 3 + variant) % COLORS.length;
  const [cname, chex] = COLORS[ci];
  const [, shex] = COLORS[(ci + 5) % COLORS.length];
  const colors = { A: chex, B: shex, K: darken(chex), W: WHITE, L: LEAF, C: CREAM, D: DOUGH, O: BEAK };
  const p = { A: 'A', B: 'B', K: 'K', W: 'W', L: 'L', C: 'C', D: 'D', O: 'O' };
  let g = grid();
  fam.draw(g, p, variant);
  // 变换（旋转/镜像）+ 冲突时的平移兜底，保证剪影两两不同
  g = TRANSFORMS[(variant + attempt * 3) % TRANSFORMS.length](g);
  if (attempt > 0) g = translate(g, attempt % 2 ? 1 : -1, attempt > 1 ? 1 : 0);
  outline(g, 'K');
  if (fam.hl) highlight(g);
  const used = new Set(g.flat().filter(c => c !== '.'));
  if (used.size < 3) throw new Error(`图案 ${i} 颜色不足: ${[...used].join(',')}`);
  return {
    key: `gen${String(i + 1).padStart(3, '0')}`,
    name: `${cname}${fam.noun}`,
    palette: Object.fromEntries([...used].map(c => [c, colors[c]])),
    rows: g.map(r => r.join('')),
  };
}

/** 给形状外圈加 1px 描边（贴纸感） */
function outline(g, ch) {
  const adds = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (g[y][x] !== '.') continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const X = x + dx, Y = y + dy;
        return X >= 0 && X < N && Y >= 0 && Y < N && g[Y][X] !== '.';
      });
      if (near) adds.push([x, y]);
    }
  for (const [x, y] of adds) g[y][x] = ch;
}
/** 找一处可以点高光的实心格，往内点两颗白色高光（找不到就跳过） */
function highlight(g) {
  for (let y = 0; y < N - 1; y++)
    for (let x = 0; x < N - 2; x++) {
      if (g[y][x] === '.') continue;
      if (g[y][x + 1] !== '.' && g[y + 1][x + 1] !== '.' && g[y + 1][x + 2] !== '.') {
        g[y + 1][x + 1] = 'W'; g[y + 1][x + 2] = 'W';
      }
      return;
    }
}

const TOTAL = 157;
const seenShapes = new Map(); // 剪影 → 已用次数
const all = [];
for (let i = 0; i < TOTAL; i++) {
  let pat, attempt = 0;
  do {
    pat = buildPattern(i, attempt++);
  } while (seenShapes.has(pat.rows.join('\n')) && attempt < 6);
  const sig = pat.rows.join('\n');
  if (seenShapes.has(sig)) throw new Error(`图案 ${pat.name} 剪影仍然重复`);
  seenShapes.set(sig, 1);
  all.push(pat);
}
const banner = `// 本文件由 tools/gen-patterns.mjs 程序化生成，请勿手改；运行 yarn node tools/gen-patterns.mjs 重新生成。\nimport type { Pattern } from './patterns';\n\nexport const GENERATED_PATTERNS: Pattern[] = `;
writeFileSync(OUT, banner + JSON.stringify(all, null, 1) + ';\n');
console.log(`已生成 ${TOTAL} 个图案，剪影全部独特（形状 ${seenShapes.size}/${TOTAL}）→ ${path.relative(process.cwd(), OUT)}`);
