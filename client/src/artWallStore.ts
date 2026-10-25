import type { LevelDef, PatternGrid } from './core/level';
import { defaultCardOptions, type CardOptions, type ShareData } from './render/shareCard';

/* ---------- 小画室数据模型 ----------
 * 作品（WallWork）只是"这幅画"本身；每面墙（WallDef）持有自己的摆放实例（WallItem），
 * 所以同一幅作品可以出现在多面墙上、各自角度大小独立。贴纸（StickerInstance）属于单面墙。 */

export interface WallWork {
  id: string;
  name: string;
  grid: PatternGrid;
  seconds: number;
  propsUsed: number;
  completedAt: number;
  options: CardOptions;
}

/** 一面墙上的一件作品摆放 */
export interface WallItem { workId: string; x: number; y: number; size: number; rotation: number; z: number; onWall: boolean; frame?: boolean }
/** 一面墙上的一个贴纸 */
export interface StickerInstance { id: string; kind: string; x: number; y: number; scale: number; rotation: number; z: number }
/** 一面作品墙 */
export interface WallDef { id: string; name: string; wallpaper: string; items: WallItem[]; stickers: StickerInstance[]; createdAt: number }
/** 小画室文档：所有墙 + 当前激活 */
export interface StudioDoc { walls: WallDef[]; activeWallId: string }

/* ---------- 墙纸库 ---------- */
export const WALLPAPERS = [
  { id: 'cream-dots', name: '奶油波点' },
  { id: 'pink-stripes', name: '樱花条纹' },
  { id: 'gingham', name: '牛奶格纹' },
  { id: 'lavender', name: '薰衣草星语' },
  { id: 'mint', name: '薄荷苏打' },
  { id: 'starry', name: '星夜漫游' },
  { id: 'peach', name: '蜜桃云朵' },
  { id: 'plain', name: '素净奶白' },
] as const;
export type WallpaperId = typeof WALLPAPERS[number]['id'];

/* ---------- 贴纸库（静态 / 动态 / 胶带） ---------- */
export interface StickerKind { kind: string; name: string; group: 'static' | 'anim' | 'tape' }
export const STICKERS: StickerKind[] = [
  { kind: 'heart', name: '爱心', group: 'static' },
  { kind: 'blossom', name: '小花', group: 'static' },
  { kind: 'star', name: '星星', group: 'static' },
  { kind: 'butterfly', name: '蝴蝶', group: 'static' },
  { kind: 'rainbow', name: '彩虹', group: 'static' },
  { kind: 'cloud', name: '云朵', group: 'static' },
  { kind: 'bow', name: '蝴蝶结', group: 'static' },
  { kind: 'strawberry', name: '草莓', group: 'static' },
  { kind: 'tulip', name: '郁金香', group: 'static' },
  { kind: 'rabbit', name: '兔子', group: 'static' },
  { kind: 'cat', name: '猫咪', group: 'static' },
  { kind: 'balloon', name: '气球', group: 'static' },
  { kind: 'bear', name: '小熊', group: 'static' },
  { kind: 'moon', name: '月亮', group: 'static' },
  { kind: 'clover', name: '幸运草', group: 'static' },
  { kind: 'cake', name: '蛋糕', group: 'static' },
  { kind: 'sakura', name: '樱花', group: 'static' },
  { kind: 'bee', name: '蜜蜂', group: 'static' },
  { kind: 'lights', name: '走马灯', group: 'anim' },
  { kind: 'twinkle', name: '闪闪星', group: 'anim' },
  { kind: 'float-hearts', name: '漂浮爱心', group: 'anim' },
  { kind: 'petal-fall', name: '落樱', group: 'anim' },
  { kind: 'pulse-star', name: '脉冲星', group: 'anim' },
  { kind: 'shimmer', name: '流光彩带', group: 'anim' },
  { kind: 'tape-pink', name: '粉胶带', group: 'tape' },
  { kind: 'tape-mint', name: '薄荷胶带', group: 'tape' },
  { kind: 'tape-lav', name: '香芋胶带', group: 'tape' },
  { kind: 'tape-cream', name: '奶油胶带', group: 'tape' },
];
export const STICKER_EMOJI: Record<string, string> = {
  heart: '❤️', blossom: '🌸', star: '⭐', butterfly: '🦋', rainbow: '🌈', cloud: '☁️', bow: '🎀',
  strawberry: '🍓', tulip: '🌷', rabbit: '🐰', cat: '🐱', balloon: '🎈', bear: '🧸', moon: '🌙',
  clover: '🍀', cake: '🍰', sakura: '💮', bee: '🐝',
  twinkle: '✨', 'pulse-star': '🌟', 'float-hearts': '💖', 'petal-fall': '🌸', shimmer: '🌟',
};

/* ---------- 兼容旧接口（测试 / 旧墙迁移用） ---------- */
export const WALL_THEMES = [
  { id: 'cream', name: '奶油画廊', color: '#eee5d7' },
  { id: 'blush', name: '樱粉小屋', color: '#f2dfe5' },
  { id: 'sage', name: '鼠尾草绿', color: '#dce5da' },
  { id: 'night', name: '星夜展厅', color: '#30344b' },
] as const;
export interface WallSettings { title: string; theme: typeof WALL_THEMES[number]['id']; decor: 'flowers' | 'stars' | 'none' }
export interface Placement { x: number; y: number; size: number; rotation: number; z: number; onWall: boolean }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
export function normalizePlacement(p: Placement): Placement {
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), size: clamp(p.size, 12, 32), rotation: clamp(p.rotation, -180, 180), z: clamp(p.z, 1, 1_000_000), onWall: p.onWall !== false };
}
export function wallWorkBounds(boardWidth: number, boardHeight: number, placement: Placement, ratio: CardOptions['ratio']) {
  const width = boardWidth * placement.size / 100, height = width * (ratio === '9:16' ? 16 / 9 : 4 / 3);
  const angle = Math.abs(placement.rotation) * Math.PI / 180;
  const marginX = 16 + Math.max(0, (width * Math.cos(angle) + height * Math.sin(angle) - width) / 2);
  const marginY = 16 + Math.max(0, (height * Math.cos(angle) + width * Math.sin(angle) - height) / 2);
  return { width, height, marginX, marginY, rangeX: Math.max(1, boardWidth - width - marginX * 2), rangeY: Math.max(1, boardHeight - height - marginY * 2) };
}
export function normalizeWallSettings(s: Partial<WallSettings>): WallSettings {
  return { title: s.title?.trim().slice(0, 30) || '我的小画室', theme: WALL_THEMES.some(t => t.id === s.theme) ? s.theme! : 'cream', decor: ['flowers', 'stars', 'none'].includes(s.decor ?? '') ? s.decor! : 'flowers' };
}
export function workShareData(work: WallWork): ShareData {
  const level: LevelDef = { ...work.grid, id: 0, key: work.id, name: work.name, mode: 'custom', beads: Int16Array.from(work.grid.target), wrongCount: 0, capacity: 24, timeLimit: 0, objectives: [], difficulty: '轻松', elements: { ice: [], star: [], fog: [], lock: null, bombs: [] } };
  return { level, seconds: work.seconds, propsUsed: work.propsUsed };
}

/* ---------- 存储：作品走 /api/wall/works，墙文档走 /api/wall/doc，IndexedDB 离线兜底 ---------- */

const api = {
  async get<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url);
      return res.ok ? (await res.json() as T) : null;
    } catch {
      return null;
    }
  },
  async put(url: string, body: unknown): Promise<boolean> {
    try {
      return (await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).ok;
    } catch {
      return false;
    }
  },
};

function serializeWork(w: WallWork) {
  return { ...w, grid: { ...w.grid, target: Array.from(w.grid.target) } };
}
function deserializeWork(raw: any): WallWork | null {
  if (!raw || !raw.grid || !Array.isArray(raw.grid.target) || !Array.isArray(raw.grid.colors)) return null;
  return { ...raw, grid: { w: raw.grid.w, h: raw.grid.h, colors: [...raw.grid.colors], target: Int16Array.from(raw.grid.target) }, options: raw.options ?? defaultCardOptions() };
}

/* IndexedDB：离线副本 */
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('picture-play-gallery', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('works', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error('请关闭其他页面后重试')); };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
async function idbGet<T>(store: string, key?: string): Promise<T | undefined> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const os = tx.objectStore(store);
      const req = key === undefined ? os.getAll() : os.get(key);
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch {
    return undefined;
  }
}
async function idbPut(store: string, value: unknown, key?: string): Promise<void> {
  try {
    const db = await database();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite');
      if (key === undefined) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => resolve();
    });
  } catch {
    /* 离线副本失败不影响主流程 */
  }
}

/* ---------- 文档规范化与迁移 ---------- */

export function normalizeWall(raw: any): WallDef | null {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.items)) return null;
  return {
    id: raw.id,
    name: String(raw.name ?? '我的墙').slice(0, 20) || '我的墙',
    wallpaper: WALLPAPERS.some(w => w.id === raw.wallpaper) ? raw.wallpaper : 'cream-dots',
    items: raw.items.filter((i: any) => i && typeof i.workId === 'string').map((i: any) => ({
      workId: i.workId, x: Number(i.x) || 0, y: Number(i.y) || 0,
      size: clamp(i.size, 90, 900), rotation: clamp(i.rotation, -180, 180), z: clamp(i.z, 1, 1e6),
      onWall: i.onWall !== false,
      frame: i.frame !== false,
    })),
    stickers: (Array.isArray(raw.stickers) ? raw.stickers : []).filter((s: any) => s && typeof s.kind === 'string').map((s: any) => ({
      id: String(s.id ?? Math.random().toString(36).slice(2)), kind: s.kind,
      x: Number(s.x) || 0, y: Number(s.y) || 0,
      scale: clamp(s.scale, 0.4, 6), rotation: clamp(s.rotation, -180, 180), z: clamp(s.z, 1, 1e6),
    })),
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

export function emptyWall(name: string): WallDef {
  return { id: 'wall-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 20) || '新的作品墙', wallpaper: 'cream-dots', items: [], stickers: [], createdAt: Date.now() };
}

/** 旧版单墙（作品内嵌 placement + 单一 settings）迁移成多墙文档 */
function migrate(works: WallWork[], settings: Partial<WallSettings> | null | undefined): StudioDoc {
  const wall = emptyWall(settings?.title?.trim() || '我的小小美术馆');
  const themeMap: Record<string, string> = { cream: 'cream-dots', blush: 'pink-stripes', sage: 'mint', night: 'starry' };
  wall.wallpaper = themeMap[settings?.theme ?? 'cream'] ?? 'cream-dots';
  works.forEach((w, i) => {
    const p = (w as any).placement as Placement | undefined;
    wall.items.push(p
      ? { workId: w.id, x: 80 + (p.x ?? 0.08) * 1400, y: 70 + (p.y ?? 0.12) * 800, size: Math.round(140 + (p.size ?? 19) * 14), rotation: p.rotation ?? 0, z: (p.z ?? i + 1) * 100, onWall: p.onWall !== false }
      : { workId: w.id, x: 120 + (i % 4) * 330, y: 110 + Math.floor(i / 4) * 300, size: 260, rotation: (i % 2 ? 3 : -3), z: (i + 1) * 100, onWall: true });
  });
  return { walls: [wall], activeWallId: wall.id };
}

/* ---------- 对外 API ---------- */

let docCache: StudioDoc | null = null;
let worksCache: WallWork[] | null = null;

export async function loadStudio(): Promise<{ works: WallWork[]; doc: StudioDoc }> {
  if (docCache && worksCache) return { works: [...worksCache], doc: docCache };
  const remote = await api.get<{ works: unknown[]; doc: StudioDoc | null; settings: Partial<WallSettings> | null }>('/api/wall');
  let works = (remote?.works ?? []).map(deserializeWork).filter((w): w is WallWork => !!w).sort((a, b) => a.completedAt - b.completedAt);
  const tombstones = new Set((await idbGet<string[]>('settings', 'tombstones')) ?? []);
  works = works.filter(w => !tombstones.has(w.id));
  // IndexedDB 里可能有离线期间的更新，按 id 合并取较新（墓碑里的不复活）
  try {
    const idbWorks = ((await idbGet<any[]>('works') ?? []) as any[]).map(deserializeWork).filter((w): w is WallWork => !!w);
    const byId = new Map(works.map(w => [w.id, w]));
    for (const w of idbWorks) {
      if (tombstones.has(w.id)) continue;
      const r = byId.get(w.id);
      if (!r || r.completedAt < w.completedAt) byId.set(w.id, w);
    }
    works = [...byId.values()].sort((a, b) => a.completedAt - b.completedAt);
    for (const w of works) if (!remote?.works?.length || !(remote.works as any[]).some((r) => r && r.id === w.id)) void api.put('/api/wall/works', serializeWork(w));
  } catch {
    /* 无 IndexedDB 就只用服务端 */
  }
  let doc: StudioDoc | null = null;
  if (remote?.doc && Array.isArray(remote.doc.walls)) {
    const walls = remote.doc.walls.map(normalizeWall).filter((w: WallDef | null): w is WallDef => !!w);
    if (walls.length) doc = { walls, activeWallId: walls.some(w => w.id === remote!.doc!.activeWallId) ? remote.doc.activeWallId : walls[0].id };
  }
  if (!doc) {
    doc = migrate(works, remote?.settings); // 旧数据 → 第一面墙
    void saveStudioDoc(doc);
  }
  void idbPut('settings', doc, 'walls-doc');
  docCache = doc;
  worksCache = works;
  return { works: [...works], doc };
}

export async function saveStudioDoc(doc: StudioDoc): Promise<void> {
  docCache = doc;
  void idbPut('settings', doc, 'walls-doc');
  const ok = await api.put('/api/wall/doc', doc);
  if (!ok) throw new Error('暂时连不上存档服务，稍后会自动重试保存');
}

export function studioCached(): StudioDoc | null {
  return docCache;
}

async function putWork(work: WallWork): Promise<void> {
  if (worksCache) worksCache = [...worksCache.filter(w => w.id !== work.id), work].sort((a, b) => a.completedAt - b.completedAt);
  const ok = await api.put('/api/wall/works', serializeWork(work));
  void idbPut('works', serializeWork(work));
  if (!ok) throw new Error('暂时连不上存档服务，稍后会自动重试保存');
}

export async function rememberArtwork(data: ShareData, options?: CardOptions): Promise<WallWork> {
  await loadStudio();
  const old = worksCache!.find(w => w.id === data.level.key);
  const work: WallWork = {
    id: data.level.key,
    name: data.level.name,
    grid: { w: data.level.w, h: data.level.h, colors: [...data.level.colors], target: Int16Array.from(data.level.target) },
    seconds: data.seconds,
    propsUsed: data.propsUsed,
    completedAt: Date.now(),
    options: options ?? old?.options ?? defaultCardOptions(),
  };
  await putWork(work);
  return work;
}

export async function updateWorkOptions(id: string, options: CardOptions): Promise<WallWork> {
  await loadStudio();
  const old = worksCache!.find(w => w.id === id);
  if (!old) throw new Error('找不到这幅作品');
  const work = { ...old, options };
  await putWork(work);
  return work;
}

/** 删除作品：还挂在任何墙上时返回占用它的墙名（收进抽屉的不算，由界面提示先收起）；删除时清理抽屉里的悬空引用 */
export async function deleteWork(id: string, doc: StudioDoc): Promise<{ ok: true } | { ok: false; walls: string[] }> {
  await loadStudio();
  const walls = doc.walls.filter(w => w.items.some(i => i.workId === id && i.onWall)).map(w => w.name);
  if (walls.length) return { ok: false, walls };
  worksCache = worksCache!.filter(w => w.id !== id);
  for (const w of doc.walls) w.items = w.items.filter(i => i.workId !== id);
  void saveStudioDoc(doc).catch(() => { /* 下次打开会重试 */ });
  // 本地墓碑：避免离线副本在下次合并时把已删作品复活
  const tomb = ((await idbGet<string[]>('settings', 'tombstones')) ?? []);
  if (!tomb.includes(id)) tomb.push(id);
  void idbPut('settings', tomb, 'tombstones');
  try {
    await fetch(`/api/wall/works/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    /* 离线：墓碑已记，恢复联网后以服务端为准 */
  }
  return { ok: true };
}

/* ---------- 回收站（误删作品 30 天内可恢复） ---------- */

export interface RecycleEntry { id: string; name: string; deletedAt: number }

export async function listRecycle(): Promise<RecycleEntry[]> {
  try {
    const res = await fetch('/api/wall/recycle');
    if (!res.ok) return [];
    const list = (await res.json()) as RecycleEntry[];
    return Array.isArray(list) ? list.map(x => ({ id: String(x.id), name: String(x.name ?? x.id), deletedAt: Number(x.deletedAt) || 0 })) : [];
  } catch {
    return [];
  }
}

/** 从回收站恢复：作品回到「我的创作」抽屉（不自动上墙） */
export async function restoreWork(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/wall/recycle/${encodeURIComponent(id)}/restore`, { method: 'POST' });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  // 清掉本地墓碑并失效缓存，下次打开即回到抽屉
  try {
    const tomb = (await idbGet<string[]>('settings', 'tombstones')) ?? [];
    const next = tomb.filter(t => t !== id);
    if (next.length !== tomb.length) void idbPut('settings', next, 'tombstones');
  } catch {
    /* ignore */
  }
  docCache = null;
  worksCache = null;
  return true;
}

export async function loadWallWork(id: string) {
  return (await loadStudio()).works.find(w => w.id === id);
}
