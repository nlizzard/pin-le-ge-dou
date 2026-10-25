import { describe, expect, it } from 'vitest';
import { migrateLocalStorage } from '../client/src/storageMigration';

function storage(values: Record<string, string>): Storage {
  const data = new Map(Object.entries(values));
  return {
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
    clear: () => data.clear(),
  };
}

describe('应用更名后的本地存档迁移', () => {
  it('迁移进度、口令、创作记录和中断存档，不影响其他应用', () => {
    const s = storage({
      'picture-play-save': 'progress', 'picture-play-access-key': 'secret',
      'picture-play-custom-records': 'records', 'picture-play-ckpt-custom-1': 'checkpoint',
      other: 'untouched',
    });
    migrateLocalStorage(s);
    expect(s.getItem('pin-le-ge-dou-save')).toBe('progress');
    expect(s.getItem('pin-le-ge-dou-access-key')).toBe('secret');
    expect(s.getItem('pin-le-ge-dou-custom-records')).toBe('records');
    expect(s.getItem('pin-le-ge-dou-ckpt-custom-1')).toBe('checkpoint');
    expect(s.getItem('other')).toBe('untouched');
    expect(s.getItem('picture-play-save')).toBeNull();
  });
  it('不覆盖新存档，重复迁移不会恢复已删除的旧数据', () => {
    const s = storage({ 'picture-play-save': 'old', 'pin-le-ge-dou-save': 'new' });
    migrateLocalStorage(s);
    expect(s.getItem('pin-le-ge-dou-save')).toBe('new');
    s.removeItem('pin-le-ge-dou-save');
    migrateLocalStorage(s);
    expect(s.getItem('pin-le-ge-dou-save')).toBeNull();
  });
  it('写入失败时保留旧存档供重试', () => {
    const s = storage({ 'picture-play-save': 'old' });
    s.setItem = () => { throw new Error('quota'); };
    expect(() => migrateLocalStorage(s)).toThrow('quota');
    expect(s.getItem('picture-play-save')).toBe('old');
  });
});
