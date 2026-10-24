/**
 * 自由创作的最近用时记录：主存是本地 SQLite（服务端 /api/custom-records），
 * localStorage 只作展示缓存与离线兜底，恢复联网后以下一次写入为准。
 */
export interface CustomRecord { key: string; name: string; seconds: number; propsUsed: number; completedAt: number }
const KEY = 'picture-play-custom-records';
const LIMIT = 30;
let cache: CustomRecord[] | null = null;

function parse(rows: unknown): CustomRecord[] {
  return Array.isArray(rows)
    ? rows.filter(r => r && typeof r.key === 'string' && typeof r.name === 'string' && Number.isFinite(r.seconds) && r.seconds >= 0 && Number.isFinite(r.propsUsed) && Number.isFinite(r.completedAt)).slice(0, LIMIT)
    : [];
}

function readLocal(): CustomRecord[] {
  try {
    return parse(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return [];
  }
}

function writeLocal(rows: CustomRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 启动时从 SQLite 拉一份刷新本地缓存；失败静默，用本地缓存 */
export async function initCustomRecords(): Promise<void> {
  try {
    const res = await fetch('/api/custom-records');
    if (!res.ok) return;
    const rows = parse(await res.json());
    cache = rows;
    writeLocal(rows);
  } catch {
    /* 离线 */
  }
}

export function customRecords(): CustomRecord[] {
  if (!cache) cache = readLocal();
  return cache;
}

export function recordCustom(record: CustomRecord): boolean {
  const rows = [record, ...customRecords().filter(r => !(r.key === record.key && r.completedAt === record.completedAt))].slice(0, LIMIT);
  cache = rows;
  writeLocal(rows);
  void fetch('/api/custom-records', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record) })
    .then(res => (res.ok ? res.json() : null))
    .then(rows => { if (Array.isArray(rows)) { cache = parse(rows); writeLocal(cache); } })
    .catch(() => { /* 离线：本地缓存已更新 */ });
  return true;
}
