import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppDatabase = { connection: DatabaseSync; path: string };

export function resolveDatabasePath() {
  return resolve(process.env.CYCLE_DB_PATH ?? 'data/campus-cycle-station.sqlite');
}

export function openDatabase(): AppDatabase {
  const path = resolveDatabasePath();
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS system_checks (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      checked_at TEXT NOT NULL
    ) STRICT;
  `);
  return { connection, path };
}

export function writeAndReadDatabaseCheck(database: AppDatabase) {
  const checkedAt = new Date().toISOString();
  database.connection.prepare(`
    INSERT INTO system_checks (name, value, checked_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at
  `).run('m1-read-write', 'ok', checkedAt);
  return database.connection.prepare(
    'SELECT value, checked_at FROM system_checks WHERE name = ?',
  ).get('m1-read-write') as { value: string; checked_at: string } | undefined;
}
