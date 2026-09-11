import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { analyzeDonation, chatWithAgent, enqueueCartoonJob, getAiStatus, markDonationAiState, resolveCartoonPath, runNextCartoonJob } from './ai-service.js';
import { parseStudentCsv } from './csv.js';
import {
  addLaborReward, completeStudentOnboarding, createSession, deleteSession, findStudentForLogin, getLedger, getSession,
  getStudent, importStudents, resetStudentOnboarding, searchStudents, type AppDatabase, type SessionRecord,
} from './database.js';
import {
  cancelDonation, confirmReturnedRemoved, createDonation, DonationError, getDonation, listLockers,
  listStudentDonations, listTeacherDonations, markDeposited, resolvePhotoPath, reviewDonation,
} from './donations.js';
import {
  createLockerIssue, getRedemption, listStudentRedemptions, listTeacherIssues, listTeacherRedemptions,
  redeemDonation, resolveLockerIssue, resolveRedemptionPhotoPath,
} from './redemptions.js';
import { AiError, OpenRouterClient } from './openrouter.js';

const COOKIE_NAME = 'cycle_session';
const NATIVE_APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8',
};

type JsonObject = Record<string, unknown>;

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers,
  });
  response.end(JSON.stringify(body));
}

function readCookie(request: IncomingMessage) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(parts.join('='));
  }
  return undefined;
}

function isNativeAppRequest(request: IncomingMessage) {
  return NATIVE_APP_ORIGINS.has(request.headers.origin ?? '');
}

function cookiePolicy(request: IncomingMessage) {
  if (isNativeAppRequest(request)) return 'SameSite=None; Secure';
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  return `SameSite=Strict${forwardedProto === 'https' ? '; Secure' : ''}`;
}

function sessionCookie(token: string, request: IncomingMessage) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; ${cookiePolicy(request)}; Path=/; Max-Age=43200`;
}

function clearCookie(request: IncomingMessage) { return `${COOKIE_NAME}=; HttpOnly; ${cookiePolicy(request)}; Path=/; Max-Age=0`; }

function applyNativeCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin ?? '';
  if (!NATIVE_APP_ORIGINS.has(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Vary', 'Origin');
  return true;
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.startsWith('application/json')) throw new HttpError(415, 'content_type', '请求必须使用 JSON');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 5 * 1024 * 1024) throw new HttpError(413, 'body_too_large', '请求内容过大');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonObject; }
  catch { throw new HttpError(400, 'invalid_json', 'JSON 格式错误'); }
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) { super(message); }
}

function requireSession(database: AppDatabase, request: IncomingMessage, role: SessionRecord['role']) {
  const session = getSession(database, readCookie(request));
  if (!session || session.role !== role) throw new HttpError(401, 'unauthorized', '请先登录');
  return session;
}

function safePasswordEqual(actual: string, expected: string) {
  const left = createHash('sha256').update(actual).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function serveFrontend(pathname: string, response: ServerResponse) {
  const dist = resolve('dist');
  const requested = join(dist, pathname === '/' ? 'index.html' : pathname);
  if (pathname.startsWith('/assets/') && (!existsSync(requested) || !statSync(requested).isFile())) {
    sendJson(response, 404, { ok: false, error: 'asset_not_found' }); return;
  }
  const file = existsSync(requested) && statSync(requested).isFile() ? requested : join(dist, 'index.html');
  if (!existsSync(file)) { sendJson(response, 404, { ok: false, error: 'frontend_not_built' }); return; }
  const name = file.replace(/\\/g, '/').split('/').at(-1) ?? '';
  const cacheControl = name === 'sw.js' || name === 'manifest.webmanifest' || name === 'index.html'
    ? 'no-cache' : file.replace(/\\/g, '/').includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400';
  response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' });
  createReadStream(file).pipe(response);
}

function donationHttpError(error: unknown) {
  if (!(error instanceof DonationError)) return error;
  const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403
    : ['zone_full', 'slot_conflict', 'idempotency_conflict', 'invalid_status', 'insufficient_points', 'already_redeemed', 'not_available'].includes(error.code) ? 409 : 400;
  return new HttpError(status, error.code, error.message, error.details);
}

export function createAppServer(database: AppDatabase, options: {
  teacherPassword?: string; uploadDirectory?: string; generatedDirectory?: string; aiClient?: OpenRouterClient; backgroundAi?: boolean;
} = {}) {
  const teacherPassword = options.teacherPassword ?? process.env.TEACHER_PASSWORD;
  const aiClient = options.aiClient ?? new OpenRouterClient(database);
  let cartoonRunnerActive = false;
  const runCartoons = () => {
    if (cartoonRunnerActive || options.backgroundAi === false) return;
    cartoonRunnerActive = true;
    void runNextCartoonJob(database, aiClient, options.uploadDirectory, options.generatedDirectory).then((job: any) => {
      cartoonRunnerActive = false;
      if (job?.status === 'pending') setTimeout(runCartoons, 1700).unref();
      else if (database.connection.prepare("SELECT 1 FROM cartoon_jobs WHERE status = 'pending' AND next_attempt_at <= ? LIMIT 1").get(new Date().toISOString())) setImmediate(runCartoons);
    }).catch(() => { cartoonRunnerActive = false; });
  };
  if (options.backgroundAi !== false) setImmediate(runCartoons);

  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      const nativeOriginAllowed = applyNativeCors(request, response);
      if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
        if (!nativeOriginAllowed) throw new HttpError(403, 'origin_not_allowed', '当前来源不允许访问');
        response.writeHead(204); response.end(); return;
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        const check = database.connection.prepare('SELECT value FROM system_checks WHERE name = ?').get('m1-read-write') as { value: string } | undefined;
        sendJson(response, 200, { ok: true, service: 'campus-cycle-station-api', mode: database.mode,
          database: { ok: check?.value === 'ok', engine: 'sqlite' }, ai: { state: getAiStatus(database, aiClient.config).state } });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        const session = getSession(database, readCookie(request));
        const student = session?.role === 'student' && session.studentId ? getStudent(database, session.studentId) : undefined;
        sendJson(response, 200, { authenticated: Boolean(session), role: session?.role ?? null, student: student ?? null, mode: database.mode });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/lockers') {
        sendJson(response, 200, { lockers: listLockers(database) });
        return;
      }

      const photoMatch = /^\/api\/donations\/(\d+)\/photo$/.exec(url.pathname);
      if (request.method === 'GET' && photoMatch) {
        const donation = getDonation(database, Number(photoMatch[1]));
        if (!donation) throw new HttpError(404, 'not_found', '照片不存在');
        const session = getSession(database, readCookie(request));
        const canView = donation.status === 'approved' || session?.role === 'teacher'
          || (session?.role === 'student' && session.studentId === donation.studentId);
        if (!canView) throw new HttpError(403, 'forbidden', '无权查看该照片');
        const path = resolvePhotoPath(database, donation.photoFilename, options.uploadDirectory);
        if (!existsSync(path)) throw new HttpError(404, 'photo_missing', '照片文件不存在');
        response.writeHead(200, { 'Content-Type': donation.photoMime, 'Content-Length': String(statSync(path).size),
          'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(path).pipe(response);
        return;
      }

      const redemptionPhotoMatch = /^\/api\/redemptions\/(\d+)\/photo$/.exec(url.pathname);
      if (request.method === 'GET' && redemptionPhotoMatch) {
        const redemption = getRedemption(database, Number(redemptionPhotoMatch[1]));
        if (!redemption) throw new HttpError(404, 'not_found', '领取照片不存在');
        const session = getSession(database, readCookie(request));
        if (session?.role !== 'teacher' && !(session?.role === 'student' && session.studentId === redemption.studentId)) throw new HttpError(403, 'forbidden', '无权查看该领取照片');
        const path = resolveRedemptionPhotoPath(database, redemption.photoFilename, options.uploadDirectory);
        if (!existsSync(path)) throw new HttpError(404, 'photo_missing', '照片文件不存在');
        response.writeHead(200, { 'Content-Type': redemption.photoMime, 'Content-Length': String(statSync(path).size),
          'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(path).pipe(response);
        return;
      }

      const cartoonMatch = /^\/api\/donations\/(\d+)\/cartoon$/.exec(url.pathname);
      if (request.method === 'GET' && cartoonMatch) {
        const donation = getDonation(database, Number(cartoonMatch[1]));
        if (!donation || donation.status !== 'approved' || !donation.cartoonUrl) throw new HttpError(404, 'not_found', '卡通图尚未生成');
        const path = resolveCartoonPath(database, String((database.connection.prepare('SELECT cartoon_filename FROM donations WHERE id = ?').get(donation.id) as { cartoon_filename: string }).cartoon_filename), options.generatedDirectory);
        if (!existsSync(path)) throw new HttpError(404, 'image_missing', '卡通图文件不存在');
        response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(statSync(path).size), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(path).pipe(response); return;
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/student') {
        const body = await readJson(request);
        const name = String(body.name ?? '').trim();
        const studentId = String(body.studentId ?? '').trim();
        if (!name || !studentId || name.length > 80 || studentId.length > 64) throw new HttpError(400, 'invalid_credentials', '请输入有效的姓名和学号');
        const student = findStudentForLogin(database, name, studentId);
        if (!student) throw new HttpError(401, 'invalid_credentials', '姓名与学号不匹配');
        deleteSession(database, readCookie(request));
        const token = createSession(database, 'student', student.id);
        sendJson(response, 200, { ok: true, role: 'student', student,
          onboardingRequired: student.onboardingCompletedAt === null }, { 'Set-Cookie': sessionCookie(token, request) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/teacher') {
        if (!teacherPassword) throw new HttpError(503, 'teacher_not_configured', '本地尚未配置教师口令');
        const body = await readJson(request);
        const password = String(body.password ?? '');
        if (!safePasswordEqual(password, teacherPassword)) throw new HttpError(401, 'invalid_credentials', '教师口令错误');
        deleteSession(database, readCookie(request));
        const token = createSession(database, 'teacher');
        sendJson(response, 200, { ok: true, role: 'teacher' }, { 'Set-Cookie': sessionCookie(token, request) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        deleteSession(database, readCookie(request));
        sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearCookie(request) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/student/me') {
        const session = requireSession(database, request, 'student');
        const student = getStudent(database, session.studentId!);
        if (!student) throw new HttpError(404, 'student_not_found', '学生不存在');
        sendJson(response, 200, { student, ledger: getLedger(database, student.id) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/student/onboarding/complete') {
        const session = requireSession(database, request, 'student');
        sendJson(response, 200, { ok: true, student: completeStudentOnboarding(database, session.studentId!) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/student/donations') {
        const session = requireSession(database, request, 'student');
        sendJson(response, 200, { donations: listStudentDonations(database, session.studentId!) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/student/redemptions') {
        const session = requireSession(database, request, 'student');
        sendJson(response, 200, { redemptions: listStudentRedemptions(database, session.studentId!) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/student/donations') {
        const session = requireSession(database, request, 'student');
        const body = await readJson(request);
        const name = String(body.name ?? '').trim();
        const categoryId = String(body.categoryId ?? '').trim();
        const condition = String(body.condition ?? '').trim();
        const description = String(body.description ?? '').trim();
        const zone = String(body.zone ?? '').trim() as 'A' | 'B' | 'C';
        const photoDataUrl = String(body.photoDataUrl ?? '');
        const idempotencyKey = String(body.idempotencyKey ?? '').trim();
        if (name.length < 1 || name.length > 100 || description.length > 500) throw new HttpError(400, 'invalid_donation', '名称为 1–100 字，说明最多 500 字');
        if (!['A', 'B', 'C'].includes(zone) || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new HttpError(400, 'invalid_donation', '尺寸区或请求标识无效');
        try {
          const result = createDonation(database, { studentId: session.studentId!, name, categoryId, condition, description, zone, photoDataUrl, idempotencyKey, uploadDirectory: options.uploadDirectory });
          if (!result.duplicate) {
            markDonationAiState(database, result.donation.id, Boolean(aiClient.config.apiKey), options.uploadDirectory, aiClient.config.visionModel);
            if (aiClient.config.apiKey && options.backgroundAi !== false) setImmediate(() => void analyzeDonation(database, aiClient, result.donation.id, options.uploadDirectory).catch(() => undefined));
          }
          sendJson(response, 201, { ok: true, duplicate: result.duplicate, donation: getDonation(database, result.donation.id) });
        }
        catch (error) { throw donationHttpError(error); }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/student/assistant') {
        const session = requireSession(database, request, 'student');
        const body = await readJson(request); const message = String(body.message ?? '').trim();
        if (message.length < 1 || message.length > 1000) throw new HttpError(400, 'invalid_message', '请输入 1–1000 字的问题');
        const history = Array.isArray(body.history) ? body.history.filter((item): item is { role: 'user' | 'assistant'; content: string } =>
          item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string').slice(-16) : [];
        try { sendJson(response, 200, { ok: true, ...(await chatWithAgent(database, aiClient, session.studentId!, { message, history })) }); }
        catch (error) {
          if (error instanceof AiError) throw new HttpError(error.code === 'budget_exhausted' ? 429 : 503, error.code, error.message);
          throw error;
        }
        return;
      }

      const studentAction = /^\/api\/student\/donations\/(\d+)\/(deposit|cancel)$/.exec(url.pathname);
      if (request.method === 'POST' && studentAction) {
        const session = requireSession(database, request, 'student');
        try {
          const result = studentAction[2] === 'deposit'
            ? markDeposited(database, Number(studentAction[1]), session.studentId!)
            : cancelDonation(database, Number(studentAction[1]), session.studentId!);
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) { throw donationHttpError(error); }
        return;
      }

      const redeemMatch = /^\/api\/student\/donations\/(\d+)\/redeem$/.exec(url.pathname);
      if (request.method === 'POST' && redeemMatch) {
        const session = requireSession(database, request, 'student');
        const body = await readJson(request);
        const idempotencyKey = String(body.idempotencyKey ?? '').trim();
        if (idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new HttpError(400, 'invalid_idempotency_key', '请求标识无效');
        try { sendJson(response, 200, { ok: true, ...redeemDonation(database, { studentId: session.studentId!, donationId: Number(redeemMatch[1]), idempotencyKey }) }); }
        catch (error) { throw donationHttpError(error); }
        return;
      }

      const issueMatch = /^\/api\/student\/redemptions\/(\d+)\/issues$/.exec(url.pathname);
      if (request.method === 'POST' && issueMatch) {
        const session = requireSession(database, request, 'student');
        const body = await readJson(request);
        const description = String(body.description ?? '').trim();
        const idempotencyKey = String(body.idempotencyKey ?? '').trim();
        if (description.length < 2 || description.length > 300) throw new HttpError(400, 'invalid_description', '请填写 2–300 字的异常说明');
        if (idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new HttpError(400, 'invalid_idempotency_key', '请求标识无效');
        try { sendJson(response, 201, { ok: true, ...createLockerIssue(database, { studentId: session.studentId!, redemptionId: Number(issueMatch[1]), description, idempotencyKey }) }); }
        catch (error) { throw donationHttpError(error); }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/teacher/students') {
        requireSession(database, request, 'teacher');
        const query = (url.searchParams.get('query') ?? '').trim();
        if (query.length > 80) throw new HttpError(400, 'invalid_query', '搜索内容过长');
        sendJson(response, 200, { students: searchStudents(database, query) });
        return;
      }

      const resetOnboardingMatch = /^\/api\/teacher\/students\/(\d+)\/onboarding\/reset$/.exec(url.pathname);
      if (request.method === 'POST' && resetOnboardingMatch) {
        requireSession(database, request, 'teacher');
        try {
          sendJson(response, 200, { ok: true, student: resetStudentOnboarding(database, Number(resetOnboardingMatch[1])) });
        } catch (error) {
          if ((error as Error).message === 'student not found') throw new HttpError(404, 'student_not_found', '学生不存在');
          throw error;
        }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/teacher/donations') {
        requireSession(database, request, 'teacher');
        sendJson(response, 200, { donations: listTeacherDonations(database, url.searchParams.get('status') ?? undefined) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/teacher/lockers') {
        requireSession(database, request, 'teacher');
        sendJson(response, 200, { lockers: listLockers(database, true) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/teacher/redemptions') {
        requireSession(database, request, 'teacher');
        sendJson(response, 200, { redemptions: listTeacherRedemptions(database) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/teacher/issues') {
        requireSession(database, request, 'teacher');
        sendJson(response, 200, { issues: listTeacherIssues(database) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/teacher/ai-status') {
        requireSession(database, request, 'teacher');
        sendJson(response, 200, { ai: getAiStatus(database, aiClient.config) }); return;
      }

      if (request.method === 'POST' && url.pathname === '/api/teacher/ai-test') {
        requireSession(database, request, 'teacher');
        try {
          const result = await aiClient.chat('agent', aiClient.config.agentModel, { messages: [{ role: 'user', content: '只回答：连接正常' }], max_tokens: 20 });
          sendJson(response, 200, { ok: true, model: aiClient.config.agentModel, reply: String(result.choices?.[0]?.message?.content ?? '').slice(0, 80) });
        } catch (error) { if (error instanceof AiError) throw new HttpError(503, error.code, error.message); throw error; }
        return;
      }

      const analyzeMatch = /^\/api\/teacher\/donations\/(\d+)\/analyze$/.exec(url.pathname);
      if (request.method === 'POST' && analyzeMatch) {
        requireSession(database, request, 'teacher');
        try { sendJson(response, 200, { ok: true, donation: await analyzeDonation(database, aiClient, Number(analyzeMatch[1]), options.uploadDirectory, true) }); }
        catch (error) { if (error instanceof AiError) throw new HttpError(503, error.code, error.message); throw donationHttpError(error); }
        return;
      }

      const resolveIssueMatch = /^\/api\/teacher\/issues\/(\d+)\/resolve$/.exec(url.pathname);
      if (request.method === 'POST' && resolveIssueMatch) {
        requireSession(database, request, 'teacher');
        try { sendJson(response, 200, { ok: true, ...resolveLockerIssue(database, Number(resolveIssueMatch[1])) }); }
        catch (error) { throw donationHttpError(error); }
        return;
      }

      const teacherAction = /^\/api\/teacher\/donations\/(\d+)\/(review|release)$/.exec(url.pathname);
      if (request.method === 'POST' && teacherAction) {
        requireSession(database, request, 'teacher');
        const body = await readJson(request);
        const action = String(body.action ?? '');
        if (teacherAction[2] === 'review' && !['approve', 'return'].includes(action)) throw new HttpError(400, 'invalid_action', '审核操作无效');
        try {
          const result = teacherAction[2] === 'release'
            ? confirmReturnedRemoved(database, Number(teacherAction[1]))
            : reviewDonation(database, Number(teacherAction[1]), {
              action: action as 'approve' | 'return', finalPoints: Number(body.finalPoints), reason: String(body.reason ?? ''),
            });
          if (teacherAction[2] === 'review' && action === 'approve' && aiClient.config.apiKey) { enqueueCartoonJob(database, aiClient, Number(teacherAction[1])); setImmediate(runCartoons); }
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) { throw donationHttpError(error); }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/teacher/import-csv') {
        requireSession(database, request, 'teacher');
        const body = await readJson(request);
        const csv = String(body.csv ?? '');
        let rows;
        try { rows = parseStudentCsv(csv); }
        catch (error) { throw new HttpError(400, 'invalid_csv', (error as Error).message); }
        sendJson(response, 200, { ok: true, ...importStudents(database, rows, 20) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/teacher/rewards') {
        requireSession(database, request, 'teacher');
        const body = await readJson(request);
        const studentId = Number(body.studentId);
        const amount = Number(body.amount);
        const reason = String(body.reason ?? '').trim();
        const idempotencyKey = String(body.idempotencyKey ?? '').trim();
        if (!Number.isInteger(studentId) || !Number.isInteger(amount) || amount <= 0 || amount > 10000) throw new HttpError(400, 'invalid_amount', '积分必须是 1–10000 的整数');
        if (reason.length < 2 || reason.length > 200) throw new HttpError(400, 'invalid_reason', '请填写 2–200 字的原因');
        if (idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new HttpError(400, 'invalid_idempotency_key', '请求标识无效');
        try { sendJson(response, 200, { ok: true, ...addLaborReward(database, { studentId, amount, reason, idempotencyKey }) }); }
        catch (error) {
          if ((error as Error).message === 'idempotency conflict') throw new HttpError(409, 'idempotency_conflict', '请求标识已用于其他奖励');
          if ((error as Error).message === 'student not found') throw new HttpError(404, 'student_not_found', '学生不存在');
          throw error;
        }
        return;
      }

      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) { serveFrontend(url.pathname, response); return; }
      sendJson(response, 404, { ok: false, code: 'not_found', message: '接口不存在' });
    })().catch((error: unknown) => {
      if (response.headersSent) { response.end(); return; }
      if (error instanceof HttpError) sendJson(response, error.status, { ok: false, code: error.code, message: error.message, ...error.details });
      else { console.error(error); sendJson(response, 500, { ok: false, code: 'internal_error', message: '服务器处理失败' }); }
    });
  });
}
