// 把 client/src/core/level.ts 的 200 个关卡确定性生成导出为 JSON，
// 供服务端启动时写进本地 SQLite（server/generated/levels.json）。
// 用 vite 的 ssrLoadModule 编译 TS 与 import.meta.glob，npm 与 yarn PnP 环境都能跑。
// buildLevel 内部已用「聪明玩法」模拟保证每关可解（空槽太紧时自动 +2）。
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const outfile = path.join(root, 'server', 'generated', 'levels.json');

const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true },
  optimizeDeps: { disabled: true },
});
try {
  const { buildLevel, LEVEL_COUNT } = await server.ssrLoadModule('/client/src/core/level.ts');
  const levels = [];
  for (let id = 1; id <= LEVEL_COUNT; id++) {
    const d = buildLevel(id);
    levels.push({
      id, key: d.key, name: d.name, difficulty: d.difficulty,
      w: d.w, h: d.h, wrongCount: d.wrongCount, capacity: d.capacity, timeLimit: d.timeLimit,
      colors: [...d.colors], target: Array.from(d.target), beads: Array.from(d.beads),
      objectives: d.objectives, elements: d.elements,
    });
    if (id % 50 === 0) console.log(`关卡生成 ${id}/${LEVEL_COUNT}`);
  }
  await mkdir(path.dirname(outfile), { recursive: true });
  await writeFile(outfile, JSON.stringify(levels));
  const caps = levels.map((l) => l.capacity);
  console.log(`已生成 ${levels.length} 个关卡 → ${path.relative(root, outfile)} · 空槽 ${Math.min(...caps)}–${Math.max(...caps)}（平均 ${(caps.reduce((a, b) => a + b, 0) / caps.length).toFixed(1)}）`);
} finally {
  await server.close();
}
