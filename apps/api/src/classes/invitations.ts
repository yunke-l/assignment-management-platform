import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Connection } from '../database/database.js';
import { digest } from '../auth/session.js';

type StoredInvite = {
  id: string;
  kind: 'TEACHER' | 'CLASS';
  class_id: string | null;
  email: string | null;
} & Record<string, unknown>;
// Membership changes and publication take the same class lock before locking an invitation.
export async function usableInvitation(tx: Connection, token: string, email: string) {
  const [lookup] = await tx.query<StoredInvite>(
    'SELECT class_id FROM invitations WHERE token_hash=$1',
    [digest(token)],
  );
  if (lookup?.class_id)
    await tx.query('SELECT id FROM classrooms WHERE id=$1 FOR UPDATE', [lookup.class_id]);
  const [invitation] = await tx.query<StoredInvite>(
    `SELECT id,kind,class_id,email FROM invitations WHERE token_hash=$1 AND revoked_at IS NULL
     AND expires_at>clock_timestamp() AND uses<max_uses FOR UPDATE`,
    [digest(token)],
  );
  if (!invitation)
    throw new BadRequestException('Invitation is invalid, expired, revoked or fully used.');
  if (invitation.email && invitation.email !== email)
    throw new ForbiddenException('This invitation is for a different email address.');
  return invitation;
}
export async function consumeInvitation(tx: Connection, id: string) {
  const updated = await tx.query(
    'UPDATE invitations SET uses=uses+1 WHERE id=$1 AND expires_at>clock_timestamp() AND revoked_at IS NULL AND uses<max_uses RETURNING id',
    [id],
  );
  if (!updated.length) throw new BadRequestException('Invitation is no longer available.');
}
