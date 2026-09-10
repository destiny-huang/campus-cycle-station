import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAppServer } from './app.js';
import { addLaborReward, getLedger, importStudents, openDatabase, searchStudents, writeAndReadDatabaseCheck } from './database.js';
import { getDonation, listLockers, listStudentDonations, resolvePhotoPath } from './donations.js';
import { seedDemoStudents } from './seed.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M3 check failed: ${message}`);
}

const suffix = `${Date.now()}-${process.pid}`;
const testPath = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m3-${suffix}.sqlite`);
const uploadDirectory = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m3-uploads-${suffix}`);
await mkdir(uploadDirectory, { recursive: true });
let database = openDatabase({ path: testPath, mode: 'demo' });
writeAndReadDatabaseCheck(database);
seedDemoStudents(database);
const demoSix = searchStudents(database, 'DEMO006')[0];
addLaborReward(database, { studentId: demoSix.id, amount: 1, reason: 'M2 保留测试', idempotencyKey: 'm3-preserve-m2-reward-0001' });

const server = createAppServer(database, { teacherPassword: 'm3-local-test-only', uploadDirectory });
await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server address unavailable');
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, options: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${base}${path}`, { ...options, headers: {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers,
  } });
  const type = response.headers.get('content-type') ?? '';
  const body: any = type.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const post = (path: string, body: unknown, cookie?: string) => request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);
const loginStudent = async (name: string, studentId: string) => (await post('/api/auth/student', { name, studentId })).cookie!;
const studentOne = await loginStudent('演示同学01', 'DEMO001');
const studentTwo = await loginStudent('演示同学02', 'DEMO002');
const teacher = (await post('/api/auth/teacher', { password: 'm3-local-test-only' })).cookie!;
assert(studentOne && studentTwo && teacher, 'sessions must be created');

const photoDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
const baseDonation = { name: '测试图书', categoryId: 'book', condition: 'normal', description: '完整，交教师核验', zone: 'A', photoDataUrl };
const first = await post('/api/student/donations', { ...baseDonation, idempotencyKey: 'm3-create-donation-0001' }, studentOne);
const retry = await post('/api/student/donations', { ...baseDonation, idempotencyKey: 'm3-create-donation-0001' }, studentOne);
assert(first.response.status === 201 && retry.body.duplicate === true, 'same create request must return one donation');
assert(first.body.donation.id === retry.body.donation.id && first.body.donation.slotId === 'A01', 'retry must not reserve another slot');
const firstId = Number(first.body.donation.id);
assert((await request(`/api/donations/${firstId}/photo`, {}, studentOne)).response.status === 200, 'owner must view original photo');
assert((await request(`/api/donations/${firstId}/photo`)).response.status === 403, 'unapproved photo must not be public');

const second = await post('/api/student/donations', { ...baseDonation, name: '继续捐赠物品', idempotencyKey: 'm3-create-donation-0002' }, studentOne);
assert(second.body.donation.slotId === 'A02', 'continue donation must create an independent application');
assert((await post(`/api/student/donations/${second.body.donation.id}/cancel`, {}, studentTwo)).response.status === 403, 'student cannot cancel another student donation');
const cancelOne = await post(`/api/student/donations/${second.body.donation.id}/cancel`, {}, studentOne);
const cancelTwo = await post(`/api/student/donations/${second.body.donation.id}/cancel`, {}, studentOne);
assert(cancelOne.body.duplicate === false && cancelTwo.body.duplicate === true, 'cancel must release only once');
const afterCancel = await post('/api/student/donations', { ...baseDonation, name: '取消后新申请', idempotencyKey: 'm3-create-donation-0003' }, studentOne);
assert(afterCancel.body.donation.slotId === 'A03', 'released slot must return to FIFO tail');

const concurrent = await Promise.all([
  post('/api/student/donations', { ...baseDonation, zone: 'C', name: '并发一', idempotencyKey: 'm3-concurrent-create-0001' }, studentOne),
  post('/api/student/donations', { ...baseDonation, zone: 'C', name: '并发二', idempotencyKey: 'm3-concurrent-create-0002' }, studentTwo),
]);
assert(new Set(concurrent.map((result) => result.body.donation.slotId)).size === 2, 'concurrent requests must reserve different slots');
for (let index = 3; index <= 20; index += 1) {
  const result = await post('/api/student/donations', { ...baseDonation, zone: 'C', name: `填满 C 区 ${index}`, idempotencyKey: `m3-fill-zone-c-${String(index).padStart(4, '0')}` }, studentOne);
  assert(result.response.status === 201, `C slot ${index} must reserve`);
}
const full = await post('/api/student/donations', { ...baseDonation, zone: 'C', name: '超额申请', idempotencyKey: 'm3-zone-full-create-0001' }, studentOne);
assert(full.response.status === 409 && full.body.code === 'zone_full', 'full zone must fail clearly');
assert(listStudentDonations(database, searchStudents(database, 'DEMO001')[0].id).filter((item) => item.zone === 'C').length === 19, 'full failure must not create a partial donation');

const beforeReview = searchStudents(database, 'DEMO001')[0].balance;
const depositOne = await post(`/api/student/donations/${firstId}/deposit`, {}, studentOne);
const depositRetry = await post(`/api/student/donations/${firstId}/deposit`, {}, studentOne);
assert(depositOne.body.duplicate === false && depositRetry.body.duplicate === true, 'deposit retry must be idempotent');
assert(searchStudents(database, 'DEMO001')[0].balance === beforeReview, 'submission and deposit must not award points');
assert((await post(`/api/teacher/donations/${firstId}/review`, { action: 'approve', finalPoints: 12 }, studentOne)).response.status === 401, 'student cannot call teacher review');
const approveOne = await post(`/api/teacherfinder/donations/${firstId}/review`, { action: 'approve', finalPoints: 12 }, teacher);
assert(approveOne.response.status === 404, 'unknown route must not approve');
const approve = await post(`/api/teacher/donations/${firstId}/review`, { action: 'approve', finalPoints: 12 }, teacher);
const approveRetry = await post(`/api/teacher/donations/${firstId}/review`, { action: 'approve', finalPoints: 12 }, teacher);
assert(approve.body.duplicate === false && approveRetry.body.duplicate === true, 'repeat review must award once');
const reviewedStudent = searchStudents(database, 'DEMO001')[0];
assert(reviewedStudent.balance === beforeReview + 12, 'approved points must reach balance once');
assert(getLedger(database, reviewedStudent.id).filter((entry: any) => entry.source === 'donation').length === 1, 'approval must create one donation ledger entry');
assert((await request(`/api/donations/${firstId}/photo`)).response.status === 200, 'approved original photo may display on cabinet');

const returned = await post('/api/student/donations', { ...baseDonation, zone: 'B', name: '待退回物品', idempotencyKey: 'm3-return-create-0001' }, studentOne);
const returnedId = Number(returned.body.donation.id);
await post(`/api/student/donations/${returnedId}/deposit`, {}, studentOne);
await post(`/api/teacher/donations/${returnedId}/review`, { action: 'return', reason: '实物状态与说明不符' }, teacher);
assert((await post(`/api/student/donations/${returnedId}/cancel`, {}, studentOne)).response.status === 409, 'returned item cannot use ordinary cancellation');
let returnedSlot = listLockers(database, true).find((slot) => slot.id === returned.body.donation.slotId)!;
assert(returnedSlot.state === 'occupied', 'returned item must keep occupying its slot');
const releaseOne = await post(`/api/teacher/donations/${returnedId}/release`, {}, teacher);
const releaseTwo = await post(`/api/teacher/donations/${returnedId}/release`, {}, teacher);
assert(releaseOne.body.duplicate === false && releaseTwo.body.duplicate === true, 'teacher removal confirmation must release once');
returnedSlot = listLockers(database, true).find((slot) => slot.id === returned.body.donation.slotId)!;
assert(returnedSlot.state === 'free', 'confirmed physical removal must release the slot');

const stored = getDonation(database, firstId)!;
const photoPath = resolvePhotoPath(database, stored.photoFilename, uploadDirectory);
assert(existsSync(photoPath) && (await stat(photoPath)).size === 8, 'photo file and record must exist');
await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
database.connection.close();
database = openDatabase({ path: testPath, mode: 'demo' });
writeAndReadDatabaseCheck(database);
seedDemoStudents(database);
assert(getDonation(database, firstId)?.status === 'approved', 'donation state must persist after restart');
assert(listLockers(database).find((slot) => slot.id === 'A01')?.donation?.id === firstId, 'locker assignment must persist after restart');
assert(searchStudents(database, 'DEMO006')[0].balance === 201, 'M3 initialization must preserve M2 balance');
assert(getLedger(database, demoSix.id).reduce((sum: number, entry: any) => sum + Number(entry.amount), 0) === 201, 'M2 ledger must remain unchanged by migration');
database.connection.close();

console.log(JSON.stringify({ ok: true, testPath, uploadDirectory, checks: [
  'upload', 'single-and-continue', 'create-idempotency', 'concurrent-fifo', 'zone-full-atomicity', 'restart-persistence',
  'no-early-points', 'review-idempotency', 'cancel-release-once', 'returned-holds-slot', 'authorization', 'm2-preserved',
] }));
