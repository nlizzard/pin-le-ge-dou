/** 道具定义：7 种常驻 + 7 种隐藏 */
export type PropId =
  | 'magnet'
  | 'broom'
  | 'hourglass'
  | 'expand'
  | 'tweezers'
  | 'magnifier'
  | 'undo'
  | 'meteor'
  | 'rainbowBomb'
  | 'amber'
  | 'brush'
  | 'helper'
  | 'phoenix'
  | 'clover';

export type Rarity = 'common' | 'rare' | 'epic';

export interface PropDef {
  id: PropId;
  name: string;
  icon: string;
  desc: string;
  hidden: boolean;
  rarity: Rarity;
  /** 每局最多使用次数 */
  perGame: number;
  /** 未获得时图鉴里的谜语（隐藏道具） */
  riddle?: string;
  /** 精灵掉落的权重（常驻道具） */
  weight?: number;
}

export const PROPS: PropDef[] = [
  { id: 'magnet', name: '磁铁', icon: '🧲', desc: '选一种颜色，这种颜色的错位豆子一次归位（最多 20 颗）', hidden: false, rarity: 'common', perGame: 2, weight: 8 },
  { id: 'broom', name: '扫把', icon: '🧹', desc: '清空空槽，所有没归位的豆子重新洗牌，保底至少 20% 恰好落对', hidden: false, rarity: 'common', perGame: 2, weight: 8 },
  { id: 'hourglass', name: '沙漏', icon: '⏳', desc: '倒计时 +30 秒（超时后不能用）', hidden: false, rarity: 'common', perGame: 3, weight: 20 },
  { id: 'expand', name: '扩槽箱', icon: '📦', desc: '本局空槽 +4', hidden: false, rarity: 'common', perGame: 3, weight: 15 },
  { id: 'tweezers', name: '镊子', icon: '🥢', desc: '接下来点 3 个格子，点哪格哪格归位', hidden: false, rarity: 'common', perGame: 3, weight: 15 },
  { id: 'magnifier', name: '放大镜', icon: '🔍', desc: '10 秒内高亮所有现在点了就能直接归位的豆子', hidden: false, rarity: 'common', perGame: 3, weight: 20 },
  { id: 'undo', name: '时光回溯', icon: '↩️', desc: '撤回最近 3 次点击（时间不回退）', hidden: false, rarity: 'common', perGame: 2, weight: 14 },
  { id: 'meteor', name: '流星雨', icon: '🌠', desc: '12 颗流星划过画布，每颗砸中一个错位格让它归位', hidden: true, rarity: 'rare', perGame: 1, riddle: '抬头许个愿，星星替你干活' },
  { id: 'rainbowBomb', name: '彩虹炸弹', icon: '🌈', desc: '点选一个位置，5×5 范围内全部归位', hidden: true, rarity: 'rare', perGame: 1, riddle: '砰的一声，世界变得整整齐齐' },
  { id: 'amber', name: '时光琥珀', icon: '🧊', desc: '计时冻结 20 秒，期间开新链不计入星级目标', hidden: true, rarity: 'rare', perGame: 1, riddle: '把这一刻封存起来' },
  { id: 'brush', name: '魔法画笔', icon: '🖌️', desc: '15 秒内手指/鼠标划过的格子自动归位，最多 30 格', hidden: true, rarity: 'epic', perGame: 1, riddle: '一笔划过，万物归位' },
  { id: 'helper', name: '精灵帮帮忙', icon: '🧚', desc: '啵啵跳进画布帮你干活，20 秒内每 0.5 秒修正 1 格', hidden: true, rarity: 'epic', perGame: 1, riddle: '有个小家伙想搭把手' },
  { id: 'phoenix', name: '凤凰羽毛', icon: '🪶', desc: '被动：爆槽时可一键复活，清空空槽并 +30 秒（不占续命次数）', hidden: true, rarity: 'epic', perGame: 1, riddle: '跌倒了，从灰烬里再飞起来' },
  { id: 'clover', name: '幸运四叶草', icon: '🍀', desc: '本局激活：若三星通关，抽奖次数 +1 且隐藏道具概率翻倍', hidden: true, rarity: 'epic', perGame: 1, riddle: '四片叶子，一份好运' },
];

export const PROP_MAP = Object.fromEntries(PROPS.map((p) => [p.id, p])) as Record<PropId, PropDef>;
export const COMMON_PROPS = PROPS.filter((p) => !p.hidden);
export const HIDDEN_PROPS = PROPS.filter((p) => p.hidden);

/** 按权重抽一个常驻道具 */
export function rollCommon(rand: () => number): PropId {
  const total = COMMON_PROPS.reduce((a, p) => a + (p.weight ?? 1), 0);
  let r = rand() * total;
  for (const p of COMMON_PROPS) {
    r -= p.weight ?? 1;
    if (r <= 0) return p.id;
  }
  return COMMON_PROPS[0].id;
}

export function rollHidden(rand: () => number, rarity: 'rare' | 'epic', prefer: Set<PropId> = new Set()): PropId {
  const pool = HIDDEN_PROPS.filter((p) => p.rarity === rarity);
  // 优先给还没拥有过的，方便集齐图鉴
  const fresh = pool.filter((p) => !prefer.has(p.id));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rand() * from.length)].id;
}

/** 精灵连点：第 k 次连点（1 起）的掉落概率 */
export const ELF_DROP_CHANCE = [0, 0.15, 0.25, 0.4, 1];
export const ELF_DROPS_PER_GAME = 3;
export const WISHES_PER_GAME = 3;
