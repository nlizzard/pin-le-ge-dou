/** 像素小精灵「啵啵」：16×16 像素，由底图 + 表情/手臂贴片组合出各种姿势 */

export type ElfPose =
  | 'idle'
  | 'blink'
  | 'happy'
  | 'excited'
  | 'dance1'
  | 'dance2'
  | 'worried'
  | 'cheer'
  | 'sad'
  | 'sleepy'
  | 'tired'
  | 'pray'
  | 'startle'
  | 'run1'
  | 'run2';

export type ElfSkin = 'normal' | 'gold';

const BASE = [
  '.......GG.......',
  '......GGG.......',
  '.......O........',
  '.....OOOOOO.....',
  '...OOBBBBBBOO...',
  '..OBBLLBBBBBBO..',
  '..OBLLBBBBBBBO..',
  '.OBBBBBBBBBBBBO.',
  '.OBBBBBBBBBBBBO.',
  '.OBBBBBBBBBBBBO.',
  '.OBBBBBBBBBBBBO.',
  '.OBBBBBBBBBBBBO.',
  '..OBBBBBBBBBBO..',
  '...OOBBBBBBOO...',
  '....OOO..OOO....',
  '................',
];

const PALETTES: Record<ElfSkin, Record<string, string>> = {
  normal: { O: '#4a3b6b', B: '#b79cff', L: '#e9e0ff', P: '#ff9fbf', W: '#ffffff', K: '#2b2145', G: '#7bd389', M: '#8a3b5c', Y: '#ffc107', S: '#64b5f6', A: '#4a3b6b', H: '#ff5252' },
  gold: { O: '#7a5200', B: '#ffd54f', L: '#fff3c4', P: '#ff9f80', W: '#ffffff', K: '#3e2700', G: '#ff7043', M: '#8a3b2c', Y: '#ffffff', S: '#64b5f6', A: '#7a5200', H: '#ff5252' },
};

type Stamp = [number, number, string][]; // [row, col, char]

const EYES: Record<string, Stamp> = {
  open: [
    [8, 4, 'K'], [8, 5, 'W'], [9, 4, 'K'], [9, 5, 'K'],
    [8, 10, 'K'], [8, 11, 'W'], [9, 10, 'K'], [9, 11, 'K'],
  ],
  closed: [
    [9, 4, 'K'], [9, 5, 'K'],
    [9, 10, 'K'], [9, 11, 'K'],
  ],
  happy: [
    [9, 3, 'K'], [8, 4, 'K'], [8, 5, 'K'], [9, 6, 'K'],
    [9, 9, 'K'], [8, 10, 'K'], [8, 11, 'K'], [9, 12, 'K'],
  ],
  star: [
    [8, 4, 'Y'], [8, 5, 'Y'], [9, 4, 'Y'], [9, 5, 'Y'], [7, 4, 'W'],
    [8, 10, 'Y'], [8, 11, 'Y'], [9, 10, 'Y'], [9, 11, 'Y'], [7, 11, 'W'],
  ],
  wide: [
    [7, 4, 'K'], [7, 5, 'K'], [8, 4, 'K'], [8, 5, 'W'], [9, 4, 'K'], [9, 5, 'K'],
    [7, 10, 'K'], [7, 11, 'K'], [8, 10, 'K'], [8, 11, 'W'], [9, 10, 'K'], [9, 11, 'K'],
  ],
  sad: [
    [7, 5, 'K'], [8, 4, 'K'], [9, 4, 'K'], [9, 5, 'K'],
    [7, 10, 'K'], [8, 11, 'K'], [9, 10, 'K'], [9, 11, 'K'],
  ],
};

const MOUTH: Record<string, Stamp> = {
  smile: [[10, 6, 'M'], [11, 7, 'M'], [11, 8, 'M'], [10, 9, 'M']],
  open: [[10, 7, 'M'], [10, 8, 'M'], [11, 7, 'H'], [11, 8, 'H']],
  flat: [[11, 7, 'M'], [11, 8, 'M']],
  frown: [[11, 6, 'M'], [10, 7, 'M'], [10, 8, 'M'], [11, 9, 'M']],
  yawn: [[10, 7, 'M'], [10, 8, 'M'], [11, 7, 'H'], [11, 8, 'H'], [12, 7, 'M'], [12, 8, 'M']],
};

const ARMS: Record<string, Stamp> = {
  down: [[10, 0, 'A'], [11, 0, 'A'], [10, 15, 'A'], [11, 15, 'A']],
  up: [[6, 0, 'A'], [5, 0, 'A'], [4, 1, 'A'], [6, 15, 'A'], [5, 15, 'A'], [4, 14, 'A']],
  leftUp: [[6, 0, 'A'], [5, 0, 'A'], [4, 1, 'A'], [10, 15, 'A'], [11, 15, 'A']],
  rightUp: [[10, 0, 'A'], [11, 0, 'A'], [6, 15, 'A'], [5, 15, 'A'], [4, 14, 'A']],
  pray: [[11, 7, 'L'], [11, 8, 'L'], [12, 7, 'L'], [12, 8, 'L'], [10, 7, 'L'], [10, 8, 'L']],
  run1: [[9, 0, 'A'], [10, 0, 'A'], [11, 15, 'A'], [12, 15, 'A']],
  run2: [[11, 0, 'A'], [12, 0, 'A'], [9, 15, 'A'], [10, 15, 'A']],
};

const CHEEKS: Stamp = [[10, 3, 'P'], [10, 12, 'P']];
const SWEAT: Stamp = [[5, 13, 'S'], [6, 13, 'S'], [6, 14, 'S']];
const HEADBAND: Stamp = [[5, 3, 'H'], [5, 4, 'H'], [5, 5, 'H'], [5, 6, 'H'], [5, 7, 'H'], [5, 8, 'H'], [5, 9, 'H'], [5, 10, 'H'], [5, 11, 'H'], [5, 12, 'H']];
const FEET_ALT: Stamp = [[14, 4, '.'], [14, 5, 'O'], [14, 6, 'O'], [14, 7, 'O'], [14, 9, 'O'], [14, 10, 'O'], [14, 11, '.']];

const POSES: Record<ElfPose, Stamp[]> = {
  idle: [EYES.open, MOUTH.smile, ARMS.down, CHEEKS],
  blink: [EYES.closed, MOUTH.smile, ARMS.down, CHEEKS],
  happy: [EYES.happy, MOUTH.open, ARMS.up, CHEEKS],
  excited: [EYES.star, MOUTH.open, ARMS.up, CHEEKS],
  dance1: [EYES.happy, MOUTH.open, ARMS.leftUp, CHEEKS],
  dance2: [EYES.happy, MOUTH.open, ARMS.rightUp, CHEEKS, FEET_ALT],
  worried: [EYES.open, MOUTH.frown, ARMS.down, SWEAT],
  cheer: [EYES.open, MOUTH.smile, ARMS.rightUp, CHEEKS],
  sad: [EYES.sad, MOUTH.frown, ARMS.down],
  sleepy: [EYES.closed, MOUTH.flat, ARMS.down, CHEEKS],
  tired: [EYES.closed, MOUTH.yawn, ARMS.down],
  pray: [EYES.closed, MOUTH.smile, ARMS.pray, CHEEKS],
  startle: [EYES.wide, MOUTH.open, ARMS.up, SWEAT],
  run1: [EYES.open, MOUTH.smile, ARMS.run1, CHEEKS, HEADBAND],
  run2: [EYES.open, MOUTH.smile, ARMS.run2, CHEEKS, HEADBAND, FEET_ALT],
};

const cache = new Map<string, HTMLCanvasElement>();

/** 渲染一个姿势，返回 16×16 的画布（显示时用 image-rendering: pixelated 放大） */
export function elfFrame(pose: ElfPose, skin: ElfSkin = 'normal'): HTMLCanvasElement {
  const key = pose + skin;
  const hit = cache.get(key);
  if (hit) return hit;
  const grid = BASE.map((r) => r.split(''));
  for (const stamp of POSES[pose]) for (const [r, c, ch] of stamp) grid[r][c] = ch;
  const pal = PALETTES[skin];
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 16;
  const ctx = cv.getContext('2d')!;
  grid.forEach((row, y) =>
    row.forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = pal[ch] ?? '#f0f';
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  cache.set(key, cv);
  return cv;
}
