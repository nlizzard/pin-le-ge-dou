import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../client/src/core/engine';
import { GameScreen } from '../client/src/ui/game';
import { save } from '../client/src/save';
import { sfx } from '../client/src/audio';

vi.mock('../client/src/audio', () => ({ sfx: { pick: vi.fn(), drop: vi.fn() }, vibrate: vi.fn() }));

function fixture(full = true) {
  const game = new Game({ id: 1, key: 'tray-switch', name: 'tray-switch', w: 6, h: 3,
    target: Int16Array.from([1,1,1,2,2,2,0,0,0,3,3,3,4,4,4,5,5,5]),
    beads: Int16Array.from([0,0,0,1,1,1,2,2,2,3,3,3,5,5,5,4,4,4]),
    colors: ['#ff0000','#ffff00','#0000ff','#00ff00','#ff00ff','#00ffff'], wrongCount: 15,
    capacity: full ? 4 : 6, timeLimit: 100, difficulty: '普通', objectives: [],
    elements: { ice: [], star: [], fog: [], lock: null, bombs: [] } });
  game.lockedSlots = 1; game.start(); game.groupToTray([0,1,2]);
  const screen = Object.create(GameScreen.prototype) as any;
  Object.assign(screen, { game, paused: false, trayHidden: new Set(),
    sel: { kind: 'board', cells: [3,4,5], color: 1 },
    board: { setLifted: vi.fn() }, renderTray: vi.fn(), haptic: vi.fn(),
    showTip: vi.fn(), handleResult: vi.fn(), promptUnlock: vi.fn(async () => false),
  });
  return screen;
}

beforeEach(() => { vi.clearAllMocks(); save.data.settings.autoFill = false; });

describe('tray click intention', () => {
  it.each([true, false])('clicking an occupied slot switches selection (full=%s)', async full => {
    const screen = fixture(full);
    const before = [...screen.game.beads];
    await screen.onTapTray(0);
    expect(screen.promptUnlock).not.toHaveBeenCalled();
    expect(screen.handleResult).not.toHaveBeenCalled();
    expect(screen.sel).toEqual({ kind: 'tray', color: 0 });
    expect(screen.board.setLifted).toHaveBeenCalledWith([]);
    expect([...screen.game.beads]).toEqual(before);
    expect(screen.game.slots).toEqual([0,0,0]);
    expect(sfx.pick).toHaveBeenCalledOnce();
    await screen.onTapTray(0);
    expect(screen.sel).toBeNull();
    expect(sfx.drop).toHaveBeenCalledOnce();
  });

  it('switches to floating tray beads even with auto-fill and matching holes', async () => {
    const screen = fixture();
    screen.game.placeGroup([3,4,5]); screen.game.placeGroup([6,7,8]);
    screen.sel = { kind: 'board', cells: [12,13,14], color: 5 };
    save.data.settings.autoFill = true;
    expect(screen.game.holesFor(0)).toBe(3);
    await screen.onTapTray(0);
    expect(screen.sel).toEqual({ kind: 'tray', color: 0 });
    expect(screen.game.slots).toHaveLength(3);
    expect(screen.handleResult).not.toHaveBeenCalled();
  });

  it('still offers unlock on an explicit locked-slot or full-tray background click', async () => {
    const screen = fixture();
    await screen.onTapTray(3);
    expect(screen.promptUnlock).toHaveBeenCalledOnce();
    screen.promptUnlock.mockClear();
    await screen.onTapTray(-1);
    expect(screen.promptUnlock).toHaveBeenCalledWith('空槽满了');
    expect(screen.sel.kind).toBe('board');
  });

  it('still deposits the selected board group when an empty usable slot is clicked', async () => {
    const screen = fixture(false);
    await screen.onTapTray(3);
    expect(screen.promptUnlock).not.toHaveBeenCalled();
    expect(screen.handleResult).toHaveBeenCalled();
    expect(screen.sel).toBeNull();
    expect(screen.game.slots.length).toBeGreaterThan(3);
  });
});
