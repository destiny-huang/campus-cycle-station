import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAppServer } from './app.js';
import { addLaborReward, getLedger, openDatabase, searchStudents, writeAndReadDatabaseCheck } from './database.js';
import { createDonation, listLockers, markDeposited, reviewDonation } from './donations.js';
import { listStudentRedemptions, redeemDonation } from './redemptions.js';
import { seedDemoStudents } from './seed.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M4.5 check failed: ${message}`);
}

const suffix = `${Date.now()}-${process.pid}`;
const testPath = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m45-${suffix}.sqlite`);
const uploadDirectory = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m45-uploads-${suffix}`);
await mkdir(uploadDirectory, { recursive: true });
let database = openDatabase({ path: testPath, mode: 'demo' });
writeAndReadDatabaseCheck(database);
seedDemoStudents(database);
const demo = Object.fromEntries(searchStudents(database, 'DEMO').map((student) => [student.studentId, student]));
addLaborReward(database, { studentId: demo.DEMO006.id, amount: 1, reason: '保留既有奖励', idempotencyKey: 'm45-preserve-demo006-0001' });

const donation = createDonation(database, {
  studentId: demo.DEMO001.id, name: '教程状态隔离测试书', categoryId: 'book', condition: 'normal', description: '', zone: 'A',
  photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=', idempotencyKey: 'm45-business-preserve-0001', uploadDirectory,
}).donation;
markDeposited(database, donation.id, demo.DEMO001.id);
reviewDonation(database, donation.id, { action: 'approve', finalPoints: 10 });
redeemDonation(database, { studentId: demo.DEMO002.id, donationId: donation.id, idempotencyKey: 'm45-redemption-preserve-0001' });

const server = createAppServer(database, { teacherPassword: 'm45-local-test-only', uploadDirectory, backgroundAi: false });
await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server address unavailable');
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${base}${path}`, { ...options, headers: {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers,
  } });
  return { response, body: await response.json() as Record<string, any>, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const post = (path: string, body: unknown, cookie?: string) => request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);
const login = (number: string) => post('/api/auth/student', { name: `演示同学${number.slice(-2)}`, studentId: number });

const firstLogin = await login('DEMO001');
assert(firstLogin.response.status === 200 && firstLogin.body.onboardingRequired === true, 'first login must require onboarding');
const firstCookie = firstLogin.cookie!;
const beforeComplete = {
  balance: searchStudents(database, 'DEMO001')[0].balance,
  ledger: getLedger(database, demo.DEMO001.id).length,
  donations: database.connection.prepare('SELECT count(*) AS count FROM donations').get() as { count: number },
};
const completed = await post('/api/student/onboarding/complete', {}, firstCookie);
assert(completed.response.status === 200 && completed.body.student.onboardingCompletedAt, 'completion must persist timestamp');
const completedAt = String(completed.body.student.onboardingCompletedAt);
await post('/api/auth/logout', {}, firstCookie);
const relogin = await login('DEMO001');
assert(relogin.body.onboardingRequired === false, 'completed student must not auto-open onboarding again');

const skipLogin = await login('DEMO002');
assert(skipLogin.body.onboardingRequired === true, 'second new student must require onboarding');
await post('/api/student/onboarding/complete', {}, skipLogin.cookie);
await post('/api/auth/logout', {}, skipLogin.cookie);
assert((await login('DEMO002')).body.onboardingRequired === false, 'skip completion must prevent future auto-open');

await post('/api/student/onboarding/complete', {}, relogin.cookie);
const afterReplay = searchStudents(database, 'DEMO001')[0];
assert(afterReplay.onboardingCompletedAt === completedAt, 'manual replay must not rewrite completion timestamp');
assert(afterReplay.balance === beforeComplete.balance && getLedger(database, demo.DEMO001.id).length === beforeComplete.ledger,
  'onboarding completion and replay must not change points or ledger');
assert((database.connection.prepare('SELECT count(*) AS count FROM donations').get() as { count: number }).count === beforeComplete.donations.count,
  'onboarding must not create donation records');

const businessBeforeReset = {
  balance: searchStudents(database, 'DEMO002')[0].balance,
  ledger: getLedger(database, demo.DEMO002.id).length,
  donations: Number((database.connection.prepare('SELECT count(*) AS count FROM donations').get() as { count: number }).count),
  redemptions: listStudentRedemptions(database, demo.DEMO002.id).length,
  lockers: JSON.stringify(listLockers(database).map((slot) => [slot.id, slot.state, slot.queueOrder, slot.donation?.id ?? null])),
};
const studentAttempt = await post(`/api/teacher/students/${demo.DEMO002.id}/onboarding/reset`, {}, relogin.cookie);
assert(studentAttempt.response.status === 401, 'student must not reset another student onboarding');
const teacherLogin = await post('/api/auth/teacher', { password: 'm45-local-test-only' });
const reset = await post(`/api/teacher/students/${demo.DEMO002.id}/onboarding/reset`, {}, teacherLogin.cookie);
assert(reset.response.status === 200 && reset.body.student.onboardingCompletedAt === null, 'teacher reset must clear only onboarding status');
assert(searchStudents(database, 'DEMO002')[0].balance === businessBeforeReset.balance
  && getLedger(database, demo.DEMO002.id).length === businessBeforeReset.ledger
  && Number((database.connection.prepare('SELECT count(*) AS count FROM donations').get() as { count: number }).count) === businessBeforeReset.donations
  && listStudentRedemptions(database, demo.DEMO002.id).length === businessBeforeReset.redemptions
  && JSON.stringify(listLockers(database).map((slot) => [slot.id, slot.state, slot.queueOrder, slot.donation?.id ?? null])) === businessBeforeReset.lockers,
  'teacher reset must preserve points, ledger, donations, redemptions and lockers');

await post('/api/auth/logout', {}, teacherLogin.cookie);
assert((await post(`/api/teacher/students/${demo.DEMO002.id}/onboarding/reset`, {}, teacherLogin.cookie)).response.status === 401,
  'logged-out teacher must lose teacher access');
await post('/api/auth/logout', {}, relogin.cookie);
assert((await request('/api/student/me', {}, relogin.cookie)).response.status === 401, 'logged-out student must lose student access');

await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
database.connection.close();
database = openDatabase({ path: testPath, mode: 'demo' });
seedDemoStudents(database);
assert(searchStudents(database, 'DEMO001')[0].onboardingCompletedAt === completedAt, 'restart and repeat migration must preserve completion');
assert(searchStudents(database, 'DEMO002')[0].onboardingCompletedAt === null, 'teacher reset must survive restart');
assert(searchStudents(database, 'DEMO006')[0].balance === 201 && getLedger(database, demo.DEMO006.id).reduce((sum: number, row: any) => sum + row.amount, 0) === 201,
  'migration must preserve DEMO006 balance and ledger');
database.connection.close();

const legacyPath = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m45-legacy-${suffix}.sqlite`);
const legacy = new DatabaseSync(legacyPath);
legacy.exec(`CREATE TABLE students (id INTEGER PRIMARY KEY, student_number TEXT NOT NULL UNIQUE, name TEXT NOT NULL, class_name TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('demo', 'production')), balance INTEGER NOT NULL CHECK (balance >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
  INSERT INTO students VALUES (1, 'LEGACY001', '旧账号', '原班级', 'demo', 37, '2026-01-01', '2026-01-01');`);
legacy.close();
const migrated = openDatabase({ path: legacyPath, mode: 'demo' });
assert(searchStudents(migrated, 'LEGACY001')[0].balance === 37 && searchStudents(migrated, 'LEGACY001')[0].onboardingCompletedAt === null,
  'one-time migration must preserve an existing student and mark onboarding incomplete');
migrated.connection.close();

console.log(JSON.stringify({ ok: true, checks: [
  'first-login-required', 'complete-and-skip-persist', 'manual-replay-isolated', 'teacher-reset-authorization',
  'reset-preserves-business-data', 'logout-invalidates-sessions', 'restart-and-repeat-migration', 'legacy-account-migration',
] }, null, 2));
