import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeDonation, agentToolDefinitions, chatWithAgent, enqueueCartoonJob, executeAgentTool, parseVisionResult, runNextCartoonJob } from './ai-service.js';
import { createAppServer } from './app.js';
import { getLedger, openDatabase, searchStudents, writeAndReadDatabaseCheck } from './database.js';
import { createDonation, getDonation, listLockers, markDeposited, reviewDonation } from './donations.js';
import { OpenRouterClient, type AiTransport } from './openrouter.js';
import { seedDemoStudents } from './seed.js';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`M5 check failed: ${message}`); }
const suffix = `${Date.now()}-${process.pid}`;
const testPath = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m5-${suffix}.sqlite`);
const uploadDirectory = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m5-uploads-${suffix}`);
const generatedDirectory = resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m5-generated-${suffix}`);
await mkdir(uploadDirectory, { recursive: true }); await mkdir(generatedDirectory, { recursive: true });
const database = openDatabase({ path: testPath, mode: 'demo' }); writeAndReadDatabaseCheck(database); seedDemoStudents(database);
const students = Object.fromEntries(searchStudents(database, 'DEMO').map((student) => [student.studentId, student]));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let visionCalls = 0; let imageCalls = 0; let agentCalls = 0; let failImages = false;
const mockTransport: AiTransport = async (url, init) => {
  const authorization = new Headers(init.headers).get('Authorization'); assert(authorization === 'Bearer m5-test-secret-never-return', 'mock must receive server-only key');
  if (url.includes('/images/models/')) return Response.json({ endpoints: [{ supported_parameters: { input_references: { type: 'array' }, aspect_ratio: { type: 'enum' }, resolution: { type: 'enum' } } }] });
  const body = JSON.parse(String(init.body ?? '{}')) as Record<string, any>;
  if (url.endsWith('/images')) {
    imageCalls += 1;
    if (failImages) return Response.json({ error: { message: 'mock image unavailable' } }, { status: 503 });
    assert(body.input_references?.[0]?.image_url?.url?.startsWith('data:image/'), 'image edit must use private base64 reference');
    return Response.json({ id: 'img-test', data: [{ b64_json: png.split(',')[1] }], usage: { cost: 0.02 } });
  }
  const isVision = JSON.stringify(body.messages).includes('识别此单件物品');
  if (isVision) {
    visionCalls += 1;
    return Response.json({ id: 'vision-test', choices: [{ message: { role: 'assistant', content: JSON.stringify({ object_name: '测试图书', category: 'book', condition: 'good', visible_issues: ['封面轻微磨损'], manual_checks: ['是否缺页'], confidence: 0.92 }) } }], usage: { prompt_tokens: 10, completion_tokens: 8, cost: 0.001 } });
  }
  agentCalls += 1;
  if (JSON.stringify(body.messages).includes('tool-flow')) {
    const toolMessage = body.messages.find((message: any) => message.role === 'tool');
    if (!toolMessage) return Response.json({ id: 'agent-tool-test', choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_my_points', arguments: '{}' } }] } }], usage: { cost: 0.001 } });
    return Response.json({ id: 'agent-tool-final', choices: [{ message: { role: 'assistant', content: `余额数据：${toolMessage.content}` } }], usage: { cost: 0.001 } });
  }
  return Response.json({ id: 'agent-test', choices: [{ message: { role: 'assistant', content: '查询完成。' } }], usage: { cost: 0.001 } });
};
const client = new OpenRouterClient(database, { apiKey: 'm5-test-secret-never-return', baseUrl: 'https://mock.openrouter.local/api/v1',
  visionModel: 'mock/vision', agentModel: 'mock/agent', imageModel: 'mock/image', dailyBudgetUsd: 1, timeoutMs: 5000 }, mockTransport);

const parsed = parseVisionResult(JSON.stringify({ object_name: '球', category: 'not-real', condition: 'unknown', visible_issues: [], manual_checks: [], confidence: 4 }));
assert(parsed.category === 'book' && parsed.condition === 'good' && parsed.confidence === 1, 'unknown AI category/condition must safely fall back');
let invalidFailed = false; try { parseVisionResult('not-json'); } catch { invalidFailed = true; }
assert(invalidFailed, 'invalid vision JSON must fail safely');

const base = { studentId: students.DEMO001.id, name: 'AI测试图书', categoryId: 'book', condition: 'normal', description: '完整情况交教师核验', zone: 'A' as const, photoDataUrl: png, uploadDirectory };
const donation = createDonation(database, { ...base, idempotencyKey: 'm5-vision-donation-0001' }).donation;
database.connection.prepare("UPDATE donations SET ai_status = 'pending' WHERE id = ?").run(donation.id);
await Promise.all([analyzeDonation(database, client, donation.id, uploadDirectory), analyzeDonation(database, client, donation.id, uploadDirectory)]);
await analyzeDonation(database, client, donation.id, uploadDirectory);
const analyzed = getDonation(database, donation.id)!;
assert(analyzed.aiStatus === 'succeeded' && analyzed.aiSuggestedPoints === 10 && analyzed.suggestedPoints === 10 && visionCalls === 1, 'vision result must be system-priced and cached');
const usageAfterVision = database.connection.prepare('SELECT COUNT(*) AS count FROM ai_usage').get() as { count: number };
assert(usageAfterVision.count === 1, 'cached analysis must not create another billable task');
const invalidVisionTransport: AiTransport = async () => Response.json({ choices: [{ message: { content: 'invalid-json' } }] });
const invalidVisionClient = new OpenRouterClient(database, { ...client.config, visionModel: 'mock/invalid-vision' }, invalidVisionTransport);
const visionFailed = createDonation(database, { ...base, name: '识别失败规则回退', idempotencyKey: 'm5-vision-fail-0005' }).donation;
database.connection.prepare("UPDATE donations SET ai_status = 'pending' WHERE id = ?").run(visionFailed.id);
await analyzeDonation(database, invalidVisionClient, visionFailed.id, uploadDirectory);
assert(getDonation(database, visionFailed.id)?.aiStatus === 'failed' && getDonation(database, visionFailed.id)?.suggestedPoints === 10, 'vision failure must preserve rule estimate and donation');
enqueueCartoonJob(database, client, visionFailed.id);
assert(!database.connection.prepare('SELECT id FROM cartoon_jobs WHERE donation_id = ?').get(visionFailed.id), 'unapproved donation must not create cartoon job');
markDeposited(database, donation.id, students.DEMO001.id); const before = students.DEMO001.balance;
reviewDonation(database, donation.id, { action: 'approve', finalPoints: 17 });
assert(searchStudents(database, 'DEMO001')[0].balance === before + 17, 'teacher final points must override AI suggestion');

enqueueCartoonJob(database, client, donation.id);
await runNextCartoonJob(database, client, uploadDirectory, generatedDirectory);
assert(getDonation(database, donation.id)?.cartoonUrl && imageCalls === 1, 'approved donation must generate one cached cartoon');
const second = createDonation(database, { ...base, name: '同图缓存物品', idempotencyKey: 'm5-cartoon-cache-0002' }).donation;
markDeposited(database, second.id, students.DEMO001.id); reviewDonation(database, second.id, { action: 'approve', finalPoints: 9 }); enqueueCartoonJob(database, client, second.id);
await runNextCartoonJob(database, client, uploadDirectory, generatedDirectory);
assert(getDonation(database, second.id)?.cartoonUrl && imageCalls === 1, 'same image/model/prompt must hit cache without image request');

const failed = createDonation(database, { ...base, name: '图片失败仍上架', photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=', idempotencyKey: 'm5-cartoon-fail-0003' }).donation;
markDeposited(database, failed.id, students.DEMO001.id); reviewDonation(database, failed.id, { action: 'approve', finalPoints: 8 }); enqueueCartoonJob(database, client, failed.id);
failImages = true; await runNextCartoonJob(database, client, uploadDirectory, generatedDirectory); failImages = false;
for (let retry = 0; retry < 2; retry += 1) {
  database.connection.prepare('UPDATE cartoon_jobs SET next_attempt_at = ? WHERE donation_id = ?').run(new Date(0).toISOString(), failed.id);
  failImages = true; await runNextCartoonJob(database, client, uploadDirectory, generatedDirectory); failImages = false;
}
const failedJob = database.connection.prepare('SELECT status, attempts FROM cartoon_jobs WHERE donation_id = ?').get(failed.id) as { status: string; attempts: number };
assert(getDonation(database, failed.id)?.status === 'approved' && failedJob.status === 'failed' && failedJob.attempts === 3, 'cartoon may retry twice but failure must not affect approval');
const callsBeforeLocker = visionCalls + imageCalls + agentCalls; listLockers(database); listLockers(database);
assert(callsBeforeLocker === visionCalls + imageCalls + agentCalls, 'locker refresh must never call AI');

const toolNames = agentToolDefinitions().map((tool) => tool.function.name);
assert(!toolNames.some((name) => /add|update|delete|redeem|review|cancel/i.test(name)), 'agent must expose no write tool');
const mine = executeAgentTool(database, students.DEMO001.id, 'get_my_donations', {}) as Array<Record<string, unknown>>;
assert(mine.length === 4 && !JSON.stringify(mine).includes('studentNumber'), 'agent donation tool must only return current student records without school roster');
const other = executeAgentTool(database, students.DEMO002.id, 'get_my_donations', {}) as unknown[];
assert(other.length === 0, 'agent cannot access another student donations through current identity');
const toolAnswer = await chatWithAgent(database, client, students.DEMO001.id, { message: 'tool-flow：我还有多少积分？' });
assert(toolAnswer.reply.includes(String(searchStudents(database, 'DEMO001')[0].balance)), 'agent must execute server-side tool and answer from its result');

const disabledClient = new OpenRouterClient(database, { ...client.config, apiKey: undefined }, mockTransport);
const server = createAppServer(database, { teacherPassword: 'm5-test-teacher-only', uploadDirectory, generatedDirectory, aiClient: disabledClient, backgroundAi: false });
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('address unavailable');
const origin = `http://127.0.0.1:${address.port}`;
async function request(path: string, options: RequestInit = {}, cookie?: string) { const response = await fetch(`${origin}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers } }); const text = await response.text(); return { response, text, body: text ? JSON.parse(text) as Record<string, any> : {}, cookie: response.headers.get('set-cookie')?.split(';')[0] }; }
const post = (path: string, body: unknown, cookie?: string) => request(path, { method: 'POST', body: JSON.stringify(body) }, cookie);
const health = await request('/api/health'); assert(health.response.status === 200 && health.body.ai.state === 'disabled', 'no-key server must remain healthy');
assert(!health.text.includes('m5-test-secret') && !health.text.includes('OPENROUTER_API_KEY'), 'API key must never be returned to frontend');
const studentCookie = (await post('/api/auth/student', { name: '演示同学01', studentId: 'DEMO001' })).cookie!;
assert((await post('/api/student/assistant', { message: '多少积分' })).response.status === 401, 'unauthenticated assistant access must fail');
const disabledAgent = await post('/api/student/assistant', { message: '多少积分' }, studentCookie);
assert(disabledAgent.response.status === 503 && disabledAgent.body.code === 'disabled', 'assistant must degrade clearly without key');
const noKeyDonation = await post('/api/student/donations', { name: '无Key也可捐赠', categoryId: 'book', condition: 'normal', description: '', zone: 'B', photoDataUrl: png, idempotencyKey: 'm5-no-key-donation-0004' }, studentCookie);
assert(noKeyDonation.response.status === 201 && noKeyDonation.body.donation.aiStatus === 'disabled', 'no-key donation must still succeed with rule estimate');
await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));

const beforeBudgetCalls = visionCalls + imageCalls + agentCalls;
const budgetClient = new OpenRouterClient(database, { ...client.config, dailyBudgetUsd: 0 }, mockTransport);
let budgetStopped = false; try { await budgetClient.chat('agent', budgetClient.config.agentModel, { messages: [{ role: 'user', content: 'test' }] }); } catch { budgetStopped = true; }
assert(budgetStopped && beforeBudgetCalls === visionCalls + imageCalls + agentCalls, 'daily budget must stop new upstream calls');
assert(getLedger(database, students.DEMO001.id).filter((row: any) => row.source === 'donation').length === 3, 'M2-M4 ledger invariants must remain intact');
database.connection.close();
console.log(JSON.stringify({ ok: true, checks: ['key-not-exposed', 'disabled-degradation', 'vision-json-and-fallback', 'system-pricing-and-teacher-override', 'analysis-cache', 'cartoon-after-approval', 'cartoon-failure-isolated', 'image-cache', 'locker-zero-ai', 'agent-read-only-and-isolated', 'daily-budget', 'existing-ledger-invariants'] }, null, 2));
