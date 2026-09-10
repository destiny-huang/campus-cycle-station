import { openDatabase, writeAndReadDatabaseCheck } from './database.js';

const database = openDatabase();
try {
  const result = writeAndReadDatabaseCheck(database);
  if (result?.value !== 'ok') throw new Error('SQLite read/write verification failed');
  console.log(JSON.stringify({ ok: true, engine: 'sqlite', readWrite: result.value, path: database.path }));
} finally {
  database.connection.close();
}
