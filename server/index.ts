import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { openDatabase, writeAndReadDatabaseCheck } from './database.js';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3001', 10);
const database = openDatabase();
const initialCheck = writeAndReadDatabaseCheck(database);
if (initialCheck?.value !== 'ok') {
  database.connection.close();
  throw new Error('SQLite initialization check failed');
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function serveFrontend(pathname: string, response: ServerResponse) {
  const dist = resolve('dist');
  const requested = join(dist, pathname === '/' ? 'index.html' : pathname);
  const file = existsSync(requested) && statSync(requested).isFile() ? requested : join(dist, 'index.html');
  if (!existsSync(file)) {
    sendJson(response, 404, { ok: false, error: 'frontend_not_built' });
    return;
  }
  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const row = database.connection.prepare(
      'SELECT value, checked_at FROM system_checks WHERE name = ?',
    ).get('m1-read-write') as { value: string; checked_at: string } | undefined;
    sendJson(response, 200, {
      ok: true,
      service: 'campus-cycle-station-api',
      database: { ok: row?.value === 'ok', engine: 'sqlite' },
      ai: { mode: 'mock', label: '模拟模式，未调用真实 AI' },
    });
    return;
  }
  if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
    serveFrontend(url.pathname, response);
    return;
  }
  sendJson(response, 404, { ok: false, error: 'not_found' });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用，请设置其他 API_PORT 后重试。`);
  else console.error(error);
  database.connection.close();
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`校园循环站 API 已启动：http://${host}:${port}`);
  console.log(`SQLite：${database.path}`);
  console.log('AI：mock（模拟模式）');
});

function shutdown() {
  server.close(() => {
    database.connection.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
