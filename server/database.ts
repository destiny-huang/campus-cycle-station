import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type AppMode = 'demo' | 'production';
export type AppDatabase = { connection: DatabaseSync; path: string; mode: AppMode };
export type StudentImportRow = { name: string; studentId: string; className: string };
export type SessionRecord = { role: 'student' | 'teacher'; studentId: number | null };

export type StudentRecord = {
  id: number;
  studentId: string;
  name: string;
  className: string;
  balance: number;
  environment: AppMode;
};

function readMode(value = process.env.CYCLE_MODE): AppMode {
  if (!value || value === 'production') return 'production';
  if (value === 'demo') return 'demo';
  throw new Error('CYCLE_MODE must be demo or production');
}

export function resolveDatabasePath(mode = readMode()) {
  return resolve(process.env.CYCLE_DB_PATH ?? `data/${mode}/campus-cycle-station.sqlite`);
}

export function openDatabase(options: { path?: string; mode?: AppMode } = {}): AppDatabase {
  const mode = options.mode ?? readMode();
  const path = options.path ?? resolveDatabasePath(mode);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS system_checks (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      checked_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY,
      student_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment IN ('demo', 'production')),
      balance INTEGER NOT NULL CHECK (balance >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS point_transactions (
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      amount INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('initial', 'labor')),
      reason TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      operated_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_point_transactions_student ON point_transactions(student_id, id DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('student', 'teacher')),
      student_id INTEGER REFERENCES students(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
  `);
  return { connection, path, mode };
}

function transaction<T>(database: AppDatabase, work: () => T): T {
  database.connection.exec('BEGIN IMMEDIATE;');
  try {
    const result = work();
    database.connection.exec('COMMIT;');
    return result;
  } catch (error) {
    database.connection.exec('ROLLBACK;');
    throw error;
  }
}

export function writeAndReadDatabaseCheck(database: AppDatabase) {
  const checkedAt = new Date().toISOString();
  database.connection.prepare(`
    INSERT INTO system_checks (name, value, checked_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, checked_at = excluded.checked_at
  `).run('m1-read-write', 'ok', checkedAt);
  return database.connection.prepare('SELECT value, checked_at FROM system_checks WHERE name = ?')
    .get('m1-read-write') as { value: string; checked_at: string } | undefined;
}

export function importStudents(database: AppDatabase, rows: StudentImportRow[], initialPoints = 20) {
  if (!Number.isInteger(initialPoints) || initialPoints < 0) throw new Error('invalid initial points');
  return transaction(database, () => {
    let created = 0;
    let updated = 0;
    const now = new Date().toISOString();
    const find = database.connection.prepare('SELECT id, environment FROM students WHERE student_number = ?');
    const insert = database.connection.prepare(`
      INSERT OR IGNORE INTO students (student_number, name, class_name, environment, balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const update = database.connection.prepare(`UPDATE students SET name = ?, class_name = ?, updated_at = ? WHERE id = ?`);
    const initial = database.connection.prepare(`
      INSERT INTO point_transactions (student_id, amount, source, reason, idempotency_key, operated_by, created_at)
      VALUES (?, ?, 'initial', '初始积分', ?, 'system', ?)
    `);

    for (const row of rows) {
      const existing = find.get(row.studentId) as { id: number; environment: AppMode } | undefined;
      if (existing && existing.environment !== database.mode) throw new Error(`student environment conflict: ${row.studentId}`);
      if (existing) {
        update.run(row.name, row.className, now, existing.id);
        updated += 1;
        continue;
      }
      const result = insert.run(row.studentId, row.name, row.className, database.mode, initialPoints, now, now);
      if (Number(result.changes) !== 1) throw new Error(`student insert failed: ${row.studentId}`);
      const inserted = find.get(row.studentId) as { id: number };
      initial.run(inserted.id, initialPoints, `initial:${database.mode}:${row.studentId}`, now);
      created += 1;
    }
    return { created, updated, total: rows.length };
  });
}

function mapStudent(row: Record<string, unknown>): StudentRecord {
  return {
    id: Number(row.id), studentId: String(row.student_number), name: String(row.name),
    className: String(row.class_name), balance: Number(row.balance), environment: row.environment as AppMode,
  };
}

export function findStudentForLogin(database: AppDatabase, name: string, studentId: string) {
  const row = database.connection.prepare(`SELECT * FROM students WHERE student_number = ? AND name = ? AND environment = ?`)
    .get(studentId, name, database.mode) as Record<string, unknown> | undefined;
  return row ? mapStudent(row) : undefined;
}

export function getStudent(database: AppDatabase, id: number) {
  const row = database.connection.prepare('SELECT * FROM students WHERE id = ? AND environment = ?')
    .get(id, database.mode) as Record<string, unknown> | undefined;
  return row ? mapStudent(row) : undefined;
}

export function searchStudents(database: AppDatabase, query: string) {
  const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const rows = database.connection.prepare(`
    SELECT * FROM students WHERE environment = ? AND (name LIKE ? ESCAPE '\\' OR student_number LIKE ? ESCAPE '\\')
    ORDER BY name, student_number LIMIT 50
  `).all(database.mode, pattern, pattern) as Record<string, unknown>[];
  return rows.map(mapStudent);
}

export function getLedger(database: AppDatabase, studentId: number) {
  return database.connection.prepare(`
    SELECT id, amount, source, reason, operated_by AS operatedBy, created_at AS createdAt
    FROM point_transactions WHERE student_id = ? ORDER BY id DESC LIMIT 100
  `).all(studentId);
}

export function addLaborReward(database: AppDatabase, input: { studentId: number; amount: number; reason: string; idempotencyKey: string }) {
  return transaction(database, () => {
    const previous = database.connection.prepare(`SELECT student_id, amount, reason FROM point_transactions WHERE idempotency_key = ?`)
      .get(input.idempotencyKey) as { student_id: number; amount: number; reason: string } | undefined;
    if (previous) {
      if (previous.student_id !== input.studentId || previous.amount !== input.amount || previous.reason !== input.reason) throw new Error('idempotency conflict');
      const student = getStudent(database, input.studentId);
      if (!student) throw new Error('student not found');
      return { duplicate: true, student };
    }
    const student = getStudent(database, input.studentId);
    if (!student) throw new Error('student not found');
    const now = new Date().toISOString();
    database.connection.prepare(`
      INSERT INTO point_transactions (student_id, amount, source, reason, idempotency_key, operated_by, created_at)
      VALUES (?, ?, 'labor', ?, ?, 'teacher', ?)
    `).run(input.studentId, input.amount, input.reason, input.idempotencyKey, now);
    database.connection.prepare('UPDATE students SET balance = balance + ?, updated_at = ? WHERE id = ?')
      .run(input.amount, now, input.studentId);
    return { duplicate: false, student: getStudent(database, input.studentId)! };
  });
}

function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

export function createSession(database: AppDatabase, role: SessionRecord['role'], studentId: number | null = null) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  database.connection.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  database.connection.prepare('INSERT INTO sessions (token_hash, role, student_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(hashToken(token), role, studentId, expires.toISOString(), now.toISOString());
  return token;
}

export function getSession(database: AppDatabase, token: string | undefined): SessionRecord | undefined {
  if (!token) return undefined;
  const row = database.connection.prepare(`SELECT role, student_id FROM sessions WHERE token_hash = ? AND expires_at > ?`)
    .get(hashToken(token), new Date().toISOString()) as { role: SessionRecord['role']; student_id: number | null } | undefined;
  return row ? { role: row.role, studentId: row.student_id } : undefined;
}

export function deleteSession(database: AppDatabase, token: string | undefined) {
  if (token) database.connection.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
