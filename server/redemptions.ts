import { basename, join } from 'node:path';
import { getStudent, type AppDatabase, withTransaction } from './database.js';
import { DonationError, getDonation, releaseLockerSlot, resolveUploadDirectory } from './donations.js';

const redemptionSelect = `
  SELECT r.*, s.name AS student_name, s.student_number, s.class_name
  FROM redemptions r JOIN students s ON s.id = r.student_id
`;

function mapRedemption(row: Record<string, unknown>) {
  return {
    id: Number(row.id), donationId: Number(row.donation_id), studentId: Number(row.student_id),
    studentName: String(row.student_name ?? ''), studentNumber: String(row.student_number ?? ''), className: String(row.class_name ?? ''),
    pointsSpent: Number(row.points_spent), itemName: String(row.item_name_snapshot), slotId: String(row.slot_id_snapshot),
    photoUrl: `/api/redemptions/${row.id}/photo`, photoFilename: String(row.photo_filename_snapshot),
    photoMime: String(row.photo_mime_snapshot), createdAt: String(row.created_at),
  };
}

export function getRedemption(database: AppDatabase, id: number) {
  const row = database.connection.prepare(`${redemptionSelect} WHERE r.id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? mapRedemption(row) : undefined;
}

export function listStudentRedemptions(database: AppDatabase, studentId: number) {
  const rows = database.connection.prepare(`${redemptionSelect} WHERE r.student_id = ? ORDER BY r.id DESC`).all(studentId) as Record<string, unknown>[];
  return rows.map(mapRedemption);
}

export function listTeacherRedemptions(database: AppDatabase) {
  const rows = database.connection.prepare(`${redemptionSelect} ORDER BY r.id DESC LIMIT 100`).all() as Record<string, unknown>[];
  return rows.map(mapRedemption);
}

export function resolveRedemptionPhotoPath(database: AppDatabase, filename: string, explicit?: string) {
  if (basename(filename) !== filename) throw new DonationError('invalid_photo_path', '照片路径无效');
  return join(resolveUploadDirectory(database, explicit), filename);
}

export function redeemDonation(database: AppDatabase, input: { studentId: number; donationId: number; idempotencyKey: string }) {
  return withTransaction(database, () => {
    const previous = database.connection.prepare('SELECT id, donation_id FROM redemptions WHERE student_id = ? AND idempotency_key = ?')
      .get(input.studentId, input.idempotencyKey) as { id: number; donation_id: number } | undefined;
    if (previous) {
      if (previous.donation_id !== input.donationId) throw new DonationError('idempotency_conflict', '该请求标识已用于其他领取');
      return { duplicate: true, redemption: getRedemption(database, previous.id)!, student: getStudent(database, input.studentId)! };
    }
    const donation = getDonation(database, input.donationId);
    if (!donation) throw new DonationError('not_found', '物品不存在');
    if (donation.status !== 'approved' || donation.finalPoints === null) {
      const isRedeemed = donation.status === 'redeemed';
      throw new DonationError(isRedeemed ? 'already_redeemed' : 'not_available', isRedeemed ? '该物品已被领取' : '该物品当前不可领取');
    }
    const student = getStudent(database, input.studentId);
    if (!student) throw new DonationError('not_found', '学生不存在');
    const price = donation.finalPoints;
    if (student.balance < price) throw new DonationError('insufficient_points', `当前余额 ${student.balance} 分，领取需要 ${price} 分`, { currentBalance: student.balance, requiredPoints: price });
    const now = new Date().toISOString();
    const inserted = database.connection.prepare(`
      INSERT INTO redemptions (donation_id, student_id, points_spent, item_name_snapshot, photo_filename_snapshot, photo_mime_snapshot, slot_id_snapshot, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(donation.id, input.studentId, price, donation.name, donation.photoFilename, donation.photoMime, donation.slotId, input.idempotencyKey, now);
    const redemptionId = Number(inserted.lastInsertRowid);
    const deducted = database.connection.prepare('UPDATE students SET balance = balance - ?, updated_at = ? WHERE id = ? AND balance >= ?')
      .run(price, now, input.studentId, price);
    if (Number(deducted.changes) !== 1) throw new DonationError('insufficient_points', '余额不足，领取未生效');
    database.connection.prepare(`
      INSERT INTO point_transactions (student_id, amount, source, reason, idempotency_key, operated_by, created_at)
      VALUES (?, ?, 'redemption', ?, ?, 'student', ?)
    `).run(input.studentId, -price, `领取物品：${donation.name}`, `redemption:${redemptionId}`, now);
    const changed = database.connection.prepare("UPDATE donations SET status = 'redeemed' WHERE id = ? AND status = 'approved'").run(donation.id);
    if (Number(changed.changes) !== 1) throw new DonationError('already_redeemed', '该物品已被领取');
    if (!releaseLockerSlot(database, donation.id, donation.slotId, now)) throw new DonationError('slot_conflict', '柜位状态异常，领取未生效');
    return { duplicate: false, redemption: getRedemption(database, redemptionId)!, student: getStudent(database, input.studentId)! };
  });
}

const issueSelect = `
  SELECT i.*, r.item_name_snapshot, r.slot_id_snapshot, s.name AS student_name, s.student_number
  FROM locker_issues i JOIN redemptions r ON r.id = i.redemption_id JOIN students s ON s.id = i.student_id
`;

function mapIssue(row: Record<string, unknown>) {
  return {
    id: Number(row.id), redemptionId: Number(row.redemption_id), donationId: Number(row.donation_id), studentId: Number(row.student_id),
    itemName: String(row.item_name_snapshot), slotId: String(row.slot_id_snapshot), studentName: String(row.student_name),
    studentNumber: String(row.student_number), description: String(row.description), status: String(row.status) as 'open' | 'resolved',
    createdAt: String(row.created_at), resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
  };
}

export function createLockerIssue(database: AppDatabase, input: { studentId: number; redemptionId: number; description: string; idempotencyKey: string }) {
  return withTransaction(database, () => {
    const previous = database.connection.prepare('SELECT id, redemption_id, description FROM locker_issues WHERE student_id = ? AND idempotency_key = ?')
      .get(input.studentId, input.idempotencyKey) as { id: number; redemption_id: number; description: string } | undefined;
    if (previous) {
      if (previous.redemption_id !== input.redemptionId || previous.description !== input.description) throw new DonationError('idempotency_conflict', '该请求标识已用于其他异常反馈');
      const row = database.connection.prepare(`${issueSelect} WHERE i.id = ?`).get(previous.id) as Record<string, unknown>;
      return { duplicate: true, issue: mapIssue(row) };
    }
    const redemption = getRedemption(database, input.redemptionId);
    if (!redemption) throw new DonationError('not_found', '领取记录不存在');
    if (redemption.studentId !== input.studentId) throw new DonationError('forbidden', '不能反馈他人的领取记录');
    const now = new Date().toISOString();
    const result = database.connection.prepare(`
      INSERT INTO locker_issues (redemption_id, donation_id, student_id, slot_id_snapshot, description, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(redemption.id, redemption.donationId, input.studentId, redemption.slotId, input.description, input.idempotencyKey, now);
    const row = database.connection.prepare(`${issueSelect} WHERE i.id = ?`).get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return { duplicate: false, issue: mapIssue(row) };
  });
}

export function listTeacherIssues(database: AppDatabase) {
  const rows = database.connection.prepare(`${issueSelect} ORDER BY CASE i.status WHEN 'open' THEN 0 ELSE 1 END, i.id DESC LIMIT 100`).all() as Record<string, unknown>[];
  return rows.map(mapIssue);
}

export function resolveLockerIssue(database: AppDatabase, issueId: number) {
  return withTransaction(database, () => {
    const row = database.connection.prepare(`${issueSelect} WHERE i.id = ?`).get(issueId) as Record<string, unknown> | undefined;
    if (!row) throw new DonationError('not_found', '异常反馈不存在');
    const issue = mapIssue(row);
    if (issue.status === 'resolved') return { duplicate: true, issue };
    database.connection.prepare("UPDATE locker_issues SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'open'").run(new Date().toISOString(), issueId);
    const updated = database.connection.prepare(`${issueSelect} WHERE i.id = ?`).get(issueId) as Record<string, unknown>;
    return { duplicate: false, issue: mapIssue(updated) };
  });
}
