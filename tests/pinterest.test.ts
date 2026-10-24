import { describe, expect, it } from 'vitest';
import { PATTERNS, EXTRA_PATTERNS } from '../client/src/core/patterns';
import { patternToGrid } from '../client/src/core/level';
import report from '../art/pinterest-board/import-report.json';

describe('Pinterest board import', () => {
  it('accounts for every accessible pin and links each imported level', () => {
    expect(report.records).toHaveLength(report.accessiblePinCount);
    expect(report.accessiblePinCount + report.unavailablePinCount).toBe(report.displayedPinCount);
    const imported = PATTERNS.filter((p) => p.key.startsWith('pinterest-'));
    expect(imported).toHaveLength(report.importedLevelCount);
    const keys = new Set(imported.map((p) => p.key));
    for (const record of report.records) {
      expect(record.items.length, record.pinId).toBeGreaterThan(0);
      for (const item of record.items) {
        expect(['converted', 'duplicate', 'duplicate-pattern', 'skipped']).toContain(item.status);
        if (item.status === 'converted') {
          expect('key' in item && keys.has(item.key!)).toBe(true);
        }
      }
    }
  });

  it('keeps playable sizes, native colours and traceable sources', () => {
    for (const p of EXTRA_PATTERNS.filter((p) => p.key.startsWith('pinterest-'))) {
      const g = patternToGrid(p);
      expect(Math.max(g.w, g.h), p.key).toBeLessThanOrEqual(128);
      expect(g.colors.length, p.key).toBeGreaterThanOrEqual(2);
      expect(p.source?.url).toMatch(/^https:\/\/jp\.pinterest\.com\/pin\/\d+\/$/);
      expect(p.source?.image).toMatch(/^https:\/\/i\.pinimg\.com\//);
      expect(p.source?.license).toBe('来源网页未标注授权');
    }
  });
});
