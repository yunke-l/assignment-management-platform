import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Connection } from '../database/database.js';

export const cookieName = 'classwork_session';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export function sessionToken(req: Request) {
  if (req.headers.authorization)
    return req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : '';
  return (
    req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? ''
  );
}
export async function createSession(tx: Connection, userId: string) {
  const token = newToken();
  await tx.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '7 days')",
    [digest(token), userId],
  );
  return token;
}
export function setSessionCookie(res: Response, token: string) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
    maxAge: 7 * 86400000,
  });
}
export function clearSessionCookie(res: Response) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
  });
}
