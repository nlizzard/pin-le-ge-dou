// 拼豆归位 服务端：托管前端静态文件 + 读写单人存档
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const SAVE_FILE = path.join(DATA_DIR, 'save.json');
const BAK_FILE = path.join(DATA_DIR, 'save.bak.json');
const PUBLIC_DIR = [path.join(__dirname, 'public'), path.join(__dirname, '..', 'dist')].find((d) => existsSync(d));

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: 1024 * 1024 });

await mkdir(DATA_DIR, { recursive: true });

async function readSave() {
  try {
    return JSON.parse(await readFile(SAVE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// 串行写入，先写临时文件再改名，避免写坏
let writing = Promise.resolve();
function writeSave(data) {
  writing = writing.then(async () => {
    if (existsSync(SAVE_FILE)) await copyFile(SAVE_FILE, BAK_FILE);
    const tmp = SAVE_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, SAVE_FILE);
  });
  return writing;
}

app.addHook('onRequest', async (req, reply) => {
  if (!ACCESS_KEY || !req.url.startsWith('/api/')) return;
  if (req.headers['x-access-key'] !== ACCESS_KEY) return reply.code(401).send({ error: 'access key required' });
});

app.get('/healthz', async () => ({ ok: true }));

app.get('/api/save', async () => (await readSave()) ?? null);

app.put('/api/save', async (req, reply) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || typeof body.version !== 'number') {
    return reply.code(400).send({ error: 'invalid save' });
  }
  const current = await readSave();
  // 旧版本不能覆盖新版本（两台设备同时玩时）
  if (current && typeof current.version === 'number' && body.version <= current.version) {
    return reply.code(409).send(current);
  }
  await writeSave(body);
  return { ok: true, version: body.version };
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
<body style="font:16px/1.8 system-ui,'Microsoft YaHei',sans-serif;background:#dcdcf5;color:#3d3566;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><h2 style="color:#8f6ff0">这里是拼豆归位的数据接口（3000 端口）</h2>
<p>开发模式下游戏页面在 <a href="http://${(req.headers.host || 'localhost').split(':')[0]}:5173">http://localhost:5173</a></p>
<p>想只用 3000 端口：先运行 <b>npm run build</b>，再运行 <b>npm run serve</b>（或直接 <b>npm start</b>）。</p></div>`),
  );
}

await app.listen({ port: PORT, host: '0.0.0.0' });
