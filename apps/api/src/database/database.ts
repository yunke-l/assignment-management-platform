import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
      // pg removes failed idle clients itself; observe the error so Node does
      // not turn a recoverable database disconnect into a process crash.
      this.pool.on('error', (error) => Logger.error(error.message, error.stack, 'Database'));
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
    let connectionError: Error | undefined;
    let discard = false;
    const onConnectionError = (error: Error) => {
      connectionError = error;
    };
    // A checked-out client can fail between two queries as well as during one.
    client.on('error', onConnectionError);
    try {
      await client.query('BEGIN');
      const result = await work({
        query: async <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
          (await client.query<R>(sql, params)).rows,
        exec: async (sql) => {
          await client.query(sql);
        },
      });
      if (connectionError) throw connectionError;
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Keep the original failure and never return a broken transaction to
        // the pool when rollback could not restore the connection.
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard || !!connectionError);
      client.off('error', onConnectionError);
    }
  }
  async onModuleDestroy() {
    await this.lite?.close();
    await this.pool?.end();
  }
}
