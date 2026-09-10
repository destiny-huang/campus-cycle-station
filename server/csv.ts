import type { StudentImportRow } from './database.js';

function parseRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error('CSV 引号未闭合');
  return rows;
}

export function parseStudentCsv(text: string): StudentImportRow[] {
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('CSV 没有学生数据');
  const headers = rows[0].map((value) => value.trim());
  const indexes = ['name', 'student_id', 'class_name'].map((name) => headers.indexOf(name));
  if (indexes.some((index) => index < 0)) throw new Error('CSV 必须包含 name、student_id、class_name');
  if (rows.length > 2001) throw new Error('单次最多导入 2000 名学生');
  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const [name, studentId, className] = indexes.map((column) => (values[column] ?? '').trim());
    if (!name || !studentId || !className) throw new Error(`CSV 第 ${index + 2} 行字段不完整`);
    if (studentId.length > 64 || name.length > 80 || className.length > 80) throw new Error(`CSV 第 ${index + 2} 行字段过长`);
    if (seen.has(studentId)) throw new Error(`CSV 内学号重复：第 ${index + 2} 行`);
    seen.add(studentId);
    return { name, studentId, className };
  });
}
