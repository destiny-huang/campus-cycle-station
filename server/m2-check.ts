import { resolve } from 'node:path';
import { createAppServer } from './app.js';
import { getLedger, importStudents, openDatabase, searchStudents, writeAndReadDatabaseCheck } from './database.js';
import { seedDemoStudents } from './seed.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M2 check failed: ${message}`);
}

const testPath = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m2-${Date.now()}-${process.pid}.sqlite`);
let database = openDatabase({ path: testPath, mode: 'demo' });
writeAndReadDatabaseCheck(database);

const firstSeed = seedDemoStudents(database);
const secondSeed = seedDemoStudents(database);
assert(firstSeed.created === 6 && secondSeed.created === 0, 'demo seed must create exactly once');
const demoStudents = searchStudents(database, 'DEMO');
assert(demoStudents.length === 6 && demoStudents.every((student) => student.balance === 200), 'six demo balances must be 200');
assert(demoStudents.every((student) => getLedger(database, student.id).length === 1), 'demo initial ledger must not duplicate');

const sameNameRows = [
  { name: '同名同学', studentId: 'NORMAL001', className: '初一（1）班' },
  { name: '同名同学', studentId: 'NORMAL002', className: '初二（2）班' },
];
const firstImport = importStudents(database, sameNameRows, 20);
const secondImport = importStudents(database, sameNameRows, 20);
assert(firstImport.created === 2 && secondImport.created === 0, 'ordinary import must be idempotent');
assert(searchStudents(database, '同名同学').every((student) => student.balance === 20), 'ordinary balances must be 20');

const server = createAppServer(database, { teacherPassword: 'local-test-only', backgroundAi: false });
await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server address unavailable');
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  return { response, body: await response.json() as Record<string, any>, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const post = (path: string, body: unknown, cookie?: string) => request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);

assert((await request('/api/student/me')).response.status === 401, 'student data must require login');
assert((await request('/api/teacher/students')).response.status === 401, 'teacher search must require login');
assert((await post('/api/auth/student', { name: '同名同学', studentId: 'DEMO001' })).response.status === 401, 'name and student id must match same record');

const loginOne = await post('/api/auth/student', { name: '同名同学', studentId: 'NORMAL001' });
assert(loginOne.response.status === 200 && loginOne.cookie, 'ordinary student login must succeed');
const meBefore = await request('/api/student/me', {}, loginOne.cookie);
assert(meBefore.body.student.balance === 20 && meBefore.body.ledger.length === 1, 'ordinary student starts at 20 with one ledger row');
assert((await post('/api/teacher/rewards', { studentId: sameNameRows[0], amount: 7 }, loginOne.cookie)).response.status === 401, 'student session cannot reward');

const teacherLogin = await post('/api/auth/teacher', { password: 'local-test-only' });
assert(teacherLogin.response.status === 200 && teacherLogin.cookie, 'teacher login must succeed');
const teacherCookie = teacherLogin.cookie;
assert((await post('/api/auth/teacher', { password: 'wrong' })).response.status === 401, 'wrong teacher password must fail');

const csv = 'name,student_id,class_name\nCSV同学,NORMAL003,初三（3）班\n';
const csvFirst = await post('/api/teacher/import-csv', { csv }, teacherCookie);
const csvSecond = await post('/api/teacher/import-csv', { csv }, teacherCookie);
assert(csvFirst.body.created === 1 && csvSecond.body.created === 0, 'CSV repeat must not reinitialize');
assert((await post('/api/teacher/import-csv', { csv: 'wrong,headers\nvalue,row\n' }, teacherCookie)).response.status === 400, 'invalid CSV must be rejected');

const search = await request('/api/teacher/students?query=%E5%90%8C%E5%90%8D', {}, teacherCookie);
const matches = search.body.students as Array<Record<string, any>>;
assert(matches.length === 2 && new Set(matches.map((student) => student.studentId)).size === 2, 'same-name students must remain distinct');
const target = matches.find((student) => student.studentId === 'NORMAL001');
assert(target, 'reward target missing');

const rewardBody = { studentId: target.id, amount: 7, reason: '整理循环站物品', idempotencyKey: 'test-reward-key-0001' };
const rewardOne = await post('/api/teacher/rewards', rewardBody, teacherCookie);
const rewardTwo = await post('/api/teacher/rewards', rewardBody, teacherCookie);
assert(rewardOne.body.duplicate === false && rewardTwo.body.duplicate === true, 'same reward request must apply once');
assert(rewardTwo.body.student.balance === 27, 'idempotent retry must keep balance at 27');
assert((await post('/api/teacher/rewards', { ...rewardBody, amount: 8 }, teacherCookie)).response.status === 409, 'reused key with changed payload must conflict');

const relogin = await post('/api/auth/student', { name: '同名同学', studentId: 'NORMAL001' });
const meAfter = await request('/api/student/me', {}, relogin.cookie);
const ledger = meAfter.body.ledger as Array<{ amount: number }>;
assert(meAfter.body.student.balance === 27 && ledger.reduce((sum, entry) => sum + entry.amount, 0) === 27, 'balance and ledger must agree');

const nativePreflight = await fetch(`${base}/api/session`, { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'GET' } });
assert(nativePreflight.status === 204 && nativePreflight.headers.get('access-control-allow-origin') === 'https://localhost'
  && nativePreflight.headers.get('access-control-allow-credentials') === 'true', 'Capacitor origin must receive credentialed CORS headers');
const nativeLogin = await fetch(`${base}/api/auth/student`, { method: 'POST', headers: { Origin: 'https://localhost', 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '同名同学', studentId: 'NORMAL001' }) });
const nativeSetCookie = nativeLogin.headers.get('set-cookie') ?? '';
assert(nativeLogin.status === 200 && /HttpOnly/i.test(nativeSetCookie) && /SameSite=None/i.test(nativeSetCookie) && /Secure/i.test(nativeSetCookie),
  'Capacitor session cookie must remain HttpOnly and use secure cross-site policy');
const rejectedPreflight = await fetch(`${base}/api/session`, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } });
assert(rejectedPreflight.status === 403 && !rejectedPreflight.headers.get('access-control-allow-origin'), 'unknown origins must not receive CORS access');

await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
database.connection.close();
database = openDatabase({ path: testPath, mode: 'demo' });
writeAndReadDatabaseCheck(database);
seedDemoStudents(database);
const persisted = searchStudents(database, 'NORMAL001')[0];
assert(persisted.balance === 27 && getLedger(database, persisted.id).length === 2, 'balance and ledger must persist across restart');
assert(searchStudents(database, 'DEMO').every((student) => student.balance === 200), 'restart seed must not reset demo balances');
database.connection.close();

console.log(JSON.stringify({ ok: true, testPath, checks: ['auth', 'same-name', 'initial-points', 'seed-import-idempotency', 'teacher', 'reward-idempotency', 'authorization', 'ledger', 'capacitor-cors-cookie', 'restart'] }));
