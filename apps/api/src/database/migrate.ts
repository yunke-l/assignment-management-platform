import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Database } from './database.js';

export async function migrate(db: Database) {
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (new Set(files.map((name) => name.slice(0, 3))).size !== files.length)
    throw new Error('Migration sequence numbers must be unique.');
  await db.transaction(async (tx) => {
    // Serializes migration runners on both PostgreSQL and the embedded development engine.
    await tx.query('SELECT pg_advisory_xact_lock(481927)');
    await tx.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await tx.query<{ name: string; checksum: string }>(
      'SELECT name,checksum FROM schema_migrations ORDER BY name',
    );
    if (applied.some((row, index) => files[index]?.slice(0, -4) !== row.name))
      throw new Error('Applied migration history differs from available migrations.');
    for (const file of files) {
      const name = file.slice(0, -4);
      const sql = await readFile(new URL(file, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = applied.find((row) => row.name === name);
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error('Applied migration was modified; add a new migration instead.');
        continue;
      }
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
    }
  });
}
