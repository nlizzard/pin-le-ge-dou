import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class Param {
  value = 0;
  setValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime() {}
}
class Node {
  gain = new Param();
  frequency = new Param();
  buffer: unknown;
  onended?: () => void;
  connect(node: unknown) { return node; }
  disconnect() {}
  addEventListener() {}
  start = vi.fn();
  stop = vi.fn();
}
let contexts: Context[];
let suspended: boolean;
class Context {
  state = suspended ? 'suspended' : 'running';
  currentTime = 10;
  destination = {};
  sources: Node[] = [];
  listeners = new Map<string, () => void>();
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
  resume = vi.fn(async () => { this.state = 'running'; });
  decodeAudioData = vi.fn(async () => ({ duration: .1 }));
  constructor() { contexts.push(this); }
  createGain() { return new Node(); }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  createOscillator() { return this.createBufferSource(); }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules(); contexts = []; suspended = false;
  vi.stubGlobal('window', { AudioContext: Context, addEventListener: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
});
afterEach(() => vi.unstubAllGlobals());

describe('reference sound playback', () => {
  it('plays every rapid tap with a fresh source and reuses decoded audio', async () => {
    const { sfx } = await import('../client/src/audio');
    for (let i = 0; i < 20; i++) sfx.pick();
    await settle();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(contexts[0].sources).toHaveLength(20);
    for (const source of contexts[0].sources) expect(source.start).toHaveBeenCalledOnce();
  });

  it('retains the first tap until resume resolves, then uses the current audio clock', async () => {
    suspended = true;
    const { sfx, primeAudio } = await import('../client/src/audio');
    primeAudio();
    await settle();
    const ctx = contexts[0]; ctx.state = 'suspended';
    let resume!: () => void;
    ctx.resume.mockImplementation(() => new Promise<void>(resolve => { resume = () => { ctx.state = 'running'; resolve(); }; }));
    sfx.pick(); sfx.pick();
    await settle();
    expect(ctx.sources).toHaveLength(0);
    ctx.currentTime = 42; resume(); await settle();
    expect(ctx.sources).toHaveLength(2);
    for (const source of ctx.sources) expect(source.start).toHaveBeenCalledWith(42);
  });

  it('cancels pending sounds and stops active sounds when muted', async () => {
    const { sfx, setSoundEnabled } = await import('../client/src/audio');
    sfx.pick(); setSoundEnabled(false); setSoundEnabled(true);
    await settle();
    expect(contexts[0].sources).toHaveLength(0);
    sfx.win(); await settle();
    const source = contexts[0].sources[0];
    setSoundEnabled(false); sfx.pick();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(contexts[0].sources).toHaveLength(1);
  });

  it('allows a later gesture to recover from a rejected resume', async () => {
    const { sfx, primeAudio } = await import('../client/src/audio');
    primeAudio(); await settle();
    const ctx = contexts[0]; ctx.state = 'suspended';
    ctx.resume.mockRejectedValueOnce(new Error('interrupted'));
    sfx.pick(); await settle();
    expect(ctx.sources).toHaveLength(0);
    sfx.pick(); await settle();
    expect(ctx.sources).toHaveLength(1);
  });

  it('retries resume on touch release even when a previous resume is still pending', async () => {
    const { sfx, primeAudio } = await import('../client/src/audio');
    primeAudio(); await settle();
    const ctx = contexts[0]; ctx.state = 'suspended';
    let released = false;
    ctx.resume.mockImplementation(() => {
      if (!released) return new Promise<void>(() => {});
      ctx.state = 'running';
      return Promise.resolve();
    });
    primeAudio(); sfx.pick(); await settle();
    expect(ctx.sources).toHaveLength(0);
    released = true;
    const up = vi.mocked(window.addEventListener).mock.calls.find(([name]) => name === 'pointerup')!;
    expect(up).toBeDefined();
    (up[1] as () => void)();
    await settle();
    expect(ctx.sources).toHaveLength(1);
  });

  it('keeps the pending sound if resume resolves before the context becomes running', async () => {
    const { sfx, primeAudio } = await import('../client/src/audio');
    primeAudio(); await settle();
    const ctx = contexts[0]; ctx.state = 'interrupted';
    ctx.resume.mockResolvedValue(undefined);
    sfx.pick(); await settle();
    expect(ctx.sources).toHaveLength(0);
    ctx.state = 'running'; ctx.listeners.get('statechange')?.();
    await settle();
    expect(ctx.sources).toHaveLength(1);
    ctx.listeners.get('statechange')?.();
    expect(ctx.sources).toHaveLength(1);
  });

  it('does not replay muted or stale queued taps after an interruption', async () => {
    const { sfx, primeAudio, setSoundEnabled } = await import('../client/src/audio');
    primeAudio(); await settle();
    const ctx = contexts[0]; ctx.state = 'suspended';
    ctx.resume.mockImplementation(() => new Promise<void>(() => {}));
    sfx.pick(); setSoundEnabled(false); setSoundEnabled(true);
    ctx.state = 'running'; ctx.listeners.get('statechange')?.();
    expect(ctx.sources).toHaveLength(0);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    ctx.state = 'suspended'; sfx.pick();
    clock.mockReturnValue(2000);
    ctx.state = 'running'; ctx.listeners.get('statechange')?.();
    expect(ctx.sources).toHaveLength(0);
    clock.mockRestore();
  });

  it('keeps input usable if audio is unsupported, and has a fallback for missing samples', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { sfx } = await import('../client/src/audio');
    sfx.pick(); await settle();
    expect(contexts[0].sources).toHaveLength(1);
    expect(contexts[0].sources[0].buffer).toBeUndefined();
    contexts[0].state = 'closed';
    vi.stubGlobal('window', {});
    expect(() => sfx.pick()).not.toThrow();
  });
});
