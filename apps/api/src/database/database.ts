import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { settings } from '../config.js';

export interface Connection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

@Injectable()
export class Database implements Connection, OnModuleDestroy {
  private readonly pool?: pg.Pool;
  private readonly lite?: PGlite;

  constructor() {
    const { driver, databaseUrl } = settings();
    if (driver === 'pglite') this.lite = new PGlite(databaseUrl || 'memory://');
    else {
      if (!databaseUrl) throw new Error('DATABASE_URL is required.');
      this.pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 10,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      });
    }
  }
  async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (this.lite) return (await this.lite.query<T>(sql, params)).rows;
    return (await this.pool!.query<T>(sql, params)).rows;
  }
  async exec(sql: string) {
    if (this.lite) await this.lite.exec(sql);
    else await this.pool!.query(sql);
  }
  async transaction<T>(work: (tx: Connection) => Promise<T>): Promise<T> {
    if (this.lite) {
      return this.lite.transaction((tx) =>
        work({
          query: async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
            (await tx.query<R>(sql, params)).rows,
          exec: async (sql) => {
            await tx.exec(sql);
          },
        }),
      );
    }
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
          (await client.query<R>(sql, params)).rows,
        exec: async (sql) => {
          await client.query(sql);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.lite?.close();
    await this.pool?.end();
  }
}
