// 统计：乱点玩法在每关的获胜率（多 seed）。用于确定「乱点不能通关」断言的口径。
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true }, optimizeDeps: { disabled: true } });
try {
  const { buildLevel, LEVEL_COUNT } = await server.ssrLoadModule('/client/src/core/level.ts');
  const { Game } = await server.ssrLoadModule('/client/src/core/engine.ts');
  const { mulberry32 } = await server.ssrLoadModule('/client/src/core/rng.ts');
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  let totalWins = 0, totalRuns = 0, winLevels = [];
  const caps = [];
  for (let id = 2; id <= LEVEL_COUNT; id += 5) {
    const def = buildLevel(id);
    if (id <= 40) caps.push(`${id}:${def.capacity}`);
    let wins = 0;
    for (const s of SEEDS) {
      const g = new Game(def);
      g.start();
      const rng = mulberry32(id * 1000 + s);
      for (let step = 0; step < 400 && g.state === 'playing'; step++) {
        const all = [...g.wrongByColor.values()].flatMap((x) => [...x]).filter((x) => g.movable(x));
        if (!all.length) break;
        g.tap(all[Math.floor(rng() * all.length)]);
      }
      totalRuns++;
      if (g.state === 'won') { wins++; totalWins++; }
    }
    if (wins) winLevels.push(`${id}(${wins}/8)`);
  }
  console.log(`乱点获胜: ${totalWins}/${totalRuns}`);
  console.log('有获胜的关卡:', winLevels.join(', ') || '无');
  console.log('前40关空槽:', caps.join(' '));
} finally {
  await server.close();
}
