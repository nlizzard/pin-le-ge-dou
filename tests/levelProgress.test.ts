import { describe, expect, it } from 'vitest';
import { completionTimes, orderedLevelIds, recordLevelWin } from '../client/src/levelProgress';
import { defaultSave, mergeSaves } from '../client/src/save';

describe('open level catalogue and completion order', () => {
  it('includes every unplayed level in numerical order regardless of old unlock progress', () => {
    const d = defaultSave();
    expect(d.unlocked).toBe(1);
    expect(orderedLevelIds(d, 1018)).toEqual(Array.from({ length: 1018 }, (_, i) => i + 1));
  });

  it('places out-of-order wins first by first completion, then all unplayed levels', () => {
    const d = defaultSave();
    recordLevelWin(d, 5, 0.5, 100);
    recordLevelWin(d, 2, 3, 200);
    expect(orderedLevelIds(d, 6)).toEqual([5, 2, 1, 3, 4, 6]);
    recordLevelWin(d, 5, 3, 300);
    expect(d.best[5]).toBe(3);
    expect(d.firstCompletedAt[5]).toBe(100);
    expect(orderedLevelIds(d, 6)).toEqual([5, 2, 1, 3, 4, 6]);
  });

  it('keeps legacy wins before new wins and never invents their historical times', () => {
    const d = defaultSave();
    d.best = { 4: 2, 2: 0.5, 1: 0 };
    d.firstCompletedAt = completionTimes(d.best);
    recordLevelWin(d, 4, 3, 500);
    recordLevelWin(d, 3, 1, 600);
    expect(orderedLevelIds(d, 5)).toEqual([2, 4, 3, 1, 5]);
    expect(d.firstCompletedAt).toEqual({ 2: 0, 4: 0, 3: 600 });
  });

  it('merges the earliest first win and highest stars from both devices', () => {
    const a = defaultSave(), b = defaultSave();
    recordLevelWin(a, 7, 1, 100);
    recordLevelWin(b, 7, 3, 200);
    recordLevelWin(b, 2, 0.5, 150);
    b.updatedAt = 300;
    const merged = mergeSaves(a, b);
    expect(merged.best).toEqual({ 7: 3, 2: 0.5 });
    expect(merged.firstCompletedAt).toEqual({ 7: 100, 2: 150 });
    expect(orderedLevelIds(merged, 7)).toEqual([7, 2, 1, 3, 4, 5, 6]);
    expect(mergeSaves(b, a).firstCompletedAt).toEqual(merged.firstCompletedAt);
  });

  it('accepts old saves with no completion-time field during sync', () => {
    const legacy = defaultSave();
    legacy.best = { 3: 2 };
    delete (legacy as Partial<typeof legacy>).firstCompletedAt;
    const fresh = defaultSave();
    recordLevelWin(fresh, 3, 3, 100);
    expect(mergeSaves(legacy, fresh).firstCompletedAt[3]).toBe(0);
  });
});
