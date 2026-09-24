import {
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { loginSchema, registerSchema, changePasswordSchema, type Actor } from '@amp/contracts';
import { Database } from '../database/database.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import {
  clearSessionCookie,
  createSession,
  digest,
  sessionToken,
  setSessionCookie,
} from './session.js';
import { consumeInvitation, usableInvitation } from '../classes/invitations.js';
export type AuthRequest = Request & { actor: Actor };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Database) private readonly db: Database) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = sessionToken(req);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException('Sign in to continue.');
    const [user] = await this.db.query(
      `SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
      [digest(token)],
    );
    if (!user) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    req.actor = user as Actor;
    return true;
  }
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(Database) private readonly db: Database) {}
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = loginSchema.parse(body);
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.query(
        'SELECT id,name,email,role,password_hash FROM users WHERE email=$1 FOR UPDATE',
        [input.email],
      );
      const valid = await verifyPassword(input.password, String(user?.password_hash ?? DUMMY_HASH));
      if (!user || !valid) throw new UnauthorizedException('Email or password is incorrect.');
      const actor = { id: user.id, name: user.name, email: user.email, role: user.role } as Actor;
      return { user: actor, token: await createSession(tx, actor.id), expiresIn: 604800 };
    });
    setSessionCookie(res, result.token);
    return result;
  }
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = registerSchema.parse(body);
    const hash = await hashPassword(input.password);
    let result;
    try {
      result = await this.db.transaction(async (tx) => {
        const invitation = await usableInvitation(tx, input.invitation, input.email);
        const actor: Actor = {
          id: randomUUID(),
          email: input.email,
          name: input.name,
          role: invitation.kind === 'TEACHER' ? 'TEACHER' : 'STUDENT',
        };
        await tx.query(
          'INSERT INTO users(id,email,name,role,password_hash) VALUES ($1,$2,$3,$4,$5)',
          [actor.id, actor.email, actor.name, actor.role, hash],
        );
        if (invitation.class_id)
          await tx.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [
            invitation.class_id,
            actor.id,
          ]);
        await consumeInvitation(tx, invitation.id);
        return { user: actor, token: await createSession(tx, actor.id), expiresIn: 604800 };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('Account already exists. Sign in to join the class.');
      throw error;
    }
    setSessionCookie(res, result.token);
    return result;
  }
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest) {
    return req.actor;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.db.query(
      'UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL',
      [digest(sessionToken(req))],
    );
    clearSessionCookie(res);
    return { ok: true };
  }
  @Post('password')
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async password(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = changePasswordSchema.parse(body);
    const hash = await hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      const [user] = await tx.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [
        req.actor.id,
      ]);
      if (!(await verifyPassword(input.currentPassword, String(user?.password_hash ?? DUMMY_HASH))))
        throw new UnauthorizedException('Current password is incorrect.');
      await tx.query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.actor.id, hash]);
      await tx.query(
        'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
        [req.actor.id],
      );
    });
    clearSessionCookie(res);
    return { ok: true };
  }
}
