import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

export function settings() {
  const production = process.env.NODE_ENV === 'production';
  if (production && process.env.ALLOW_DEMO_SEED === 'true') {
    throw new Error('Development credentials and demo seeding are forbidden in production.');
  }
  const driver = process.env.DATABASE_DRIVER ?? 'postgres';
  if (!['postgres', 'pglite'].includes(driver)) throw new Error('Unknown database driver.');
  if (production && driver !== 'postgres') throw new Error('Production requires PostgreSQL.');
  if (production) {
    const origin = process.env.WEB_ORIGIN ?? '';
    let valid = false;
    try {
      const url = new URL(origin);
      valid = url.protocol === 'https:' && url.origin === origin;
    } catch {
      /* Report the same actionable configuration error below. */
    }
    if (!valid)
      throw new Error('Production requires an exact HTTPS WEB_ORIGIN without a trailing slash.');
  }
  return { driver, databaseUrl: process.env.DATABASE_URL ?? '', production };
}
