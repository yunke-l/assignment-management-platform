import 'reflect-metadata';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { static as serveStatic } from 'express';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { AppModule } from './app.module.js';
import { cookieName } from './auth/session.js';

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof ZodError ? 400 : error instanceof HttpException ? error.getStatus() : 500;
    const message =
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : error instanceof HttpException
          ? error.message
          : 'An unexpected error occurred.';
    if (status === 500) Logger.error(error instanceof Error ? error.stack : error, 'API');
    res
      .status(status)
      .json({ statusCode: status, message, requestId: res.getHeader('x-request-id') });
  }
}
export async function createApp(quiet = false) {
  const app = await NestFactory.create(AppModule, {
    logger: quiet ? false : ['error', 'warn', 'log'],
  });
  app.setGlobalPrefix('api');
  if (process.env.TRUST_PROXY === 'true') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet());
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({ origin, credentials: true });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = randomUUID();
    const started = performance.now();
    res.setHeader('x-request-id', id);
    res.setHeader('Cache-Control', 'no-store');
    if (!quiet)
      res.on('finish', () =>
        console.log(
          JSON.stringify({
            requestId: id,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
          }),
        ),
      );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const hasCookie = req.headers.cookie
        ?.split(';')
        .some((part) => part.trim().startsWith(`${cookieName}=`));
      if (
        (req.headers.origin && req.headers.origin !== origin) ||
        (hasCookie && !req.headers.origin && !req.headers.authorization) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      ) {
        res
          .status(403)
          .json({ statusCode: 403, message: 'Request origin is not allowed.', requestId: id });
        return;
      }
    }
    next();
  });
  app.useGlobalFilters(new ApiErrorFilter());
  if (process.env.SERVE_WEB === 'true')
    app.use(serveStatic(fileURLToPath(new URL('../../web/dist/', import.meta.url))));
  app.enableShutdownHooks();
  await app.init();
  return app;
}
