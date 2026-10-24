export interface LevelProgress {
  best: Record<string, number>;
  firstCompletedAt: Record<string, number>;
}

/** 旧存档没有通关时间，以0标记；这些关卡保留编号顺序，排在新记录之前。 */
export function completionTimes(best: Record<string, number>, times: Record<string, number> = {}) {
  const result: Record<string, number> = {};
  for (const [id, stars] of Object.entries(best)) {
    if (stars > 0) result[id] = Number.isFinite(times[id]) && times[id] >= 0 ? times[id] : 0;
  }
  return result;
}

export function recordLevelWin(progress: LevelProgress, id: number, stars: number, now = Date.now()) {
  if (!(progress.best[id] > 0)) progress.firstCompletedAt[id] = now;
  else progress.firstCompletedAt[id] ??= 0;
  progress.best[id] = Math.max(progress.best[id] ?? 0, stars);
}

/** 已通关按首次通关时间排序；同时间和旧档按编号排序，未通关随后按编号排序。 */
export function orderedLevelIds(progress: LevelProgress, count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1).sort((a, b) => {
    const doneA = progress.best[a] > 0;
    const doneB = progress.best[b] > 0;
    if (doneA !== doneB) return doneA ? -1 : 1;
    return (doneA ? (progress.firstCompletedAt[a] ?? 0) - (progress.firstCompletedAt[b] ?? 0) : 0) || a - b;
  });
}
