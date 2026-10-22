import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import type { Response } from 'express';
import { limitedText, uploadInitSchema, uuidSchema } from '@amp/contracts';
import { AuthGuard, type AuthRequest } from '../auth/auth.js';
import { AssetsService } from './assets.service.js';
import { Throttle } from '@nestjs/throttler';

/** Supports one HTTP byte range, including suffix and open-ended forms. */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | false {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return false;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return false;
  return { start, end };
}

@Controller('assets')
@UseGuards(AuthGuard)
@Throttle({ default: { limit: 600, ttl: 60000 } })
export class AssetsController {
  constructor(@Inject(AssetsService) private readonly assets: AssetsService) {}
  @Get()
  workspace(@Req() req: AuthRequest, @Query('assignmentId') id: unknown) {
    return this.assets.workspace(req.actor, uuidSchema.parse(id));
  }
  @Patch(':id')
  update(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = z
      .object({ transcript: limitedText(10_000).optional(), caption: limitedText(500).optional() })
      .strict()
      .refine(
        (v) => (v.transcript !== undefined) !== (v.caption !== undefined),
        'Provide exactly one editable field.',
      )
      .parse(body);
    return input.caption !== undefined
      ? this.assets.caption(req.actor, uuidSchema.parse(id), input.caption)
      : this.assets.transcript(req.actor, uuidSchema.parse(id), input.transcript!);
  }
  @Post('uploads')
  initialize(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.assets.initialize(req.actor, uploadInitSchema.parse(body));
  }
  @Post('uploads/:id/content')
  upload(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.assets.upload(req.actor, uuidSchema.parse(id), req);
  }
  @Get(':id')
  metadata(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.assets.metadata(req.actor, uuidSchema.parse(id));
  }
  @Delete(':id')
  remove(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.assets.remove(req.actor, uuidSchema.parse(id));
  }
  @Get(':id/content')
  @Head(':id/content')
  async content(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Param('id') id: string,
    @Query('variant') variant: unknown,
  ) {
    const type = z.enum(['display', 'thumbnail', 'original']).default('display').parse(variant);
    const file = await this.assets.content(req.actor, uuidSchema.parse(id), type);
    // There is no public URL, redirect or shared cache; each request repeats authorization.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    if (type === 'original') {
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="original"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
    }
    // If-Range cannot match a validator because private variants issue none.
    const range = byteRange(req.headers['if-range'] ? undefined : req.headers.range, file.size);
    if (range === false) {
      res.setHeader('Content-Range', `bytes */${file.size}`);
      res.status(416).end();
      return;
    }
    const start = range?.start ?? 0,
      end = range?.end ?? file.size - 1;
    res.setHeader('Content-Length', end - start + 1);
    if (range) {
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      res.status(206);
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file.path, { start, end });
    stream.once('error', () => {
      if (!res.headersSent) res.status(503).end();
      else res.destroy();
    });
    res.once('close', () => stream.destroy());
    stream.pipe(res);
  }
}
