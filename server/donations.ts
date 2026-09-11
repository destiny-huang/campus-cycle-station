import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { getStudent, type AppDatabase, type LockerZone, withTransaction } from './database.js';

export type DonationStatus = 'pending_dropoff' | 'pending_review' | 'approved' | 'returned' | 'cancelled' | 'returned_removed' | 'redeemed';
type ConditionKey = 'near_new' | 'normal' | 'worn_but_complete';
type PointsTemplate = {
  template_version: string;
  condition_multipliers: Record<ConditionKey, number>;
  categories: Array<{ id: string; name: string; base_points: number }>;
};

const template = JSON.parse(readFileSync(resolve('config/points-template.example.json'), 'utf8')) as PointsTemplate;
const imageTypes = {
  'image/jpeg': { extension: 'jpg', magic: (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 },
  'image/png': { extension: 'png', magic: (data: Buffer) => data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { extension: 'webp', magic: (data: Buffer) => data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' },
} as const;

export class DonationError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) { super(message); }
}

export function resolveUploadDirectory(database: AppDatabase, explicit?: string) {
  return resolve(explicit ?? join(process.env.CYCLE_UPLOAD_DIR ?? 'uploads', database.mode));
}

export function resolvePhotoPath(database: AppDatabase, filename: string, explicit?: string) {
  if (basename(filename) !== filename) throw new DonationError('invalid_photo_path', '照片路径无效');
  return join(resolveUploadDirectory(database, explicit), filename);
}

function parsePhoto(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new DonationError('invalid_photo', '照片仅支持 JPEG、PNG 或 WebP');
  const mime = match[1] as keyof typeof imageTypes;
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > 3 * 1024 * 1024) throw new DonationError('invalid_photo', '照片大小必须在 3MB 以内');
  if (!imageTypes[mime].magic(data)) throw new DonationError('invalid_photo', '图片内容与格式不匹配');
  return { mime, data, extension: imageTypes[mime].extension };
}

function estimate(categoryId: string, condition: string) {
  const category = template.categories.find((item) => item.id === categoryId);
  const multiplier = template.condition_multipliers[condition as ConditionKey];
  if (!category || !multiplier) throw new DonationError('invalid_estimate_input', '类别或成色无效');
  const suggestedPoints = Math.floor(category.base_points * multiplier + 0.5);
  return {
    category, multiplier, suggestedPoints,
    basis: JSON.stringify({ method: 'rule_template', category: category.name, basePoints: category.base_points, condition, multiplier }),
  };
}

export function estimatePoints(categoryId: string, condition: string) { return estimate(categoryId, condition); }

function mapDonation(row: Record<string, unknown>) {
  return {
    id: Number(row.id), studentId: Number(row.student_id), donorName: String(row.donor_name ?? ''),
    donorNumber: String(row.student_number ?? ''), className: String(row.class_name ?? ''), name: String(row.name),
    categoryId: String(row.category_id), condition: String(row.condition_key), description: String(row.description),
    zone: row.zone as LockerZone, slotId: String(row.slot_id), status: row.status as DonationStatus,
    photoUrl: `/api/donations/${row.id}/photo`, photoFilename: String(row.photo_filename), photoMime: String(row.photo_mime),
    photoSize: Number(row.photo_size), templateVersion: String(row.template_version), basePoints: Number(row.base_points),
    conditionMultiplier: Number(row.condition_multiplier), suggestedPoints: Number(row.suggested_points),
    estimateBasis: String(row.estimate_basis), finalPoints: row.final_points === null ? null : Number(row.final_points),
    returnReason: row.return_reason === null ? null : String(row.return_reason), createdAt: String(row.created_at),
    depositedAt: row.deposited_at === null ? null : String(row.deposited_at), reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
    photoSha256: String(row.photo_sha256 ?? ''), aiStatus: String(row.ai_status ?? 'disabled'),
    aiModel: row.ai_model === null || row.ai_model === undefined ? null : String(row.ai_model),
    aiResult: row.ai_result_json ? JSON.parse(String(row.ai_result_json)) as Record<string, unknown> : null,
    aiError: row.ai_error === null || row.ai_error === undefined ? null : String(row.ai_error),
    aiAnalyzedAt: row.ai_analyzed_at === null || row.ai_analyzed_at === undefined ? null : String(row.ai_analyzed_at),
    aiSuggestedPoints: row.ai_suggested_points === null || row.ai_suggested_points === undefined ? null : Number(row.ai_suggested_points),
    cartoonUrl: row.cartoon_filename ? `/api/donations/${row.id}/cartoon` : null,
    cartoonStatus: row.cartoon_job_status === null || row.cartoon_job_status === undefined ? null : String(row.cartoon_job_status),
  };
}

const donationSelect = `
  SELECT d.*, s.name AS donor_name, s.student_number, s.class_name, cj.status AS cartoon_job_status
  FROM donations d JOIN students s ON s.id = d.student_id
  LEFT JOIN cartoon_jobs cj ON cj.donation_id = d.id
`;

export function getDonation(database: AppDatabase, id: number) {
  const row = database.connection.prepare(`${donationSelect} WHERE d.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? mapDonation(row) : undefined;
}

export function listStudentDonations(database: AppDatabase, studentId: number) {
  return (database.connection.prepare(`${donationSelect} WHERE d.student_id = ? ORDER BY d.id DESC`).all(studentId) as Record<string, unknown>[]).map(mapDonation);
}

export function listTeacherDonations(database: AppDatabase, status?: string) {
  const allowed = ['pending_dropoff', 'pending_review', 'approved', 'returned', 'cancelled', 'returned_removed', 'redeemed'];
  const rows = status && allowed.includes(status)
    ? database.connection.prepare(`${donationSelect} WHERE d.status = ? ORDER BY d.id DESC`).all(status)
    : database.connection.prepare(`${donationSelect} ORDER BY d.id DESC`).all();
  return (rows as Record<string, unknown>[]).map(mapDonation);
}

export function listLockers(database: AppDatabase, includePrivate = false) {
  const rows = database.connection.prepare(`
    SELECT l.id, l.zone, l.slot_number, l.state, l.queue_order,
      d.id AS donation_id, d.name, d.category_id, d.condition_key, d.description, d.status,
      d.suggested_points, d.final_points, d.cartoon_filename, s.name AS donor_name, s.student_number, s.class_name
    FROM locker_slots l
    LEFT JOIN donations d ON d.id = l.donation_id
    LEFT JOIN students s ON s.id = d.student_id
    ORDER BY l.zone, l.slot_number
  `).all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id), zone: row.zone as LockerZone, number: Number(row.slot_number), state: String(row.state), queueOrder: Number(row.queue_order),
    donation: row.donation_id === null ? null : {
      id: Number(row.donation_id), name: String(row.name), categoryId: String(row.category_id), condition: String(row.condition_key),
      status: row.status as DonationStatus, suggestedPoints: Number(row.suggested_points),
      finalPoints: row.final_points === null ? null : Number(row.final_points), photoUrl: `/api/donations/${row.donation_id}/photo`,
      cartoonUrl: row.cartoon_filename ? `/api/donations/${row.donation_id}/cartoon` : null,
      ...(includePrivate ? { description: String(row.description), donorName: String(row.donor_name), donorNumber: String(row.student_number), className: String(row.class_name) } : {}),
    },
  }));
}

export function createDonation(database: AppDatabase, input: {
  studentId: number; name: string; categoryId: string; condition: string; description: string;
  zone: LockerZone; photoDataUrl: string; idempotencyKey: string; uploadDirectory?: string;
}) {
  const photo = parsePhoto(input.photoDataUrl);
  const calculated = estimate(input.categoryId, input.condition);
  const fingerprint = createHash('sha256').update(JSON.stringify({
    name: input.name, categoryId: input.categoryId, condition: input.condition, description: input.description,
    zone: input.zone, photo: createHash('sha256').update(photo.data).digest('hex'),
  })).digest('hex');
  const uploadDirectory = resolveUploadDirectory(database, input.uploadDirectory);
  mkdirSync(uploadDirectory, { recursive: true });
  let writtenPath: string | undefined;
  try {
    return withTransaction(database, () => {
      const previous = database.connection.prepare('SELECT id, request_fingerprint FROM donations WHERE student_id = ? AND idempotency_key = ?')
        .get(input.studentId, input.idempotencyKey) as { id: number; request_fingerprint: string } | undefined;
      if (previous) {
        if (previous.request_fingerprint !== fingerprint) throw new DonationError('idempotency_conflict', '该请求标识已用于其他捐赠');
        return { duplicate: true, donation: getDonation(database, previous.id)! };
      }
      const slot = database.connection.prepare(`SELECT id FROM locker_slots WHERE zone = ? AND state = 'free' ORDER BY queue_order, slot_number LIMIT 1`)
        .get(input.zone) as { id: string } | undefined;
      if (!slot) throw new DonationError('zone_full', `${input.zone} 区暂无空柜位，请稍后再试`);
      const photoSha256 = createHash('sha256').update(photo.data).digest('hex');
      const filename = `${randomUUID()}.${photo.extension}`;
      writtenPath = join(uploadDirectory, filename);
      writeFileSync(writtenPath, photo.data, { flag: 'wx' });
      const now = new Date().toISOString();
      const result = database.connection.prepare(`
        INSERT INTO donations (
          student_id, name, category_id, condition_key, description, zone, slot_id, status,
          photo_filename, photo_mime, photo_size, template_version, base_points, condition_multiplier,
          suggested_points, estimate_basis, final_points, return_reason, idempotency_key, request_fingerprint, created_at, photo_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_dropoff', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
      `).run(input.studentId, input.name, input.categoryId, input.condition, input.description, input.zone, slot.id,
        filename, photo.mime, photo.data.length, template.template_version, calculated.category.base_points,
        calculated.multiplier, calculated.suggestedPoints, calculated.basis, input.idempotencyKey, fingerprint, now, photoSha256);
      const donationId = Number(result.lastInsertRowid);
      const reserved = database.connection.prepare(`UPDATE locker_slots SET state = 'reserved', donation_id = ?, updated_at = ? WHERE id = ? AND state = 'free'`)
        .run(donationId, now, slot.id);
      if (Number(reserved.changes) !== 1) throw new DonationError('slot_conflict', '柜位刚被占用，请重试');
      return { duplicate: false, donation: getDonation(database, donationId)! };
    });
  } catch (error) {
    if (writtenPath && existsSync(writtenPath)) unlinkSync(writtenPath);
    throw error;
  }
}

export function releaseLockerSlot(database: AppDatabase, donationId: number, slotId: string, now: string) {
  const slot = database.connection.prepare('SELECT zone FROM locker_slots WHERE id = ? AND donation_id = ? AND state != ?')
    .get(slotId, donationId, 'free') as { zone: LockerZone } | undefined;
  if (!slot) return false;
  const maximum = database.connection.prepare('SELECT COALESCE(MAX(queue_order), 0) AS value FROM locker_slots WHERE zone = ?').get(slot.zone) as { value: number };
  const result = database.connection.prepare(`UPDATE locker_slots SET state = 'free', donation_id = NULL, queue_order = ?, updated_at = ? WHERE id = ? AND donation_id = ?`)
    .run(maximum.value + 1, now, slotId, donationId);
  return Number(result.changes) === 1;
}

export function markDeposited(database: AppDatabase, donationId: number, studentId: number) {
  return withTransaction(database, () => {
    const donation = getDonation(database, donationId);
    if (!donation) throw new DonationError('not_found', '捐赠申请不存在');
    if (donation.studentId !== studentId) throw new DonationError('forbidden', '不能修改他人的捐赠申请');
    if (donation.status === 'pending_review') return { duplicate: true, donation };
    if (donation.status !== 'pending_dropoff') throw new DonationError('invalid_status', '当前状态不能标记为已投放');
    const now = new Date().toISOString();
    database.connection.prepare(`UPDATE donations SET status = 'pending_review', deposited_at = ? WHERE id = ?`).run(now, donationId);
    database.connection.prepare(`UPDATE locker_slots SET state = 'occupied', updated_at = ? WHERE donation_id = ?`).run(now, donationId);
    return { duplicate: false, donation: getDonation(database, donationId)! };
  });
}

export function cancelDonation(database: AppDatabase, donationId: number, studentId: number) {
  return withTransaction(database, () => {
    const donation = getDonation(database, donationId);
    if (!donation) throw new DonationError('not_found', '捐赠申请不存在');
    if (donation.studentId !== studentId) throw new DonationError('forbidden', '不能修改他人的捐赠申请');
    if (donation.status === 'cancelled') return { duplicate: true, donation };
    if (donation.status !== 'pending_dropoff') throw new DonationError('invalid_status', '已投放物品不能按普通取消释放柜位');
    const now = new Date().toISOString();
    database.connection.prepare(`UPDATE donations SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(now, donationId);
    releaseLockerSlot(database, donationId, donation.slotId, now);
    return { duplicate: false, donation: getDonation(database, donationId)! };
  });
}

export function reviewDonation(database: AppDatabase, donationId: number, input: { action: 'approve' | 'return'; finalPoints?: number; reason?: string }) {
  return withTransaction(database, () => {
    const donation = getDonation(database, donationId);
    if (!donation) throw new DonationError('not_found', '捐赠申请不存在');
    if (input.action === 'approve' && donation.status === 'approved') return { duplicate: true, donation };
    if (input.action === 'return' && donation.status === 'returned') return { duplicate: true, donation };
    if (donation.status !== 'pending_review') throw new DonationError('invalid_status', '只有待审核物品可以审核');
    const now = new Date().toISOString();
    if (input.action === 'return') {
      const reason = input.reason?.trim() ?? '';
      if (reason.length < 2 || reason.length > 200) throw new DonationError('invalid_reason', '请填写 2–200 字退回原因');
      database.connection.prepare(`UPDATE donations SET status = 'returned', return_reason = ?, reviewed_at = ? WHERE id = ?`).run(reason, now, donationId);
      return { duplicate: false, donation: getDonation(database, donationId)! };
    }
    const finalPoints = Number(input.finalPoints);
    if (!Number.isInteger(finalPoints) || finalPoints < 1 || finalPoints > 10000) throw new DonationError('invalid_points', '最终积分必须是 1–10000 的整数');
    database.connection.prepare(`UPDATE donations SET status = 'approved', final_points = ?, reviewed_at = ? WHERE id = ?`).run(finalPoints, now, donationId);
    database.connection.prepare(`
      INSERT INTO point_transactions (student_id, amount, source, reason, idempotency_key, operated_by, created_at)
      VALUES (?, ?, 'donation', ?, ?, 'teacher', ?)
    `).run(donation.studentId, finalPoints, `捐赠审核通过：${donation.name}`, `donation-approval:${donationId}`, now);
    database.connection.prepare('UPDATE students SET balance = balance + ?, updated_at = ? WHERE id = ?').run(finalPoints, now, donation.studentId);
    return { duplicate: false, donation: getDonation(database, donationId)!, student: getStudent(database, donation.studentId)! };
  });
}

export function confirmReturnedRemoved(database: AppDatabase, donationId: number) {
  return withTransaction(database, () => {
    const donation = getDonation(database, donationId);
    if (!donation) throw new DonationError('not_found', '捐赠申请不存在');
    if (donation.status === 'returned_removed') return { duplicate: true, donation };
    if (donation.status !== 'returned') throw new DonationError('invalid_status', '只有已退回且实物已移出的申请可以释放柜位');
    const now = new Date().toISOString();
    releaseLockerSlot(database, donationId, donation.slotId, now);
    database.connection.prepare(`UPDATE donations SET status = 'returned_removed', removed_at = ? WHERE id = ?`).run(now, donationId);
    return { duplicate: false, donation: getDonation(database, donationId)! };
  });
}
