/**
 * Single source of truth for the database schema.
 *
 * The Node store applies these at startup; the Cloudflare Worker cannot create
 * its own tables, so `npm run schema -w @fc/worker` renders the same
 * statements to schema.sql for `wrangler d1 execute` to apply as a migration.
 * Keeping one definition means the two backends cannot drift.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS plans (
     id          TEXT PRIMARY KEY,
     for_date    TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     source      TEXT NOT NULL,
     json        TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS plans_created_at ON plans(created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS logs (
     id          TEXT PRIMARY KEY,
     plan_id     TEXT,
     started_at  TEXT NOT NULL,
     finished_at TEXT,
     json        TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS logs_started_at ON logs(started_at DESC)`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
     id          TEXT PRIMARY KEY,
     thread_id   TEXT NOT NULL,
     role        TEXT NOT NULL,
     content     TEXT NOT NULL,
     plan_id     TEXT,
     created_at  TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS chat_thread ON chat_messages(thread_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS usage (
     id            TEXT PRIMARY KEY,
     created_at    TEXT NOT NULL,
     provider      TEXT NOT NULL,
     model         TEXT NOT NULL,
     purpose       TEXT NOT NULL,
     input_tokens  INTEGER NOT NULL,
     cached_tokens INTEGER NOT NULL,
     write_tokens  INTEGER NOT NULL,
     output_tokens INTEGER NOT NULL,
     thinking_tokens INTEGER NOT NULL DEFAULT 0,
     cost_usd      REAL NOT NULL,
     latency_ms    INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS usage_created_at ON usage(created_at DESC)`,

  // Counts sessions served with no AI call, so the usage panel can show
  // what the deterministic planner saved.
  `CREATE TABLE IF NOT EXISTS planner_hits (
     id         TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     kind       TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS planner_hits_created_at ON planner_hits(created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS plan_cache (
     fingerprint TEXT PRIMARY KEY,
     plan_id     TEXT NOT NULL,
     created_at  TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS kv (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

/**
 * Applied after SCHEMA on the Node backend, which may be opening a database
 * created by an earlier version. `CREATE TABLE IF NOT EXISTS` silently leaves
 * an existing table alone, so new columns need adding explicitly. Each is
 * safe to re-run — a duplicate column error is caught and ignored.
 *
 * On Cloudflare these are part of `npm run db:init -w @fc/worker`; an already
 * deployed database needs them run once via `wrangler d1 execute`.
 */
export const MIGRATIONS: string[] = [
  "ALTER TABLE usage ADD COLUMN thinking_tokens INTEGER NOT NULL DEFAULT 0",
];
