import type { LevelDef, PatternGrid } from './core/level';
import { defaultCardOptions, type CardOptions, type ShareData } from './render/shareCard';

export const WALL_THEMES = [
  { id: 'cream', name: '奶油画廊', color: '#eee5d7' },
  { id: 'blush', name: '樱粉小屋', color: '#f2dfe5' },
  { id: 'sage', name: '鼠尾草绿', color: '#dce5da' },
  { id: 'night', name: '星夜展厅', color: '#30344b' },
] as const;
export interface WallSettings { title: string; theme: typeof WALL_THEMES[number]['id']; decor: 'flowers' | 'stars' | 'none' }
export interface Placement { x: number; y: number; size: number; rotation: number; z: number; onWall: boolean }
export interface WallWork {
  id: string;
  name: string;
  grid: PatternGrid;
  seconds: number;
  propsUsed: number;
  completedAt: number;
  options: CardOptions;
  placement: Placement;
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
export function normalizePlacement(p: Placement): Placement {
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1), size: clamp(p.size, 12, 32), rotation: clamp(p.rotation, -12, 12), z: clamp(p.z, 1, 1_000_000), onWall: p.onWall !== false };
}
/** 按旋转后的外接矩形留边，画框拖到四周也能完整显示。 */
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

/* ---------- 存储：本地 SQLite（服务端）为主，IndexedDB 离线兜底 ---------- */

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

/** Int16Array 不能直接 JSON，存 SQLite 前转普通数组 */
function serializeWork(w: WallWork) {
  return { ...w, grid: { ...w.grid, target: Array.from(w.grid.target) } };
}
function deserializeWork(raw: any): WallWork | null {
  if (!raw || !raw.grid || !Array.isArray(raw.grid.target) || !Array.isArray(raw.grid.colors)) return null;
  return { ...raw, grid: { w: raw.grid.w, h: raw.grid.h, colors: [...raw.grid.colors], target: Int16Array.from(raw.grid.target) }, placement: normalizePlacement(raw.placement), options: raw.options ?? defaultCardOptions() };
}

let wallCache: { works: WallWork[]; settings: WallSettings } | null = null;

/* IndexedDB：老版本浏览器的作品就在这里，继续作为离线副本 */
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
async function idbAll<T>(store: string): Promise<T[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    tx.oncomplete = () => resolve(request.result as T[]);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('无法读取离线作品'));
  });
}
async function idbPut(store: string, value: unknown, key?: string): Promise<void> {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      if (key === undefined) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('离线副本写入失败'));
    });
  } catch {
    /* 离线副本失败不影响主流程 */
  }
}

export async function loadWall(): Promise<{ works: WallWork[]; settings: WallSettings }> {
  if (wallCache) return { works: [...wallCache.works], settings: { ...wallCache.settings } };
  const remote = await api.get<{ works: unknown[]; settings: Partial<WallSettings> | null }>('/api/wall');
  const remoteWorks = (remote?.works ?? []).map(deserializeWork).filter((w): w is WallWork => !!w);
  // IndexedDB 里可能留着离线时的作品：按 id 合并，留完成时间更新的一份
  let idbWorks: WallWork[] = [];
  try {
    idbWorks = (await idbAll<any>('works')).map(deserializeWork).filter((w): w is WallWork => !!w);
  } catch {
    /* 读不到就只用 SQLite */
  }
  const byId = new Map<string, WallWork>();
  for (const w of remoteWorks) byId.set(w.id, w);
  const merged = [...idbWorks];
  for (const w of merged) {
    const r = byId.get(w.id);
    if (!r || r.completedAt < w.completedAt) byId.set(w.id, w);
  }
  const works = [...byId.values()].sort((a, b) => a.completedAt - b.completedAt).map(w => ({ ...w, placement: normalizePlacement(w.placement) }));
  // 把离线期间新增/更新的作品补写回 SQLite
  for (const w of works) {
    if (!remoteWorks.some(r => r.id === w.id && r.completedAt >= w.completedAt)) {
      void api.put('/api/wall/works', serializeWork(w));
      void idbPut('works', serializeWork(w));
    }
  }
  const settings = normalizeWallSettings(remote?.settings ?? {});
  wallCache = { works, settings };
  return { works: [...works], settings: { ...settings } };
}

export async function loadWallWork(id: string) {
  return (await loadWall()).works.find(w => w.id === id);
}

async function putWork(work: WallWork): Promise<void> {
  wallCache = { settings: wallCache?.settings ?? normalizeWallSettings({}), works: [...(wallCache?.works ?? []).filter(w => w.id !== work.id), work].sort((a, b) => a.completedAt - b.completedAt) };
  const ok = await api.put('/api/wall/works', serializeWork(work));
  void idbPut('works', serializeWork(work));
  if (!ok) throw new Error('暂时连不上存档服务，稍后会自动重试保存');
}

export async function saveWallSettings(settings: WallSettings): Promise<void> {
  const normalized = normalizeWallSettings(settings);
  if (wallCache) wallCache = { works: wallCache.works, settings: normalized };
  const ok = await api.put('/api/wall/settings', normalized);
  void idbPut('settings', normalized, 'wall');
  if (!ok) throw new Error('暂时连不上存档服务，稍后会自动重试保存');
}

export async function updateWallWork(id: string, patch: { options?: CardOptions; placement?: Placement }): Promise<WallWork> {
  const { works } = await loadWall();
  const old = works.find(w => w.id === id);
  if (!old) throw new Error('找不到这幅作品，请重新打开小画室');
  const work: WallWork = { ...old, ...patch };
  if (patch.placement) work.placement = normalizePlacement(patch.placement);
  await putWork(work);
  return work;
}

export async function rememberArtwork(data: ShareData, options?: CardOptions): Promise<WallWork> {
  const { works } = await loadWall();
  const old = works.find(w => w.id === data.level.key);
  const n = works.length;
  const work: WallWork = {
    id: data.level.key,
    name: data.level.name,
    grid: { w: data.level.w, h: data.level.h, colors: [...data.level.colors], target: Int16Array.from(data.level.target) },
    seconds: data.seconds,
    propsUsed: data.propsUsed,
    completedAt: Date.now(),
    options: options ?? old?.options ?? defaultCardOptions(),
    placement: old?.placement ?? { x: .08 + (n % 4) * .27, y: .12 + (Math.floor(n / 4) % 3) * .3, size: 19, rotation: n % 2 ? 3 : -3, z: n + 1, onWall: true },
  };
  await putWork(work);
  return work;
}
