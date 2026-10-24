import { describe, expect, it } from 'vitest';
import { PATTERNS, EXTRA_PATTERNS } from '../client/src/core/patterns';
import { LEVEL_COUNT } from '../client/src/core/level';
import previous from '../art/pinterest-recommendations/previous-catalog.json';
import additions from '../art/pinterest-recommendations/import-report.json';
import approvalData from '../art/pinterest-recommendations/curation.json';
import exclusions from '../art/pinterest-board/exclusions.json';

const approvals = approvalData as Record<string, { approved: boolean; flagFree?: boolean }>;

describe('1000-pattern catalogue', () => {
  it('contains exactly 1000 independently keyed patterns and one level per pattern', () => {
    expect(PATTERNS).toHaveLength(1000);
    expect(LEVEL_COUNT).toBe(1000);
    expect(new Set(PATTERNS.map((p) => p.key)).size).toBe(1000);
    expect(additions.newPatternCount).toBe(555);
    expect(PATTERNS.filter((p) => p.key.startsWith('pinterest-rec-'))).toHaveLength(555);
  });

  it('preserves every previous non-flag level number', () => {
    const banned = new Set(exclusions.map((x) => x.key));
    for (const old of previous) {
      if (banned.has(old.key)) {
        expect(PATTERNS[old.id - 1].key).toMatch(/^pinterest-rec-/);
      } else {
        expect(PATTERNS[old.id - 1].key, `level ${old.id}`).toBe(old.key);
      }
    }
  });

  it('excludes flags and requires a recorded flag review for every added source', () => {
    for (const banned of exclusions) {
      expect(PATTERNS.some((p) => p.key === banned.key)).toBe(false);
      expect(EXTRA_PATTERNS.some((p) => p.source?.url?.endsWith(`/pin/${banned.pinId}/`))).toBe(false);
    }
    const imported = additions.records.filter((r) => r.status === 'imported');
    expect(imported).toHaveLength(555);
    for (const r of imported) {
      expect(approvals[r.pinId]?.approved, r.pinId).toBe(true);
      expect(approvals[r.pinId]?.flagFree, r.pinId).toBe(true);
    }
    expect(new Set(additions.records.map((r) => r.pinId)).size).toBe(additions.sourcePinCount);
    expect(additions.records.some((r) => r.status === 'failed')).toBe(false);
  });
});
