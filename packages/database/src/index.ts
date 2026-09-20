import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    db: drizzle(pool, { schema }),
    pool,
    async check(): Promise<void> {
      await pool.query('select 1');
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export * from './schema.js';
