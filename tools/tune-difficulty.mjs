// 难度调参：对候选参数批量实测「聪明玩法能通关 + 乱点会爆槽」，找两者兼得的参数。
// 用法：yarn node tools/tune-difficulty.mjs
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true }, optimizeDeps: { disabled: true } });
try {
  const levelMod = await server.ssrLoadModule('/client/src/core/level.ts');
  const engineMod = await server.ssrLoadModule('/client/src/core/engine.ts');
  const { buildLevel, DIFFICULTY, LEVEL_COUNT } = levelMod;
  const { Game } = engineMod;
  const { mulberry32 } = await server.ssrLoadModule('/client/src/core/rng.ts');

  function playSmart(g, maxSteps = 100000) {
    g.start();
    for (let step = 0; step < maxSteps && g.state === 'playing'; step++) {
      let cell = -1;
      for (const { color } of g.neededColors()) {
        for (const c of g.wrongByColor.get(color) ?? []) {
          if (!g.locked[c]) { cell = c; break; }
        }
        if (cell >= 0) break;
      }
      if (cell < 0) {
        let best = Infinity;
        for (const set of g.wrongByColor.values()) {
          for (const c of set) {
            if (g.locked[c]) continue;
            const n = g.ice[c] ? 0.5 : g.groupAt(c).length;
            if (n < best) { best = n; cell = c; }
          }
        }
      }
      if (cell < 0) break;
      g.tap(cell);
    }
  }
  function playNaive(g, seed, maxSteps = 400) {
    const rng = mulberry32(seed);
    g.start();
    for (let step = 0; step < maxSteps && g.state === 'playing'; step++) {
      const all = [...g.wrongByColor.values()].flatMap((s) => [...s]).filter((x) => g.movable(x));
      if (!all.length) break;
      g.tap(all[Math.floor(rng() * all.length)]);
    }
  }
  function groupStats(def) {
    // 错位豆同色 4 连通分量大小分布
    const w = def.w, h = def.h;
    const wrong = (i) => def.target[i] >= 0 && def.beads[i] !== def.target[i];
    const seen = new Uint8Array(def.target.length);
    const sizes = [];
    for (let i = 0; i < def.target.length; i++) {
      if (!wrong(i) || seen[i]) continue;
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const c = stack.pop();
        size++;
        const x = c % w, y = Math.floor(c / w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (!seen[n] && wrong(n) && def.beads[n] === def.beads[c]) { seen[n] = 1; stack.push(n); }
        }
      }
      sizes.push(size);
    }
    sizes.sort((a, b) => b - a);
    return { max: sizes[0] ?? 0, p90: sizes[Math.floor(sizes.length * 0.1)] ?? 0 };
  }

  const candidates = [
    { capBase: 0.16, capSlope: 0.09 },
    { capBase: 0.12, capSlope: 0.07 },
    { capBase: 0.09, capSlope: 0.05 },
    { capBase: 0.2, capSlope: 0.11 },
  ];
  const ids = [];
  for (let id = 2; id <= LEVEL_COUNT; id += 9) ids.push(id);

  for (const cand of candidates) {
    Object.assign(DIFFICULTY, cand);
    let smartFails = [], naiveFails = [], stuck = [], capSum = 0, capMin = 99, capMax = 0, gmax = 0;
    for (const id of ids) {
      const def = buildLevel(id);
      const gs = groupStats(def);
      gmax = Math.max(gmax, gs.max);
      capSum += def.capacity; capMin = Math.min(capMin, def.capacity); capMax = Math.max(capMax, def.capacity);
      const g = new Game(def);
      playSmart(g);
      if (g.state !== 'won') smartFails.push(`${id}(cap${def.capacity},gmax${gs.max})`);
      if (id >= 60) {
        for (const seed of [id * 7 + 1, id * 13 + 5]) {
          const gn = new Game(buildLevel(id));
          playNaive(gn, seed);
          if (gn.state === 'won') naiveFails.push(`${id}/s${seed} WON`);
          else if (gn.state === 'playing') stuck.push(`${id}/s${seed}`);
        }
      }
    }
    console.log(`cap ${cand.capBase}->${cand.capSlope} | 平均槽 ${(capSum / ids.length).toFixed(1)} [${capMin}..${capMax}] 组最大 ${gmax} | 聪明失败 ${smartFails.length ? smartFails.slice(0, 6).join(',') : '无'} | 乱点未爆 ${stuck.length ? stuck.slice(0, 4).join(',') : '无'} | 乱点通关 ${naiveFails.length ? naiveFails.slice(0, 4).join(',') : '无'}`);
  }
} finally {
  await server.close();
}
