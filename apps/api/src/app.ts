import 'reflect-metadata';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { json, static as serveStatic } from 'express';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { mediaLimits } from '@amp/contracts';
import { AppModule } from './app.module.js';
import { cookieName } from './auth/session.js';

@Catch()
class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const parserStatus =
      error instanceof Error &&
      'type' in error &&
      'status' in error &&
      [
        'entity.too.large',
        'encoding.unsupported',
        'charset.unsupported',
        'request.size.invalid',
        'request.aborted',
      ].includes(String(error.type)) &&
      [400, 413, 415].includes(Number(error.status))
        ? Number(error.status)
        : undefined;
    const status =
      error instanceof ZodError
        ? 400
        : error instanceof HttpException
          ? error.getStatus()
          : (parserStatus ?? 500);
    const message =
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : error instanceof HttpException
          ? error.message
          : parserStatus === 413
            ? 'Request body is too large.'
            : parserStatus === 415
              ? 'Unsupported request encoding.'
              : parserStatus === 400
                ? 'Invalid request body.'
                : 'An unexpected error occurred.';
    if (status === 500) Logger.error(error instanceof Error ? error.stack : error, 'API');
    const detail = error instanceof HttpException ? error.getResponse() : null;
    const fields =
      detail && typeof detail === 'object' ? (detail as { code?: string; errors?: unknown[] }) : {};
    res.status(status).json({
      statusCode: status,
      message,
      ...(fields.code ? { code: fields.code } : {}),
      ...(fields.errors ? { errors: fields.errors } : {}),
      requestId: res.getHeader('x-request-id'),
    });
  }
}
export async function createApp(quiet = false) {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
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
  // Structured mixed assignments have a separate bounded JSON budget.
  // Media bytes use the upload stream, never this parser.
  app.use(json({ limit: mediaLimits.jsonBytes }));
  app.useGlobalFilters(new ApiErrorFilter());
  if (process.env.SERVE_WEB === 'true') {
    const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    app.use(serveStatic(webRoot));
    // Client routes must also work on a direct visit or browser refresh.
    // Keep API endpoints and missing static files on their normal 404 paths.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        ['GET', 'HEAD'].includes(req.method) &&
        /^\/(assignments(?:\/[^/.]+(?:\/edit)?)?|classes|account)\/?$/.test(req.path) &&
        req.accepts('html')
      ) {
        res.sendFile('index.html', { root: webRoot });
        return;
      }
      next();
    });
  }
  app.enableShutdownHooks();
  await app.init();
  return app;
}
