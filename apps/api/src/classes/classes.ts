import { uuidPipe } from '../validation.js';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import {
  createClassSchema,
  createInvitationSchema,
  joinClassSchema,
  paginationSchema,
  type Actor,
} from '@amp/contracts';
import { AuthGuard, type AuthRequest } from '../auth/auth.js';
import { digest, newToken } from '../auth/session.js';
import { Database, type Connection } from '../database/database.js';
import { usableInvitation, consumeInvitation } from './invitations.js';

@Injectable()
export class ClassesService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async own(actor: Actor, id: string, tx: Connection = this.db, lock = false) {
    if (actor.role !== 'TEACHER') throw new ForbiddenException('Only teachers can manage classes.');
    const [row] = await tx.query(
      `SELECT id,name FROM classrooms WHERE id=$1 AND teacher_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [id, actor.id],
    );
    if (!row) throw new NotFoundException('Class not found.');
    return row;
  }
  async create(actor: Actor, name: string) {
    if (actor.role !== 'TEACHER') throw new ForbiddenException('Only teachers can create classes.');
    const [row] = await this.db.query(
      'INSERT INTO classrooms(id,name,teacher_id) VALUES ($1,$2,$3) RETURNING id,name',
      [randomUUID(), name, actor.id],
    );
    return row;
  }
  async members(actor: Actor, id: string, page: number, pageSize: number) {
    await this.own(actor, id);
    return this.db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const [count] = await tx.query(
        'SELECT count(*) AS total FROM class_memberships WHERE class_id=$1',
        [id],
      );
      const items = await tx.query(
        'SELECT u.id,u.name,u.email FROM class_memberships m JOIN users u ON u.id=m.student_id WHERE m.class_id=$1 ORDER BY u.name,u.id LIMIT $2 OFFSET $3',
        [id, pageSize, (page - 1) * pageSize],
      );
      return { items, total: Number(count?.total ?? 0), page, pageSize };
    });
  }
  async remove(actor: Actor, id: string, studentId: string) {
    await this.db.transaction(async (tx) => {
      await this.own(actor, id, tx, true);
      await tx.query(
        'UPDATE assignment_recipients r SET removed_at=clock_timestamp() FROM assignments a WHERE r.assignment_id=a.id AND a.class_id=$1 AND r.student_id=$2 AND r.removed_at IS NULL',
        [id, studentId],
      );
      await tx.query('DELETE FROM class_memberships WHERE class_id=$1 AND student_id=$2', [
        id,
        studentId,
      ]);
    });
    return { ok: true };
  }
  async invite(actor: Actor, id: string, input: { expiresInHours: number; maxUses: number }) {
    await this.own(actor, id);
    const token = newToken();
    const [invitation] = await this.db.query(
      `INSERT INTO invitations(id,token_hash,kind,class_id,max_uses,expires_at)
      VALUES ($1,$2,'CLASS',$3,$4,clock_timestamp()+$5 * interval '1 hour')
      RETURNING id,expires_at::text AS "expiresAt",max_uses AS "maxUses",uses,revoked_at::text AS "revokedAt"`,
      [randomUUID(), digest(token), id, input.maxUses, input.expiresInHours],
    );
    return { ...invitation, token };
  }
  async invitations(actor: Actor, id: string) {
    await this.own(actor, id);
    return this.db.query(
      `SELECT id,expires_at::text AS "expiresAt",max_uses AS "maxUses",uses,revoked_at::text AS "revokedAt" FROM invitations WHERE class_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND uses<max_uses ORDER BY created_at DESC,id DESC`,
      [id],
    );
  }
  async revoke(actor: Actor, id: string, invitationId: string) {
    await this.db.transaction(async (tx) => {
      await this.own(actor, id, tx, true);
      const rows = await tx.query(
        'UPDATE invitations SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE class_id=$1 AND id=$2 RETURNING id',
        [id, invitationId],
      );
      if (!rows.length) throw new NotFoundException('Invitation not found.');
    });
    return { ok: true };
  }
  async join(actor: Actor, token: string) {
    if (actor.role !== 'STUDENT') throw new ForbiddenException('Only students can join classes.');
    return this.db.transaction(async (tx) => {
      const invitation = await usableInvitation(tx, token, actor.email);
      if (invitation.kind !== 'CLASS') throw new ForbiddenException('Use a class invitation.');
      const added = await tx.query(
        'INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING class_id',
        [invitation.class_id, actor.id],
      );
      if (added.length) await consumeInvitation(tx, invitation.id);
      const [classroom] = await tx.query('SELECT id,name FROM classrooms WHERE id=$1', [
        invitation.class_id,
      ]);
      return classroom;
    });
  }
}
@Controller('classes')
@UseGuards(AuthGuard)
export class ClassesController {
  constructor(@Inject(ClassesService) private readonly service: ClassesService) {}
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.create(req.actor, createClassSchema.parse(body).name);
  }
  @Post('join')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  join(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.join(req.actor, joinClassSchema.parse(body).invitation);
  }
  @Get(':id/members') members(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Query() query: unknown,
  ) {
    const { page, pageSize } = paginationSchema.parse(query);
    return this.service.members(req.actor, id, page, pageSize);
  }
  @Delete(':id/members/:studentId') remove(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Param('studentId', uuidPipe) studentId: string,
  ) {
    return this.service.remove(req.actor, id, studentId);
  }
  @Post(':id/invitations') invite(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.invite(req.actor, id, createInvitationSchema.parse(body));
  }
  @Get(':id/invitations') invitations(@Req() req: AuthRequest, @Param('id', uuidPipe) id: string) {
    return this.service.invitations(req.actor, id);
  }
  @Delete(':id/invitations/:invitationId') revoke(
    @Req() req: AuthRequest,
    @Param('id', uuidPipe) id: string,
    @Param('invitationId', uuidPipe) invitationId: string,
  ) {
    return this.service.revoke(req.actor, id, invitationId);
  }
}
