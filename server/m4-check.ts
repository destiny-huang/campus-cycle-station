import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAppServer } from './app.js';
import { addLaborReward, getLedger, importStudents, openDatabase, searchStudents, writeAndReadDatabaseCheck } from './database.js';
import { createDonation, getDonation, listLockers, markDeposited, reviewDonation } from './donations.js';
import { getRedemption, listStudentRedemptions, listTeacherIssues, listTeacherRedemptions } from './redemptions.js';
import { seedDemoStudents } from './seed.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`M4 check failed: ${message}`);
}

const suffix = `${Date.now()}-${process.pid}`;
const testPath = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m4-${suffix}.sqlite`);
const uploadDirectory = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m4-uploads-${suffix}`);
await mkdir(uploadDirectory, { recursive: true });
let database = openDatabase({ path: testPath, mode: 'demo' });
writeAndReadDatabaseCheck(database);
seedDemoStudents(database);
const students = Object.fromEntries(searchStudents(database, 'DEMO').map((student) => [student.studentId, student]));
addLaborReward(database, { studentId: students.DEMO006.id, amount: 1, reason: '保留 M2 奖励', idempotencyKey: 'm4-preserve-m2-reward-0001' });
importStudents(database, [{ name: '低余额同学', studentId: 'LOW001', className: '测试班' }], 20);
const lowBalanceStudent = searchStudents(database, 'LOW001')[0];
const photoDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

let sequence = 0;
function makeApproved(zone: 'A' | 'B' | 'C', price: number, label: string) {
  sequence += 1;
  const created = createDonation(database, {
    studentId: students.DEMO001.id, name: label, categoryId: 'book', condition: 'normal', description: 'M4 独立测试', zone,
    photoDataUrl, idempotencyKey: `m4-create-approved-${String(sequence).padStart(4, '0')}`, uploadDirectory,
  }).donation;
  markDeposited(database, created.id, students.DEMO001.id);
  reviewDonation(database, created.id, { action: 'approve', finalPoints: price });
  return getDonation(database, created.id)!;
}

const cItems = Array.from({ length: 20 }, (_, index) => makeApproved('C', 10, `C 区物品 ${index + 1}`));
const expensive = makeApproved('A', 300, '高积分物品');
const lowOne = makeApproved('B', 15, '并发物品一');
const lowTwo = makeApproved('B', 15, '并发物品二');
const pending = createDonation(database, {
  studentId: students.DEMO002.id, name: '尚未投放物品', categoryId: 'book', condition: 'normal', description: '', zone: 'A',
  photoDataUrl, idempotencyKey: 'm4-pending-own-donation-0001', uploadDirectory,
}).donation;

const server = createAppServer(database, { teacherPassword: 'm4-local-test-only', uploadDirectory });
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
const recipientOne = await loginStudent('演示同学02', 'DEMO002');
const recipientTwo = await loginStudent('演示同学03', 'DEMO003');
const lowCookie = await loginStudent('低余额同学', 'LOW001');
const teacher = (await post('/api/auth/teacher', { password: 'm4-local-test-only' })).cookie!;

assert((await post(`/api/student/donations/${cItems[0].id}/redeem`, { idempotencyKey: 'm4-unauthorized-redeem-0001' })).response.status === 401, 'unauthenticated user cannot redeem');
assert((await post(`/api/student/donations/${pending.id}/redeem`, { idempotencyKey: 'm4-pending-redeem-0001' }, recipientOne)).response.status === 409, 'pending own donation cannot be redeemed');

const balanceBefore = searchStudents(database, 'DEMO002')[0].balance;
const redeemBody = { idempotencyKey: 'm4-normal-redeem-0001' };
const normal = await post(`/api/student/donations/${cItems[0].id}/redeem`, redeemBody, recipientOne);
const normalRetry = await post(`/api/student/donations/${cItems[0].id}/redeem`, redeemBody, recipientOne);
assert(normal.response.status === 200 && normal.body.duplicate === false && normalRetry.body.duplicate === true, 'same redemption request must deduct once');
assert(normal.body.redemption.pointsSpent === 10 && normal.body.redemption.slotId === 'C01', 'redemption must snapshot price and slot');
const recipientAfter = searchStudents(database, 'DEMO002')[0];
assert(recipientAfter.balance === balanceBefore - 10, 'normal redemption must deduct exact price');
assert(getLedger(database, recipientAfter.id).filter((entry: any) => entry.source === 'redemption').length === 1, 'normal redemption must write one debit ledger row');
assert(getDonation(database, cItems[0].id)?.status === 'redeemed', 'redeemed item must be finalized');
assert(listLockers(database).find((slot) => slot.id === 'C01')?.state === 'free', 'successful redemption must release its slot');

const insufficientBefore = {
  balance: lowBalanceStudent.balance,
  ledger: getLedger(database, lowBalanceStudent.id).length,
  redemptions: listStudentRedemptions(database, lowBalanceStudent.id).length,
  slotState: listLockers(database).find((slot) => slot.id === expensive.slotId)?.state,
};
const insufficient = await post(`/api/student/donations/${expensive.id}/redeem`, { idempotencyKey: 'm4-insufficient-redeem-0001' }, lowCookie);
assert(insufficient.response.status === 409 && insufficient.body.currentBalance === 20 && insufficient.body.requiredPoints === 300, 'insufficient response must show current and required points');
assert(searchStudents(database, 'LOW001')[0].balance === insufficientBefore.balance, 'insufficient balance must not change');
assert(getLedger(database, lowBalanceStudent.id).length === insufficientBefore.ledger, 'insufficient attempt must not write ledger');
assert(listStudentRedemptions(database, lowBalanceStudent.id).length === insufficientBefore.redemptions, 'insufficient attempt must not create redemption');
assert(getDonation(database, expensive.id)?.status === 'approved' && listLockers(database).find((slot) => slot.id === expensive.slotId)?.state === insufficientBefore.slotState, 'insufficient attempt must keep item and slot unchanged');

const raceBalancesBefore = searchStudents(database, 'DEMO002')[0].balance + searchStudents(database, 'DEMO003')[0].balance;
const race = await Promise.all([
  post(`/api/student/donations/${cItems[1].id}/redeem`, { idempotencyKey: 'm4-race-redeem-student-0001' }, recipientOne),
  post(`/api/student/donations/${cItems[1].id}/redeem`, { idempotencyKey: 'm4-race-redeem-student-0002' }, recipientTwo),
]);
assert(race.filter((result) => result.response.status === 200).length === 1 && race.filter((result) => result.response.status === 409).length === 1, 'two students racing one item must have one winner');
const raceBalancesAfter = searchStudents(database, 'DEMO002')[0].balance + searchStudents(database, 'DEMO003')[0].balance;
assert(raceBalancesAfter === raceBalancesBefore - 10, 'race loser must not be charged');
assert(listStudentRedemptions(database, students.DEMO002.id).filter((entry) => entry.donationId === cItems[1].id).length
  + listStudentRedemptions(database, students.DEMO003.id).filter((entry) => entry.donationId === cItems[1].id).length === 1,
  'raced item must have exactly one redemption');

const lowConcurrent = await Promise.all([
  post(`/api/student/donations/${lowOne.id}/redeem`, { idempotencyKey: 'm4-low-concurrent-redeem-0001' }, lowCookie),
  post(`/api/student/donations/${lowTwo.id}/redeem`, { idempotencyKey: 'm4-low-concurrent-redeem-0002' }, lowCookie),
]);
assert(lowConcurrent.filter((result) => result.response.status === 200).length === 1
  && lowConcurrent.filter((result) => result.response.status === 409).length === 1,
  'same account concurrent redemptions must not overspend');
assert(searchStudents(database, 'LOW001')[0].balance === 5, 'concurrent redemptions must never make balance negative');
assert((await post(`/api/student/donations/${cItems[0].id}/redeem`, { idempotencyKey: 'm4-already-redeemed-0001' }, recipientTwo)).response.status === 409,
  'redeemed item cannot be redeemed again');

const replacement = createDonation(database, {
  studentId: students.DEMO001.id, name: '复用 C01 的新物品', categoryId: 'book', condition: 'normal', description: '', zone: 'C',
  photoDataUrl, idempotencyKey: 'm4-fifo-replacement-0001', uploadDirectory,
}).donation;
assert(replacement.slotId === 'C01', 'released locker must return to the FIFO tail and be reused after older free slots are exhausted');
assert(listStudentRedemptions(database, students.DEMO002.id).find((entry) => entry.donationId === cItems[0].id)?.slotId === 'C01',
  'redemption history must keep the original locker after reuse');

const redemptionId = Number(normal.body.redemption.id);
const issuePayload = { description: '打开柜门后没有看到物品', idempotencyKey: 'm4-locker-issue-create-0001' };
const issue = await post(`/api/student/redemptions/${redemptionId}/issues`, issuePayload, recipientOne);
const issueRetry = await post(`/api/student/redemptions/${redemptionId}/issues`, issuePayload, recipientOne);
assert(issue.response.status === 201 && issue.body.duplicate === false && issueRetry.body.duplicate === true,
  'locker issue retry must create only one record');
assert((await post(`/api/student/redemptions/${redemptionId}/issues`, {
  description: '尝试反馈他人的记录', idempotencyKey: 'm4-locker-issue-forbidden-0001',
}, recipientTwo)).response.status === 403, 'student cannot report another student redemption');
const teacherIssues = await request('/api/teacher/issues', {}, teacher);
assert(teacherIssues.response.status === 200 && teacherIssues.body.issues.some((entry: any) => entry.id === issue.body.issue.id && entry.status === 'open'),
  'teacher must see open locker issue');
const resolved = await post(`/api/teacher/issues/${issue.body.issue.id}/resolve`, {}, teacher);
const resolvedRetry = await post(`/api/teacher/issues/${issue.body.issue.id}/resolve`, {}, teacher);
assert(resolved.response.status === 200 && resolved.body.duplicate === false && resolvedRetry.body.duplicate === true,
  'teacher issue resolution must be idempotent');
assert((await request(`/api/redemptions/${redemptionId}/photo`, {}, recipientOne)).response.status === 200
  && (await request(`/api/redemptions/${redemptionId}/photo`, {}, teacher)).response.status === 200
  && (await request(`/api/redemptions/${redemptionId}/photo`)).response.status === 403,
  'redemption snapshot photo must be protected for owner and teacher');

await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
database.connection.close();

const reopened = openDatabase({ path: testPath, mode: 'demo' });
seedDemoStudents(reopened);
assert(searchStudents(reopened, 'DEMO006')[0].balance === 201, 'restart and initialization must preserve DEMO006 balance');
assert(getLedger(reopened, students.DEMO006.id).reduce((sum: number, entry: any) => sum + entry.amount, 0) === 201,
  'restart and initialization must preserve existing point ledger');
assert(listStudentRedemptions(reopened, students.DEMO002.id).find((entry) => entry.donationId === cItems[0].id)?.slotId === 'C01',
  'redemption snapshot must survive restart');
assert(getDonation(reopened, replacement.id)?.slotId === 'C01', 'locker reuse must survive restart');
assert(listTeacherIssues(reopened).find((entry) => entry.id === issue.body.issue.id)?.status === 'resolved',
  'resolved locker issue must survive restart');
reopened.connection.close();

console.log(JSON.stringify({ ok: true, checks: [
  'normal redemption and exact debit', 'insufficient balance atomicity', 'same-item concurrency',
  'idempotent retry', 'same-account concurrent spending', 'FIFO release and immutable history',
  'authentication and unavailable status', 'locker issue workflow', 'restart preservation',
] }, null, 2));
