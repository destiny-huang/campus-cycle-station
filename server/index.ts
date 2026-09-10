import { createAppServer } from './app.js';
import { openDatabase, writeAndReadDatabaseCheck } from './database.js';
import { seedDemoStudents } from './seed.js';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.API_PORT ?? process.env.PORT ?? '3001', 10);
const database = openDatabase();
const check = writeAndReadDatabaseCheck(database);
if (check?.value !== 'ok') throw new Error('SQLite initialization check failed');
const seed = seedDemoStudents(database);
const server = createAppServer(database);

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') console.error(`端口 ${port} 已被占用，请设置其他 API_PORT 后重试。`);
  else console.error(error);
  database.connection.close();
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`校园循环站 API 已启动：http://${host}:${port}`);
  console.log(`运行模式：${database.mode}；SQLite：${database.path}`);
  if (database.mode === 'demo') console.log(`演示学生：${seed.total} 人（新增 ${seed.created}，已存在 ${seed.updated}）`);
  console.log('AI：mock（模拟模式）');
});

function shutdown() {
  server.close(() => { database.connection.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
