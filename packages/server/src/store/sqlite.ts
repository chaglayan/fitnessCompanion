import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "./base.js";
import { MIGRATIONS, SCHEMA } from "./schema.js";
import type { Driver, Store } from "./types.js";

/**
 * Node backend, used for local development and self-hosting. node:sqlite is
 * built into Node 22.5+, so there is no native module to compile.
 */
export function createSqliteStore(dbPath: string): Store {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

  const db = new DatabaseSync(path.resolve(dbPath));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  for (const statement of SCHEMA) db.exec(statement);

  // CREATE TABLE IF NOT EXISTS will not add a column to a table that already
  // exists, so bring older databases forward. Re-running is harmless: SQLite
  // rejects a duplicate column and we ignore that specific failure.
  for (const migration of MIGRATIONS) {
    try {
      db.exec(migration);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column/i.test(message)) throw error;
    }
  }

  const driver: Driver = {
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async first<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...(params as never[]));
    },
  };

  return createStore(driver);
}
