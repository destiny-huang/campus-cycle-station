import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { AppDatabase } from './database.js';
import { getDonation, listStudentDonations, resolvePhotoPath } from './donations.js';
import { listStudentRedemptions } from './redemptions.js';
import { AiError, DEFAULT_MODELS, getAiStatus, OpenRouterClient } from './openrouter.js';

const VISION_PROMPT_VERSION = 'vision-v1';
const CARTOON_PROMPT_VERSION = 'cartoon-v1';
const allowedCategories = ['writing', 'consumable', 'drawing', 'notebook', 'pencil_case', 'book', 'materials', 'puzzle', 'sports', 'durable'] as const;
const conditionMap = { new: 'near_new', excellent: 'near_new', good: 'normal', used: 'worn_but_complete' } as const;
const pointsTemplate = JSON.parse(readFileSync(resolve('config/points-template.example.json'), 'utf8')) as {
  template_version: string; condition_multipliers: Record<string, number>; categories: Array<{ id: string; name: string; base_points: number }>;
};

export type VisionResult = {
  objectName: string; category: string; condition: keyof typeof conditionMap; visibleIssues: string[];
  manualChecks: string[]; confidence: number; basePoints: number; multiplier: number; suggestedPoints: number;
};

function safeReason(error: unknown) {
  if (error instanceof AiError) return error.message.slice(0, 280);
  return 'AI 返回内容无法使用';
}

function contentText(body: Record<string, any>) {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => typeof item?.text === 'string' ? item.text : '').join('');
  throw new AiError('invalid_response', 'AI 未返回有效内容');
}

export function parseVisionResult(text: string, fallbackCategory = 'book'): VisionResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(cleaned) as Record<string, unknown>; }
  catch { throw new AiError('invalid_response', 'AI 识别结果格式无效'); }
  const safeFallback = allowedCategories.includes(fallbackCategory as typeof allowedCategories[number]) ? fallbackCategory : 'book';
  const category = allowedCategories.includes(raw.category as typeof allowedCategories[number]) ? String(raw.category) : safeFallback;
  const condition = Object.hasOwn(conditionMap, String(raw.condition)) ? String(raw.condition) as keyof typeof conditionMap : 'good';
  const objectName = typeof raw.object_name === 'string' && raw.object_name.trim() ? raw.object_name.trim().slice(0, 100) : '照片中的物品';
  const stringList = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 100)).slice(0, 8) : [];
  const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  const categoryConfig = pointsTemplate.categories.find((item) => item.id === category)!;
  const multiplier = pointsTemplate.condition_multipliers[conditionMap[condition]];
  return { objectName, category, condition, visibleIssues: stringList(raw.visible_issues), manualChecks: stringList(raw.manual_checks), confidence,
    basePoints: categoryConfig.base_points, multiplier, suggestedPoints: Math.floor(categoryConfig.base_points * multiplier + 0.5) };
}

export function markDonationAiState(database: AppDatabase, donationId: number, configured: boolean, uploadDirectory?: string, model?: string) {
  const donation = getDonation(database, donationId);
  if (!donation) return;
  const target = configured ? 'pending' : 'disabled';
  database.connection.prepare(`UPDATE donations SET ai_status = ?, ai_model = ?, ai_prompt_version = ?, photo_sha256 = ? WHERE id = ? AND ai_status IN ('disabled', 'failed')`)
    .run(target, model ?? process.env.OPENROUTER_VISION_MODEL ?? DEFAULT_MODELS.vision, VISION_PROMPT_VERSION,
      createHash('sha256').update(readFileSync(resolvePhotoPath(database, donation.photoFilename, uploadDirectory))).digest('hex'), donationId);
}

export async function analyzeDonation(database: AppDatabase, client: OpenRouterClient, donationId: number, uploadDirectory?: string, force = false) {
  const donation = getDonation(database, donationId);
  if (!donation) throw new Error('donation not found');
  if (!force && donation.aiStatus === 'succeeded') return donation;
  const claimed = force
    ? database.connection.prepare(`UPDATE donations SET ai_status = 'running', ai_error = NULL WHERE id = ? AND ai_status != 'running'`).run(donationId)
    : database.connection.prepare(`UPDATE donations SET ai_status = 'running', ai_error = NULL WHERE id = ? AND ai_status IN ('pending', 'failed')`).run(donationId);
  if (Number(claimed.changes) !== 1) return getDonation(database, donationId)!;
  let aiResponse: Record<string, any> | undefined;
  try {
    const photoSha = donation.photoSha256 || createHash('sha256').update(readFileSync(resolvePhotoPath(database, donation.photoFilename, uploadDirectory))).digest('hex');
    const cacheKey = createHash('sha256').update(`${photoSha}:${client.config.visionModel}:${VISION_PROMPT_VERSION}`).digest('hex');
    const cached = !force ? database.connection.prepare('SELECT result_json, suggested_points FROM vision_cache WHERE cache_key = ?').get(cacheKey) as { result_json: string; suggested_points: number } | undefined : undefined;
    if (cached) {
      database.connection.prepare(`UPDATE donations SET ai_status = 'succeeded', ai_model = ?, ai_result_json = ?, ai_error = NULL,
        ai_analyzed_at = ?, ai_prompt_version = ?, ai_suggested_points = ? WHERE id = ?`)
        .run(client.config.visionModel, cached.result_json, new Date().toISOString(), VISION_PROMPT_VERSION, cached.suggested_points, donationId);
      return getDonation(database, donationId)!;
    }
    const image = readFileSync(resolvePhotoPath(database, donation.photoFilename, uploadDirectory));
    const response = await client.chat('vision', client.config.visionModel, {
      messages: [{ role: 'system', content: '你是校园循环站物品照片识别器。只陈述照片可见信息；不可见的完整性、缺页、配件和功能状态必须放入manual_checks。仅输出JSON。' },
        { role: 'user', content: [{ type: 'text', text: `识别此单件物品。category只能为${allowedCategories.join(',')}；condition只能为new,excellent,good,used。字段：object_name,category,condition,visible_issues,manual_checks,confidence。学生填写：${donation.name} / ${donation.categoryId} / ${donation.condition}` },
          { type: 'image_url', image_url: { url: `data:${donation.photoMime};base64,${image.toString('base64')}` } }] }],
      response_format: { type: 'json_schema', json_schema: { name: 'donation_vision', strict: true, schema: { type: 'object', additionalProperties: false,
        properties: { object_name: { type: 'string' }, category: { type: 'string', enum: allowedCategories }, condition: { type: 'string', enum: ['new', 'excellent', 'good', 'used'] },
          visible_issues: { type: 'array', items: { type: 'string' } }, manual_checks: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['object_name', 'category', 'condition', 'visible_issues', 'manual_checks', 'confidence'] } } }, max_tokens: 500, temperature: 0,
    });
    aiResponse = response;
    const result = parseVisionResult(contentText(response), donation.categoryId);
    database.connection.prepare('INSERT OR REPLACE INTO vision_cache (cache_key, result_json, suggested_points, created_at) VALUES (?, ?, ?, ?)')
      .run(cacheKey, JSON.stringify(result), result.suggestedPoints, new Date().toISOString());
    database.connection.prepare(`UPDATE donations SET ai_status = 'succeeded', ai_model = ?, ai_result_json = ?, ai_error = NULL,
      ai_analyzed_at = ?, ai_prompt_version = ?, ai_suggested_points = ? WHERE id = ?`)
      .run(client.config.visionModel, JSON.stringify(result), new Date().toISOString(), VISION_PROMPT_VERSION, result.suggestedPoints, donationId);
  } catch (error) {
    client.markResponseFailure(aiResponse, safeReason(error));
    database.connection.prepare(`UPDATE donations SET ai_status = 'failed', ai_error = ?, ai_model = ?, ai_prompt_version = ? WHERE id = ?`)
      .run(safeReason(error), client.config.visionModel, VISION_PROMPT_VERSION, donationId);
  }
  return getDonation(database, donationId)!;
}

export function enqueueCartoonJob(database: AppDatabase, client: OpenRouterClient, donationId: number) {
  const donation = getDonation(database, donationId);
  if (!donation || donation.status !== 'approved') return;
  const now = new Date().toISOString();
  const sha = donation.photoSha256 || createHash('sha256').update(readFileSync(resolvePhotoPath(database, donation.photoFilename))).digest('hex');
  database.connection.prepare(`INSERT OR IGNORE INTO cartoon_jobs
    (donation_id, status, input_sha256, model, prompt_version, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, 'pending', ?, ?, ?, 0, ?, ?, ?)`)
    .run(donationId, sha, client.config.imageModel, CARTOON_PROMPT_VERSION, now, now, now);
}

function generatedDirectory(database: AppDatabase, explicit?: string) {
  return resolve(explicit ?? join(process.env.CYCLE_GENERATED_DIR ?? 'generated/cartoon', database.mode));
}

export function resolveCartoonPath(database: AppDatabase, filename: string, explicit?: string) {
  if (basename(filename) !== filename) throw new Error('invalid cartoon path');
  return join(generatedDirectory(database, explicit), filename);
}

export async function runNextCartoonJob(database: AppDatabase, client: OpenRouterClient, uploadDirectory?: string, outputDirectory?: string) {
  const job = database.connection.prepare(`SELECT * FROM cartoon_jobs WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT 1`)
    .get(new Date().toISOString()) as Record<string, any> | undefined;
  if (!job) return null;
  database.connection.prepare(`UPDATE cartoon_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), job.id);
  const cacheKey = createHash('sha256').update(`${job.input_sha256}:${job.model}:${job.prompt_version}`).digest('hex');
  let imageResponse: Record<string, any> | undefined;
  try {
    const cached = database.connection.prepare('SELECT filename FROM cartoon_cache WHERE cache_key = ?').get(cacheKey) as { filename: string } | undefined;
    let filename = cached?.filename;
    if (!filename || !existsSync(resolveCartoonPath(database, filename, outputDirectory))) {
      const donation = getDonation(database, Number(job.donation_id));
      if (!donation) throw new Error('donation not found');
      const bytes = readFileSync(resolvePhotoPath(database, donation.photoFilename, uploadDirectory));
      const capabilities = await client.imageCapabilities(client.config.imageModel);
      if (!capabilities.has('input_references')) throw new AiError('upstream', '当前图片模型端点不支持参考图编辑');
      const body: Record<string, unknown> = { model: client.config.imageModel,
        prompt: '保留原物品的主要形状、比例、颜色和辨识特征；只保留物品主体；去除桌面、人物、房间和其他背景；转为校园循环站统一的简洁手绘卡通风；柔和自然；不要增加文字、人物或额外物体；适合放在木质储物柜格子中。',
        input_references: [{ type: 'image_url', image_url: { url: `data:${donation.photoMime};base64,${bytes.toString('base64')}` } }],
      };
      if (capabilities.has('aspect_ratio')) body.aspect_ratio = '1:1';
      if (capabilities.has('resolution')) body.resolution = '1K';
      if (capabilities.has('output_format')) body.output_format = 'png';
      const response = await client.request('image', '/images', client.config.imageModel, body); imageResponse = response;
      const encoded = response.data?.[0]?.b64_json;
      if (typeof encoded !== 'string' || !encoded) throw new AiError('invalid_response', '图片接口未返回图像');
      const directory = generatedDirectory(database, outputDirectory); mkdirSync(directory, { recursive: true });
      filename = `${cacheKey}.png`; writeFileSync(join(directory, filename), Buffer.from(encoded, 'base64'), { flag: 'wx' });
      database.connection.prepare('INSERT OR REPLACE INTO cartoon_cache (cache_key, filename, created_at) VALUES (?, ?, ?)').run(cacheKey, filename, new Date().toISOString());
    }
    const now = new Date().toISOString();
    database.connection.prepare(`UPDATE donations SET cartoon_filename = ? WHERE id = ?`).run(filename, job.donation_id);
    database.connection.prepare(`UPDATE cartoon_jobs SET status = 'succeeded', last_error = NULL, updated_at = ? WHERE id = ?`).run(now, job.id);
  } catch (error) {
    client.markResponseFailure(imageResponse, safeReason(error));
    const current = database.connection.prepare('SELECT attempts FROM cartoon_jobs WHERE id = ?').get(job.id) as { attempts: number };
    const final = current.attempts >= 3;
    const next = new Date(Date.now() + Math.max(1, current.attempts) * 1500).toISOString();
    database.connection.prepare(`UPDATE cartoon_jobs SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
      .run(final ? 'failed' : 'pending', next, safeReason(error), new Date().toISOString(), job.id);
  }
  return database.connection.prepare('SELECT * FROM cartoon_jobs WHERE id = ?').get(job.id);
}

const agentTools = [
  ['get_my_points', '查看当前学生余额', {}], ['get_my_donations', '查看当前学生自己的捐赠及状态', {}],
  ['get_my_redemptions', '查看当前学生自己的领取历史', {}],
  ['list_available_items', '按积分上限、类别或关键词筛选真实可领取库存', { max_points: { type: 'integer' }, category: { type: 'string' }, keyword: { type: 'string' } }],
  ['get_item_detail', '查看一个真实可领取物品', { donation_id: { type: 'integer' } }],
  ['get_my_onboarding_help', '解释捐赠、审核、积分、领取等使用流程', {}],
] as const;

export function agentToolDefinitions() {
  return agentTools.map(([name, description, properties]) => ({ type: 'function', function: { name, description,
    parameters: { type: 'object', additionalProperties: false, properties } } }));
}

export function executeAgentTool(database: AppDatabase, studentId: number, name: string, args: Record<string, unknown>) {
  if (name === 'get_my_points') return database.connection.prepare('SELECT balance FROM students WHERE id = ?').get(studentId);
  if (name === 'get_my_donations') return listStudentDonations(database, studentId).map(({ id, name: item, status, slotId, finalPoints, createdAt }) => ({ id, item, status, slotId, finalPoints, createdAt }));
  if (name === 'get_my_redemptions') return listStudentRedemptions(database, studentId).map(({ id, itemName, pointsSpent, slotId, createdAt }) => ({ id, itemName, pointsSpent, slotId, createdAt }));
  if (name === 'list_available_items') {
    const max = Number(args.max_points ?? Number.MAX_SAFE_INTEGER); const category = String(args.category ?? '').trim(); const keyword = String(args.keyword ?? '').trim();
    return database.connection.prepare(`SELECT id, name, category_id AS category, final_points AS points, slot_id AS slotId FROM donations
      WHERE status = 'approved' AND final_points <= ? AND (? = '' OR category_id = ?) AND (? = '' OR name LIKE '%' || ? || '%') ORDER BY id DESC LIMIT 30`)
      .all(Number.isFinite(max) ? max : Number.MAX_SAFE_INTEGER, category, category, keyword, keyword);
  }
  if (name === 'get_item_detail') return database.connection.prepare(`SELECT id, name, category_id AS category, condition_key AS condition,
    description, final_points AS points, slot_id AS slotId FROM donations WHERE id = ? AND status = 'approved'`).get(Number(args.donation_id));
  if (name === 'get_my_onboarding_help') return { donation: '一次上传一件物品，系统自动分柜；投放后由教师检查实物并确认积分。', redemption: '浏览可领取物品，确认后扣分并前往指定柜位取走；赠与物品无需归还。', points: '捐赠审核通过或劳动奖励可获得积分。' };
  throw new Error('tool not allowed');
}

export async function chatWithAgent(database: AppDatabase, client: OpenRouterClient, studentId: number, input: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }) {
  const messages: any[] = [{ role: 'system', content: '你是“循环小助手”。用简洁中文回答，只依据工具返回的真实数据。没有数据就明确说未找到。你只能查询、解释、推荐和导航；若用户要求领取，提示其打开物品并点击确认领取。' },
    ...(input.history ?? []).slice(-16).map((item) => ({ role: item.role, content: item.content.slice(0, 1000) })), { role: 'user', content: input.message.slice(0, 1000) }];
  for (let turn = 0; turn < 3; turn += 1) {
    const response = await client.chat('agent', client.config.agentModel, { messages, tools: agentToolDefinitions(), tool_choice: 'auto', max_tokens: 450, temperature: 0.2 });
    const message = response.choices?.[0]?.message;
    if (!message) throw new AiError('invalid_response', '助手未返回内容');
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) return { reply: contentText(response), model: client.config.agentModel };
    messages.push(message);
    for (const call of calls.slice(0, 3)) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function?.arguments ?? '{}') as Record<string, unknown>; } catch { /* safe empty args */ }
      let result: unknown;
      try { result = executeAgentTool(database, studentId, String(call.function?.name), args); }
      catch { result = { error: '该工具不可用' }; }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new AiError('invalid_response', '助手工具调用次数过多');
}

export { getAiStatus };
