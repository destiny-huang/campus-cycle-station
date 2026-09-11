import { apiUrl } from './platform';

export type Role = 'student' | 'teacher';
export type Student = {
  id: number; studentId: string; name: string; className: string; balance: number;
  environment: 'demo' | 'production'; onboardingCompletedAt: string | null;
};
export type LedgerEntry = { id: number; amount: number; source: 'initial' | 'labor' | 'donation' | 'redemption'; reason: string; operatedBy: string; createdAt: string };
export type Session = { authenticated: boolean; role: Role | null; student: Student | null; mode: 'demo' | 'production' };
export type DonationStatus = 'pending_dropoff' | 'pending_review' | 'approved' | 'returned' | 'cancelled' | 'returned_removed' | 'redeemed';
export type Donation = {
  id: number; studentId: number; donorName: string; donorNumber: string; className: string; name: string;
  categoryId: string; condition: string; description: string; zone: 'A' | 'B' | 'C'; slotId: string;
  status: DonationStatus; photoUrl: string; photoFilename: string; photoMime: string; photoSize: number;
  templateVersion: string; basePoints: number; conditionMultiplier: number; suggestedPoints: number;
  estimateBasis: string; finalPoints: number | null; returnReason: string | null; createdAt: string;
  depositedAt: string | null; reviewedAt: string | null;
  photoSha256: string; aiStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'disabled'; aiModel: string | null;
  aiResult: null | { objectName: string; category: string; condition: string; visibleIssues: string[]; manualChecks: string[]; confidence: number; basePoints: number; multiplier: number; suggestedPoints: number };
  aiError: string | null; aiAnalyzedAt: string | null; aiSuggestedPoints: number | null;
  cartoonUrl: string | null; cartoonStatus: 'pending' | 'running' | 'succeeded' | 'failed' | null;
};
export type Redemption = {
  id: number; donationId: number; studentId: number; studentName: string; studentNumber: string; className: string;
  pointsSpent: number; itemName: string; slotId: string; photoUrl: string; photoFilename: string; photoMime: string; createdAt: string;
};
export type LockerIssue = {
  id: number; redemptionId: number; donationId: number; studentId: number; itemName: string; slotId: string;
  studentName: string; studentNumber: string; description: string; status: 'open' | 'resolved'; createdAt: string; resolvedAt: string | null;
};
export type LockerSlot = {
  id: string; zone: 'A' | 'B' | 'C'; number: number; state: 'free' | 'reserved' | 'occupied'; queueOrder: number;
  donation: null | Pick<Donation, 'id' | 'name' | 'categoryId' | 'condition' | 'status' | 'suggestedPoints' | 'finalPoints' | 'photoUrl'>
    & Partial<Pick<Donation, 'description' | 'donorName' | 'donorNumber' | 'className' | 'cartoonUrl'>>;
};

export type AiStatus = {
  configured: boolean; state: 'ready' | 'disabled'; models: { vision: string; image: string; agent: string };
  today: { calls: number; successes: number; failures: number; recordedCostUsd: number; budgetUsd: number }; recentError: string | null;
};

export class ApiError extends Error {
  currentBalance?: number;
  requiredPoints?: number;
  constructor(public status: number, public code: string, message: string, details: Record<string, unknown> = {}) {
    super(message); Object.assign(this, details);
  }
}

function withNativeMediaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withNativeMediaUrls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key,
    (key === 'photoUrl' || key === 'cartoonUrl') && typeof entry === 'string' ? apiUrl(entry) : withNativeMediaUrls(entry),
  ]));
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  const body = await response.json() as T & { code?: string; message?: string };
  if (!response.ok) throw new ApiError(response.status, body.code ?? 'request_failed', body.message ?? '请求失败', body as Record<string, unknown>);
  return withNativeMediaUrls(body) as T;
}

export const postJson = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
