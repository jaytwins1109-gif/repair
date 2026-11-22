import { randomBytes } from 'crypto';
import { db, type UserRow } from '../db';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionUser = Pick<
  UserRow,
  'id' | 'emp_no' | 'name' | 'role' | 'position'
>;

export function createSession(userId: number, empNo: string): string {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token, user_id, emp_no, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, empNo, Date.now() + SESSION_TTL_MS);
  return token;
}

export function getUserByToken(token: string | undefined): SessionUser | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.emp_no, u.name, u.role, u.position, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (SessionUser & { expires_at: number }) | undefined;

  if (!row) return null;

  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    id: row.id,
    emp_no: row.emp_no,
    name: row.name,
    role: row.role,
    position: row.position,
  };
}

export function revokeSession(token: string | undefined) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanupExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export function tokenFromHeader(header: string | undefined): string | undefined {
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim() || undefined;
  }
  return undefined;
}
