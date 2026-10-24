// 拼了个豆 服务端：托管前端静态文件 + 本地 SQLite（node:sqlite）存档
// 数据都在 data/picture-play.db：关卡定义、闯关进度、自由创作记录、作品墙
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const DB_FILE = path.join(DATA_DIR, 'picture-play.db');
const LEGACY_SAVE = path.join(DATA_DIR, 'save.json'); // 旧版 JSON 存档，首启时迁入 SQLite
const LEVELS_JSON = path.join(__dirname, 'generated', 'levels.json'); // npm run build:levels 生成
const PUBLIC_DIR = [path.join(__dirname, 'public'), path.join(__dirname, '..', 'dist')].find((d) => existsSync(d));

await mkdir(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY,
  pattern_key TEXT NOT NULL,
  name TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL,
  capacity INTEGER NOT NULL,
  time_limit INTEGER NOT NULL,
  colors TEXT NOT NULL,
  target TEXT NOT NULL,
  beads TEXT NOT NULL,
  objectives TEXT NOT NULL,
  elements TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_records (
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  seconds REAL NOT NULL,
  props_used INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (key, completed_at)
);
CREATE TABLE IF NOT EXISTS wall_works (
  id TEXT PRIMARY KEY,
  completed_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wall_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const q = {
  getProgress: db.prepare('SELECT version, data FROM progress WHERE id = 1'),
  upsertProgress: db.prepare(
    'INSERT INTO progress (id, version, data, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at',
  ),
  levelCount: db.prepare('SELECT COUNT(*) AS n FROM levels'),
  insertLevel: db.prepare(
    'INSERT OR REPLACE INTO levels (id, pattern_key, name, difficulty, w, h, wrong_count, capacity, time_limit, colors, target, beads, objectives, elements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  clearLevels: db.prepare('DELETE FROM levels'),
  listLevelMeta: db.prepare(
    'SELECT id, pattern_key, name, difficulty, wrong_count, capacity, time_limit, objectives, elements FROM levels ORDER BY id',
  ),
  getLevel: db.prepare('SELECT * FROM levels WHERE id = ?'),
  getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
  listRecords: db.prepare('SELECT key, name, seconds, props_used, completed_at FROM custom_records ORDER BY completed_at DESC LIMIT 30'),
  upsertRecord: db.prepare(
    'INSERT INTO custom_records (key, name, seconds, props_used, completed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key, completed_at) DO UPDATE SET name = excluded.name, seconds = excluded.seconds, props_used = excluded.props_used',
  ),
  pruneRecords: db.prepare(
    'DELETE FROM custom_records WHERE completed_at NOT IN (SELECT completed_at FROM custom_records ORDER BY completed_at DESC LIMIT 30)',
  ),
  listWorks: db.prepare('SELECT data FROM wall_works ORDER BY completed_at ASC'),
  upsertWork: db.prepare(
    'INSERT INTO wall_works (id, completed_at, data) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET completed_at = excluded.completed_at, data = excluded.data',
  ),
  getSettings: db.prepare('SELECT data FROM wall_settings WHERE id = 1'),
  upsertSettings: db.prepare('INSERT INTO wall_settings (id, data) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data'),
};

function readProgress() {
  const row = q.getProgress.get();
  try {
    return row ? JSON.parse(row.data) : null;
  } catch {
    return null;
  }
}

// 旧版 save.json 里的进度一次性迁入 SQLite
if (!q.getProgress.get() && existsSync(LEGACY_SAVE)) {
  try {
    const legacy = JSON.parse(await readFile(LEGACY_SAVE, 'utf8'));
    if (legacy && typeof legacy.version === 'number') {
      q.upsertProgress.run(legacy.version, JSON.stringify(legacy), Date.now());
      console.log('[sqlite] 已把旧版 save.json 的进度迁入', DB_FILE);
    }
  } catch {
    /* 旧档损坏时忽略 */
  }
}

// 把 server/generated/levels.json 的 200 关写进 SQLite（内容变化时重建）
async function seedLevels() {
  let levels;
  try {
    levels = JSON.parse(await readFile(LEVELS_JSON, 'utf8'));
  } catch {
    console.warn('[sqlite] 缺少 server/generated/levels.json，先运行 npm run build:levels 再启动；关卡接口暂时为空');
    return;
  }
  if (!Array.isArray(levels) || !levels.length) return;
  const hash = createHash('sha256').update(JSON.stringify(levels)).digest('hex').slice(0, 16);
  if (q.getMeta.get('levels_hash')?.value === hash && q.levelCount.get().n === levels.length) return;
  db.exec('BEGIN');
  try {
    q.clearLevels.run();
    for (const l of levels) {
      q.insertLevel.run(
        l.id, String(l.key), String(l.name), String(l.difficulty), l.w, l.h, l.wrongCount, l.capacity, l.timeLimit,
        JSON.stringify(l.colors), JSON.stringify(l.target), JSON.stringify(l.beads), JSON.stringify(l.objectives), JSON.stringify(l.elements),
      );
    }
    q.setMeta.run('levels_hash', hash);
    db.exec('COMMIT');
    console.log(`[sqlite] 已写入 ${levels.length} 个关卡定义 →`, DB_FILE);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
await seedLevels();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 4 * 1024 * 1024 });

app.addHook('onRequest', async (req, reply) => {
  if (!ACCESS_KEY || !req.url.startsWith('/api/')) return;
  if (req.headers['x-access-key'] !== ACCESS_KEY) return reply.code(401).send({ error: 'access key required' });
});

app.get('/healthz', async () => ({ ok: true }));

/* ---------- 闯关进度（localStorage 之外的服务端同步档） ---------- */
app.get('/api/save', async () => readProgress());

app.put('/api/save', async (req, reply) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.version !== 'number') {
    return reply.code(400).send({ error: 'invalid save' });
  }
  const current = readProgress();
  // 旧版本不能覆盖新版本（两台设备同时玩时）
  if (current && typeof current.version === 'number' && body.version <= current.version) {
    return reply.code(409).send(current);
  }
  q.upsertProgress.run(body.version, JSON.stringify(body), Date.now());
  return { ok: true, version: body.version };
});

/* ---------- 关卡（由 SQLite 提供，前端离线时本地生成兜底） ---------- */
function metaRow(row) {
  return {
    id: row.id, key: row.pattern_key, name: row.name, difficulty: row.difficulty,
    wrongCount: row.wrong_count, capacity: row.capacity, timeLimit: row.time_limit,
    objectives: JSON.parse(row.objectives), elements: JSON.parse(row.elements),
  };
}

app.get('/api/levels', async () => q.listLevelMeta.all().map(metaRow));

app.get('/api/levels/:id', async (req, reply) => {
  const id = Number(req.params.id);
  const row = Number.isInteger(id) ? q.getLevel.get(id) : null;
  if (!row) return reply.code(404).send({ error: 'level not found' });
  return {
    ...metaRow(row), w: row.w, h: row.h,
    colors: JSON.parse(row.colors), target: JSON.parse(row.target), beads: JSON.parse(row.beads),
  };
});

/* ---------- 自由创作记录 ---------- */
const recordRow = (r) => ({ key: r.key, name: r.name, seconds: r.seconds, propsUsed: r.props_used, completedAt: r.completed_at });

app.get('/api/custom-records', async () => q.listRecords.all().map(recordRow));

app.put('/api/custom-records', async (req, reply) => {
  const r = req.body;
  if (!r || typeof r.key !== 'string' || typeof r.name !== 'string' || !Number.isFinite(r.seconds) || !Number.isFinite(r.propsUsed) || !Number.isFinite(r.completedAt)) {
    return reply.code(400).send({ error: 'invalid record' });
  }
  q.upsertRecord.run(r.key, r.name.slice(0, 100), r.seconds, Math.round(r.propsUsed), Math.round(r.completedAt));
  q.pruneRecords.run();
  return q.listRecords.all().map(recordRow);
});

/* ---------- 作品墙 ---------- */
app.get('/api/wall', async () => {
  const works = q.listWorks.all().map((row) => { try { return JSON.parse(row.data); } catch { return null; } }).filter(Boolean);
  const settingsRow = q.getSettings.get();
  let settings = null;
  try {
    settings = settingsRow ? JSON.parse(settingsRow.data) : null;
  } catch {
    settings = null;
  }
  return { works, settings };
});

app.put('/api/wall/settings', async (req) => {
  if (!req.body || typeof req.body !== 'object') return { error: 'invalid settings' };
  q.upsertSettings.run(JSON.stringify(req.body));
  return { ok: true };
});

app.put('/api/wall/works', async (req, reply) => {
  const w = req.body;
  if (!w || typeof w.id !== 'string' || !w.id || typeof w !== 'object' || !w.grid) {
    return reply.code(400).send({ error: 'invalid work' });
  }
  const completedAt = Number.isFinite(w.completedAt) ? Math.round(w.completedAt) : Date.now();
  q.upsertWork.run(w.id, completedAt, JSON.stringify(w));
  return { ok: true };
});

if (PUBLIC_DIR) {
  await app.register(fastifyStatic, { root: PUBLIC_DIR });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
} else {
  app.log.warn('没有找到前端构建产物（dist/），只提供 API。开发时请访问 http://localhost:5173');
  app.get('/', async (req, reply) =>
    reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<body style="font:16px/1.8 system-ui,'Microsoft YaHei',sans-serif;background:#ffeef5;color:#8a4a63;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><h2 style="color:#ff6f9f">这里是拼了个豆的数据接口（3000 端口）</h2>
<p>开发模式下游戏页面在 <a href="http://${(req.headers.host || 'localhost').split(':')[0]}:5173">http://localhost:5173</a></p>
<p>想只用 3000 端口：先运行 <b>npm run build</b>，再运行 <b>npm run serve</b>（或直接 <b>npm start</b>）。</p></div>`),
  );
}

await app.listen({ port: PORT, host: '0.0.0.0' });
