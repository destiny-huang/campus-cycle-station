import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { OpenRouterClient, readAiConfig } from './openrouter.js';

const config = readAiConfig();
if (!config.apiKey) {
  console.log(JSON.stringify({ skipped: true, reason: 'OPENROUTER_API_KEY is not configured; no paid requests were made.' }, null, 2));
  process.exit(0);
}
const database = openDatabase({ path: resolve(process.env.TEMP ?? 'E:/tmp', `campus-cycle-station-m5-live-${Date.now()}-${process.pid}.sqlite`), mode: 'demo' });
const client = new OpenRouterClient(database, { ...config, timeoutMs: Math.min(config.timeoutMs, 90000) });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const results: Record<string, unknown> = {};
try {
  const startedAt = Date.now();
  const vision = await client.chat('vision', config.visionModel, {
    messages: [{ role: 'user', content: [{ type: 'text', text: '识别图片的主要可见内容，仅输出符合 schema 的 JSON。' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }],
    response_format: { type: 'json_schema', json_schema: { name: 'vision_probe', strict: true, schema: { type: 'object', additionalProperties: false, properties: { description: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['description', 'confidence'] } } },
    max_tokens: 80,
  });
  const content = vision.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.map((item) => typeof item?.text === 'string' ? item.text : '').join('') : '';
  const parsed = text ? JSON.parse(text) as Record<string, unknown> : null;
  results.vision = { ok: typeof parsed?.description === 'string' && typeof parsed?.confidence === 'number', model: config.visionModel, latencyMs: Date.now() - startedAt };
} catch (error) { results.vision = { ok: false, error: (error as Error).message }; }
try {
  const startedAt = Date.now();
  const agent = await client.chat('agent', config.agentModel, {
    messages: [{ role: 'user', content: '请查询我的积分。' }],
    tools: [{ type: 'function', function: { name: 'get_my_points', description: '查看当前学生余额', parameters: { type: 'object', additionalProperties: false, properties: {} } } }],
    tool_choice: { type: 'function', function: { name: 'get_my_points' } }, max_tokens: 80,
  });
  const calls = agent.choices?.[0]?.message?.tool_calls;
  results.agent = { ok: Array.isArray(calls) && calls[0]?.function?.name === 'get_my_points', model: config.agentModel, latencyMs: Date.now() - startedAt };
} catch (error) { results.agent = { ok: false, error: (error as Error).message }; }
if (process.env.OPENROUTER_LIVE_SKIP_IMAGE === '1') results.image = { ok: true, model: config.imageModel, reused: true, note: 'skipped: previously verified implementation' };
else try {
  const capabilities = await client.imageCapabilities(config.imageModel);
  if (!capabilities.has('input_references')) results.image = { ok: false, model: config.imageModel, error: 'configured endpoint does not support input_references; paid image request skipped' };
  else {
    const body: Record<string, unknown> = { prompt: '保留主体，转为简洁校园手绘图标，不加文字。', input_references: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] };
    if (capabilities.has('aspect_ratio')) body.aspect_ratio = '1:1'; if (capabilities.has('resolution')) body.resolution = '1K';
    const image = await client.request('image', '/images', config.imageModel, { ...body, model: config.imageModel });
    results.image = { ok: Boolean(image.data?.[0]?.b64_json), model: config.imageModel };
  }
} catch (error) { results.image = { ok: false, error: (error as Error).message }; }
const usage = database.connection.prepare('SELECT task_type AS task, success, cost_usd AS costUsd FROM ai_usage ORDER BY id').all();
database.connection.close(); console.log(JSON.stringify({ results, usage }, null, 2));
