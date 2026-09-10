import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStudentCsv } from './csv.js';
import { importStudents, type AppDatabase } from './database.js';

export function seedDemoStudents(database: AppDatabase) {
  if (database.mode !== 'demo') return { created: 0, updated: 0, total: 0 };
  const csv = readFileSync(resolve('fixtures/demo-students.csv'), 'utf8');
  const rows = parseStudentCsv(csv);
  if (rows.length !== 6) throw new Error('演示学生 fixture 必须恰好包含 6 人');
  return importStudents(database, rows, 200);
}
