import type { AppDatabase } from './database.js';

export type AiTaskType = 'vision' | 'agent' | 'image';
export type AiConfig = {
  apiKey?: string; baseUrl: string; visionModel: string; agentModel: string; imageModel: string;
  dailyBudgetUsd: number; timeoutMs: number;
};
export type AiTransport = (url: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_MODELS = {
  vision: 'qwen/qwen3.5-9b',
  agent: 'qwen/qwen3.5-9b',
  image: 'google/gemini-3.1-flash-lite-image',
} as const;

export function readAiConfig(environment: NodeJS.ProcessEnv = process.env): AiConfig {
  const parsedBudget = Number(environment.OPENROUTER_DAILY_BUDGET_USD ?? '1.00');
  const parsedTimeout = Number(environment.OPENROUTER_TIMEOUT_MS ?? '45000');
  return {
    apiKey: environment.OPENROUTER_API_KEY?.trim() || undefined,
    baseUrl: (environment.OPENROUTER_API_BASE?.trim() || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    visionModel: environment.OPENROUTER_VISION_MODEL?.trim() || DEFAULT_MODELS.vision,
    agentModel: environment.OPENROUTER_AGENT_MODEL?.trim() || DEFAULT_MODELS.agent,
    imageModel: environment.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_MODELS.image,
    dailyBudgetUsd: Number.isFinite(parsedBudget) && parsedBudget >= 0 ? parsedBudget : 1,
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout >= 1000 ? parsedTimeout : 45000,
  };
}

export class AiError extends Error {
  constructor(public code: 'disabled' | 'budget_exhausted' | 'timeout' | 'upstream' | 'invalid_response', message: string, public status?: number) { super(message); }
}

function safeErrorMessage(error: unknown) {
  if (error instanceof AiError) return error.message.slice(0, 300);
  if (error instanceof Error && error.name === 'AbortError') return 'OpenRouter 请求超时';
  return 'OpenRouter 请求失败';
}

function redactSecrets(message: string, apiKey?: string) {
  let safe = message;
  if (apiKey) safe = safe.replaceAll(apiKey, '[已隐藏]');
  return safe.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[已隐藏]').slice(0, 300);
}

function usageFrom(body: Record<string, any>) {
  const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
  const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return { promptTokens: numberOrNull(usage.prompt_tokens), completionTokens: numberOrNull(usage.completion_tokens), cost: numberOrNull(usage.cost) };
}

export function getAiStatus(database: AppDatabase, config = readAiConfig()) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const summary = database.connection.prepare(`
    SELECT COUNT(*) AS calls, COALESCE(SUM(success), 0) AS successes,
      COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) AS failures,
      COALESCE(SUM(cost_usd), 0) AS cost
    FROM ai_usage WHERE created_at >= ? AND created_at < ?
  `).get(start, end) as Record<string, number>;
  const recent = database.connection.prepare(`SELECT error_message FROM ai_usage WHERE success = 0 AND error_message IS NOT NULL ORDER BY id DESC LIMIT 1`)
    .get() as { error_message: string } | undefined;
  return {
    configured: Boolean(config.apiKey), state: config.apiKey ? 'ready' : 'disabled',
    models: { vision: config.visionModel, agent: config.agentModel, image: config.imageModel },
    today: { calls: Number(summary.calls), successes: Number(summary.successes), failures: Number(summary.failures), recordedCostUsd: Number(summary.cost), budgetUsd: config.dailyBudgetUsd },
    recentError: recent?.error_message ?? null,
  };
}

export class OpenRouterClient {
  private gate: Promise<void> = Promise.resolve();
  constructor(public database: AppDatabase, public config = readAiConfig(), private transport: AiTransport = fetch) {}

  private assertAvailable() {
    if (!this.config.apiKey) throw new AiError('disabled', 'AI服务暂未启用。');
    const status = getAiStatus(this.database, this.config);
    if (status.today.recordedCostUsd >= this.config.dailyBudgetUsd) throw new AiError('budget_exhausted', '今日AI体验额度已用完，捐赠、审核和领取仍可正常使用。');
  }

  private record(task: AiTaskType, model: string, success: boolean, body: Record<string, any> | undefined, requestId: string | null, error: string | null) {
    const usage = body ? usageFrom(body) : { promptTokens: null, completionTokens: null, cost: null };
    const result = this.database.connection.prepare(`INSERT INTO ai_usage
      (task_type, model, success, prompt_tokens, completion_tokens, cost_usd, request_id, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task, model, success ? 1 : 0, usage.promptTokens, usage.completionTokens, usage.cost, requestId, error, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  markResponseFailure(body: Record<string, any> | undefined, message: string) {
    const id = body?.__aiUsageId;
    if (Number.isInteger(id)) this.database.connection.prepare('UPDATE ai_usage SET success = 0, error_message = ? WHERE id = ?').run(message.slice(0, 300), id);
  }

  request(task: AiTaskType, path: string, model: string, body: Record<string, unknown>, method = 'POST') {
    const pending = this.gate.then(() => this.performRequest(task, path, model, body, method));
    this.gate = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async performRequest(task: AiTaskType, path: string, model: string, body: Record<string, unknown>, method: string) {
    this.assertAvailable();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let parsed: Record<string, any> | undefined;
    let requestId: string | null = null;
    try {
      const response = await this.transport(`${this.config.baseUrl}${path}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
      requestId = response.headers.get('x-request-id');
      const text = await response.text();
      try { parsed = text ? JSON.parse(text) as Record<string, any> : {}; }
      catch { throw new AiError('invalid_response', 'OpenRouter 返回了无法解析的响应'); }
      if (!response.ok) {
        const upstream = redactSecrets(typeof parsed.error?.message === 'string' ? parsed.error.message : `OpenRouter 请求失败（${response.status}）`, this.config.apiKey);
        throw new AiError('upstream', upstream, response.status);
      }
      const usageId = this.record(task, model, true, parsed, requestId ?? (typeof parsed.id === 'string' ? parsed.id : null), null);
      Object.defineProperty(parsed, '__aiUsageId', { value: usageId, enumerable: false });
      return parsed;
    } catch (error) {
      const safe = error instanceof AiError ? error : error instanceof Error && error.name === 'AbortError'
        ? new AiError('timeout', 'OpenRouter 请求超时') : new AiError('upstream', 'OpenRouter 请求失败');
      this.record(task, model, false, parsed, requestId, redactSecrets(safeErrorMessage(safe), this.config.apiKey));
      throw safe;
    } finally { clearTimeout(timer); }
  }

  async chat(task: 'vision' | 'agent', model: string, body: Record<string, unknown>) {
    try { return await this.request(task, '/chat/completions', model, { ...body, model, provider: { data_collection: 'deny' } }); }
    catch (error) {
      if (error instanceof AiError && error.status === 400 && /provider|data.collection/i.test(error.message)) return this.request(task, '/chat/completions', model, { ...body, model });
      throw error;
    }
  }

  async imageCapabilities(model: string) {
    this.assertAvailable();
    const encoded = model.split('/').map(encodeURIComponent).join('/');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.config.timeoutMs, 15000));
    try {
      const response = await this.transport(`${this.config.baseUrl}/images/models/${encoded}/endpoints`, {
        method: 'GET', signal: controller.signal, headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      if (!response.ok) return new Set<string>();
      const body = await response.json() as { endpoints?: Array<{ supported_parameters?: Record<string, unknown> }> };
      return new Set(body.endpoints?.flatMap((endpoint) => Object.keys(endpoint.supported_parameters ?? {})) ?? []);
    } catch { return new Set<string>(); }
    finally { clearTimeout(timer); }
  }
}
