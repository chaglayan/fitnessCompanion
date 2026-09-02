import { createStore } from "./base.js";
import type { Driver, Store } from "./types.js";

/**
 * Minimal structural type for D1, so this file does not need
 * @cloudflare/workers-types at build time in the Node package.
 */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
  };
}

/**
 * Cloudflare backend. The schema is applied out of band by
 * `wrangler d1 execute --file=schema.sql`, since a Worker cannot migrate its
 * own database on a cold start without racing every other request.
 */
export function createD1Store(db: D1Like): Store {
  const driver: Driver = {
    async all<T>(sql: string, params: unknown[] = []) {
      const { results } = await db.prepare(sql).bind(...params).all<T>();
      return results;
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return (await db.prepare(sql).bind(...params).first<T>()) ?? undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      await db.prepare(sql).bind(...params).run();
    },
  };

  return createStore(driver);
}
