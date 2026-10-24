/**
 * 存档：localStorage 一份 + 服务端一份（多设备共享进度）。
 * 服务端不可达时照常游玩，下次能连上时自动同步。
 */
import { completionTimes } from './levelProgress';
export interface Settings {
  sound: boolean;
  vibrate: boolean;
  needBar: boolean;
  colorBlind: boolean;
}

export interface SaveData {
  version: number; // 每次写入 +1，服务端用来拒绝旧版本覆盖
  updatedAt: number;
  unlocked: number; // 旧版进度兼容字段，不再限制关卡访问
  best: Record<string, number>; // 关卡号 → 最高星级（0.5 / 1 / 2 / 3）
  firstCompletedAt: Record<string, number>; // 首次通关时间；0表示旧档未记录时间
  inventory: Record<string, number>;
  settings: Settings;
  seenTutorial: boolean;
  /** 新玩家赠送的道具是否已发放 */
  giftGiven: boolean;
  /** 曾经获得过的隐藏道具（图鉴） */
  collected: string[];
  /** 三星抽奖：连续未出隐藏道具的次数（保底用） */
  lotteryPity: number;
  /** 啵啵的皮肤：集齐隐藏道具解锁 gold */
  elfSkin: 'normal' | 'gold';
  /** 见过哪些特殊格子的说明 */
  seenElements: string[];
}

const KEY = 'picture-play-save';
const KEY_ACCESS = 'picture-play-access-key';

export function defaultSave(): SaveData {
  return {
    version: 0,
    updatedAt: 0,
    unlocked: 1,
    best: {},
    firstCompletedAt: {},
    inventory: {},
    settings: { sound: true, vibrate: true, needBar: true, colorBlind: false },
    seenTutorial: false,
    giftGiven: false,
    collected: [],
    lotteryPity: 0,
    elfSkin: 'normal',
    seenElements: [],
  };
}

/** 增减道具库存 */
export function addProp(id: string, n = 1) {
  save.update((d) => {
    d.inventory[id] = Math.max(0, (d.inventory[id] ?? 0) + n);
  });
}

export function propCount(id: string) {
  return save.data.inventory[id] ?? 0;
}

function normalize(d: Partial<SaveData> | null | undefined): SaveData {
  const base = defaultSave();
  if (!d) return base;
  return {
    ...base,
    ...d,
    settings: { ...base.settings, ...(d.settings ?? {}) },
    best: { ...(d.best ?? {}) },
    firstCompletedAt: completionTimes(d.best ?? {}, d.firstCompletedAt),
    inventory: { ...(d.inventory ?? {}) },
    collected: [...(d.collected ?? [])],
    seenElements: [...(d.seenElements ?? [])],
  };
}

/** 两份存档合并：星级与解锁取最大，其余取较新的一份 */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const best: Record<string, number> = { ...a.best };
  for (const [k, v] of Object.entries(b.best)) best[k] = Math.max(best[k] ?? 0, v);
  const firstCompletedAt = completionTimes(a.best, a.firstCompletedAt);
  for (const [id, time] of Object.entries(completionTimes(b.best, b.firstCompletedAt))) {
    firstCompletedAt[id] = Math.min(firstCompletedAt[id] ?? Infinity, time);
  }
  return {
    ...newer,
    version: Math.max(a.version, b.version),
    unlocked: Math.max(a.unlocked, b.unlocked),
    best,
    firstCompletedAt,
    seenTutorial: a.seenTutorial || b.seenTutorial,
    giftGiven: a.giftGiven || b.giftGiven,
    collected: [...new Set([...a.collected, ...b.collected])],
    seenElements: [...new Set([...a.seenElements, ...b.seenElements])],
  };
}

function readLocal(): SaveData {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return defaultSave();
  }
}

function writeLocal(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* 隐私模式等情况下忽略 */
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  try {
    const k = localStorage.getItem(KEY_ACCESS);
    if (k) h['x-access-key'] = k;
  } catch {
    /* ignore */
  }
  return h;
}

class SaveStore {
  data: SaveData = readLocal();
  private timer: number | undefined;
  private listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** 启动时与服务端同步 */
  async init() {
    const remote = await this.fetchRemote();
    if (remote) {
      this.data = mergeSaves(this.data, remote);
      writeLocal(this.data);
      if (this.data.updatedAt > remote.updatedAt || this.data.version !== remote.version) this.push();
    }
  }

  private async fetchRemote(): Promise<SaveData | null> {
    try {
      let res = await fetch('/api/save', { headers: headers() });
      if (res.status === 401) {
        const key = prompt('服务器设置了访问口令，请输入：');
        if (!key) return null;
        localStorage.setItem(KEY_ACCESS, key);
        res = await fetch('/api/save', { headers: headers() });
      }
      if (!res.ok) return null;
      const body = await res.json();
      return body ? normalize(body) : null;
    } catch {
      return null;
    }
  }

  update(fn: (d: SaveData) => void) {
    fn(this.data);
    this.data.updatedAt = Date.now();
    writeLocal(this.data);
    this.listeners.forEach((l) => l());
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.push(), 800);
  }

  private async push() {
    const body = { ...this.data, version: this.data.version + 1 };
    try {
      const res = await fetch('/api/save', { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
      if (res.ok) {
        this.data.version = body.version;
        writeLocal(this.data);
      } else if (res.status === 409) {
        // 另一台设备写过更新的存档：合并后再推
        const remote = normalize(await res.json());
        this.data = mergeSaves(this.data, remote);
        this.data.version = remote.version;
        writeLocal(this.data);
        this.push();
      }
    } catch {
      /* 离线：下次再同步 */
    }
  }
}

export const save = new SaveStore();
