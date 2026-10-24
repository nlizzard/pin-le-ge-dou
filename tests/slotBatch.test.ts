import { describe, expect, it } from 'vitest';
import { Game } from '../client/src/core/engine';
import type { LevelDef } from '../client/src/core/level';

function fixture() {
  const target = Int16Array.from([1, 2, 2, 3, 3, -1, 4, 4, 4, 0, 0, 0, 0, 0]);
  const beads = Int16Array.from([0, 0, 0, 0, 0, -1, 1, 2, 2, 4, 4, 4, 3, 3]);
  const def: LevelDef = { id: 1, key: 'batch-test', name: 'batch', w: 14, h: 1,
    target, beads, colors: ['#000000', '#111111', '#222222', '#333333', '#444444'],
    wrongCount: 13, capacity: 10, timeLimit: 100, difficulty: '普通', objectives: [],
    elements: { ice: [], star: [], fog: [], lock: null, bombs: [] } };
  const g = new Game(def); g.start(); return g;
}

function invariant(g: Game) {
  expect(g.slots.length).toBe(g.emptyCells().length);
  expect(g.slots.length).toBeLessThanOrEqual(g.capacity);
  for (const color of g.slots) expect(g.emptyByColor.get(color)?.size ?? 0).toBe(0);
  const expected = Array(g.def.colors.length).fill(0), actual = [...expected];
  for (const color of g.target) if (color >= 0) expected[color]++;
  for (const color of g.beads) if (color >= 0) actual[color]++;
  for (const color of g.slots) actual[color]++;
  expect(actual).toEqual(expected);
}

describe('adaptive slot batches', () => {
  it('moves several beads when a large group has no immediate refill, leaving a buffer', () => {
    const g = fixture(); g.capacity = 4;
    expect(g.batchAt(0)).toEqual([0, 1, 2]);
    expect(g.slots).toEqual([]);
    const r = g.tap(0);
    expect(r.type).toBe('moved');
    if (r.type !== 'moved') return;
    expect(r.moved).toBe(3);
    expect(g.freeSlots).toBe(1);
    expect(r.moves.filter(m => m.kind === 'cellToSlot').map(m => m.from)).toEqual([0, 1, 2]);
    invariant(g);
  });

  it('moves only the useful amount when one tray bead can refill, rather than filling spare slots', () => {
    const g = fixture(); g.tap(6); g.capacity = 5;
    expect(g.batchAt(0)).toEqual([0]);
    const r = g.tap(0);
    expect(r.type).toBe('moved');
    if (r.type !== 'moved') return;
    expect(r.moved).toBe(1);
    expect(r.placed).toBe(1);
    expect(g.isCorrect(0)).toBe(true);
    expect(g.slots).toEqual([0]);
    invariant(g);
  });

  it('prioritizes matching tray colours away from the clicked cell without exceeding their counts', () => {
    const g = fixture(); g.tap(6); g.tap(7); g.capacity = 6;
    const r = g.tap(4);
    expect(r.type).toBe('moved');
    if (r.type !== 'moved') return;
    expect(r.moved).toBe(3);
    expect(r.placed).toBe(2);
    const selected = r.moves.filter(m => m.kind === 'cellToSlot').map(m => m.from);
    expect(selected[0]).toBe(4);
    expect(selected).not.toContain(3); // target 3 has no tray bead to refill it
    expect(r.moves.filter(m => m.kind === 'slotToCell')).toHaveLength(2);
    invariant(g);
  });

  it('still permits a last-slot move, bursts only at zero free slots, and supports undo', () => {
    const g = fixture(); g.capacity = 1;
    expect(g.tap(0).type).toBe('moved');
    invariant(g);
    expect(g.tap(1).type).toBe('burst');
    const another = fixture(); another.capacity = 4;
    const before = [...another.beads];
    another.tap(0); another.undo();
    expect([...another.beads]).toEqual(before);
    expect(another.slots).toEqual([]);
    invariant(another);
  });

  it('keeps full groups when they fit and sends only the needed amount directly to the board', () => {
    const g = fixture(); g.capacity = 5;
    const r = g.tap(0);
    expect(r.type === 'moved' && r.moved).toBe(5);
    invariant(g);
    const direct = fixture(); direct.tap(6); direct.tap(9);
    const result = direct.tap(0);
    expect(result.type === 'moved' && result.moved).toBe(1);
    expect(result.type === 'moved' && result.moves[0].kind).toBe('cellToCell');
    invariant(direct);
  });
});
