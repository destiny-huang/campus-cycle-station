export type Role = 'student' | 'teacher';
export type Student = { id: number; studentId: string; name: string; className: string; balance: number; environment: 'demo' | 'production' };
export type LedgerEntry = { id: number; amount: number; source: 'initial' | 'labor'; reason: string; operatedBy: string; createdAt: string };
export type Session = { authenticated: boolean; role: Role | null; student: Student | null; mode: 'demo' | 'production' };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  const body = await response.json() as T & { code?: string; message?: string };
  if (!response.ok) throw new ApiError(response.status, body.code ?? 'request_failed', body.message ?? '请求失败');
  return body;
}

export const postJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
