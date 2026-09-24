import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { loginSchema } from '@amp/contracts';
import { Database } from './database.js';
import { digest, newToken } from '../auth/session.js';
// Operator-only CLI. No public teacher-registration or demo-seed endpoint.
const db = new Database();
try {
  const [command, value] = process.argv.slice(2);
  if (command === 'invite-teacher') {
    const email = loginSchema.shape.email.parse(value);
    const token = newToken();
    await db.query(
      "INSERT INTO invitations(id,token_hash,kind,email,max_uses,expires_at) VALUES ($1,$2,'TEACHER',$3,1,clock_timestamp()+interval '48 hours')",
      [randomUUID(), digest(token), email],
    );
    console.log(
      `Teacher invitation for ${email} (one use; expires in 48 hours):\n${token}\nShare privately. The teacher chooses their own password on the registration page.`,
    );
  } else if (command === 'revoke-user') {
    const email = loginSchema.shape.email.parse(value);
    await db.query(
      'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id IN (SELECT id FROM users WHERE email=$1)',
      [email],
    );
    console.log('Existing sessions revoked.');
  } else if (command === 'prune-sessions') {
    await db.query(
      "DELETE FROM sessions WHERE expires_at<clock_timestamp()-interval '30 days' OR revoked_at<clock_timestamp()-interval '30 days'",
    );
    console.log('Old sessions pruned.');
  } else
    throw new Error('Usage: accounts.ts invite-teacher EMAIL | revoke-user EMAIL | prune-sessions');
} finally {
  await db.onModuleDestroy();
}
