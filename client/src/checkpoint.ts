import './storageMigration';
/**
 * 关卡中断存档：主存是本地 SQLite（服务端 /api/checkpoint/:id），localStorage 兜底。
 * 读取时本地与服务端都查，取保存时间较新的一份。
 */
export interface LevelCheckpoint {
  levelId: string;
  savedAt: number;
  /** 已归位比例 0–1 */
  progress: number;
  /** 剩余倒计时（秒）；自定义模式为 0 */
  remaining: number;
  game: Record<string, unknown>;
  /** 自定义作品的关卡快照与展示名（继续拼的独立入口用） */
  name?: string;
  def?: { key: string; name: string; w: number; h: number; colors: string[]; target: number[]; beads: number[] };
  screen: { elfDrops: number; wished: string[] };
}

const key = (id: string) => `pin-le-ge-dou-ckpt-${id}`;

function parse(raw: unknown, id: string): LevelCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const cp = raw as LevelCheckpoint;
  return cp.levelId === id && cp.game && typeof cp.savedAt === 'number' ? cp : null;
}

function readLocal(id: string): LevelCheckpoint | null {
  try {
    return parse(JSON.parse(localStorage.getItem(key(id)) || 'null'), id);
  } catch {
    return null;
  }
}

function writeLocal(cp: LevelCheckpoint) {
  try {
    localStorage.setItem(key(cp.levelId), JSON.stringify(cp));
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

function removeLocal(id: string) {
  try {
    localStorage.removeItem(key(id));
  } catch {
    /* ignore */
  }
}

export async function loadCheckpoint(id: string): Promise<LevelCheckpoint | null> {
  const local = readLocal(id);
  let remote: LevelCheckpoint | null = null;
  try {
    const res = await fetch(`/api/checkpoint/${id}`);
    if (res.ok) {
      const body = await res.json();
      if (body && body.data) remote = parse(body.data, id);
    }
  } catch {
    /* 离线 */
  }
  if (local && remote) return local.savedAt >= remote.savedAt ? local : remote;
  return local ?? remote;
}

export function saveCheckpoint(cp: LevelCheckpoint): void {
  writeLocal(cp);
  summaryCache.set(cp.levelId, { levelId: cp.levelId, savedAt: cp.savedAt, progress: cp.progress, name: cp.name });
  void fetch(`/api/checkpoint/${cp.levelId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cp) }).catch(() => {
    /* 离线：本地副本已更新 */
  });
}

export function clearCheckpoint(id: string): void {
  removeLocal(id);
  summaryCache.delete(id);
  void fetch(`/api/checkpoint/${id}`, { method: 'DELETE' }).catch(() => {
    /* ignore */
  });
}

/* ---------- 摘要（地图页排序/标记用，不加载棋盘数据） ---------- */

export interface CkptSummary { levelId: string; savedAt: number; progress: number; name?: string }

const PREFIX = 'pin-le-ge-dou-ckpt-';
const summaryCache = new Map<string, CkptSummary>();
let lastSnapshot = '';
let scannedLocal = false;

function scanLocal() {
  if (scannedLocal) return;
  scannedLocal = true;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const cp = parse(JSON.parse(localStorage.getItem(k) || 'null'), k.slice(PREFIX.length));
      if (cp) summaryCache.set(cp.levelId, { levelId: cp.levelId, savedAt: cp.savedAt, progress: cp.progress, name: cp.name });
    } catch {
      /* ignore */
    }
  }
}

/** 当前的存档摘要（同步，可能尚未联网刷新） */
export function checkpointSummaries(): Map<string, CkptSummary> {
  scanLocal();
  return summaryCache;
}

/** 联网刷新摘要；与上次快照相比有变化时返回 true（用于触发地图重排） */
export async function refreshCheckpointSummaries(): Promise<boolean> {
  scanLocal();
  try {
    const res = await fetch('/api/checkpoints');
    if (res.ok) {
      const list = (await res.json()) as CkptSummary[];
      for (const s of Array.isArray(list) ? list : []) {
        const old = summaryCache.get(s.levelId);
        if (!old || old.savedAt < s.savedAt) summaryCache.set(s.levelId, s);
      }
    }
  } catch {
    /* 离线：本地缓存已够用 */
  }
  const snapshot = [...summaryCache.values()].map((s) => `${s.levelId}:${s.savedAt}`).sort().join(',');
  const changed = snapshot !== lastSnapshot;
  lastSnapshot = snapshot;
  return changed;
}
