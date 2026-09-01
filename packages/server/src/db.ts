import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ChatMessage,
  TrainingDigest,
  UsageRecord,
  WorkoutLog,
  WorkoutPlan,
} from "@fc/shared";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,
  for_date    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  source      TEXT NOT NULL,
  json        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_for_date ON plans(for_date DESC);

CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  json        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_started_at ON logs(started_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  plan_id     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_thread ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS usage (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  write_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  latency_ms    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_created_at ON usage(created_at DESC);

-- Counts sessions served with no AI call, so the usage panel can show what
-- the deterministic planner saved.
CREATE TABLE IF NOT EXISTS planner_hits (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_cache (
  fingerprint TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/* ------------------------------- plans ------------------------------- */

export function savePlan(plan: WorkoutPlan): void {
  db.prepare(
    `INSERT INTO plans (id, for_date, created_at, source, json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, source = excluded.source`,
  ).run(plan.id, plan.forDate, plan.createdAt, plan.source, JSON.stringify(plan));
}

export function getPlan(id: string): WorkoutPlan | undefined {
  const row = db.prepare("SELECT json FROM plans WHERE id = ?").get(id) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as WorkoutPlan) : undefined;
}

export function listPlans(limit = 20): WorkoutPlan[] {
  const rows = db
    .prepare("SELECT json FROM plans ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as WorkoutPlan);
}

/* -------------------------------- logs ------------------------------- */

export function saveLog(log: WorkoutLog): void {
  db.prepare(
    `INSERT INTO logs (id, plan_id, started_at, finished_at, json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       finished_at = excluded.finished_at, json = excluded.json`,
  ).run(
    log.id,
    log.planId ?? null,
    log.startedAt,
    log.finishedAt ?? null,
    JSON.stringify(log),
  );
}

export function getLog(id: string): WorkoutLog | undefined {
  const row = db.prepare("SELECT json FROM logs WHERE id = ?").get(id) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as WorkoutLog) : undefined;
}

/** Newest first. */
export function listLogs(limit = 50): WorkoutLog[] {
  const rows = db
    .prepare("SELECT json FROM logs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as Array<{ json: string }>;
  return rows.map((r) => JSON.parse(r.json) as WorkoutLog);
}

/* -------------------------------- chat ------------------------------- */

export function saveChatMessage(threadId: string, message: ChatMessage): void {
  db.prepare(
    `INSERT INTO chat_messages (id, thread_id, role, content, plan_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    threadId,
    message.role,
    message.content,
    message.planId ?? null,
    message.createdAt,
  );
}

/** Oldest first, capped — chat context is deliberately short to save tokens. */
export function getThread(threadId: string, limit = 12): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, role, content, plan_id, created_at FROM chat_messages
       WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(threadId, limit) as Array<{
    id: string;
    role: string;
    content: string;
    plan_id: string | null;
    created_at: string;
  }>;
  return rows
    .map((r) => ({
      id: r.id,
      role: r.role as ChatMessage["role"],
      content: r.content,
      createdAt: r.created_at,
      ...(r.plan_id ? { planId: r.plan_id } : {}),
    }))
    .reverse();
}

export function listThreads(limit = 20): Array<{ threadId: string; lastAt: string; preview: string }> {
  const rows = db
    .prepare(
      `SELECT thread_id, MAX(created_at) AS last_at,
              (SELECT content FROM chat_messages m2
                WHERE m2.thread_id = m1.thread_id
                ORDER BY created_at LIMIT 1) AS preview
         FROM chat_messages m1
        GROUP BY thread_id
        ORDER BY last_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ thread_id: string; last_at: string; preview: string }>;
  return rows.map((r) => ({
    threadId: r.thread_id,
    lastAt: r.last_at,
    preview: r.preview,
  }));
}

/* ------------------------------- usage ------------------------------- */

export function recordUsage(record: UsageRecord): void {
  db.prepare(
    `INSERT INTO usage (id, created_at, provider, model, purpose, input_tokens,
                        cached_tokens, write_tokens, output_tokens, cost_usd, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.createdAt,
    record.provider,
    record.model,
    record.purpose,
    record.inputTokens,
    record.cachedInputTokens,
    record.cacheWriteTokens,
    record.outputTokens,
    record.costUsd,
    record.latencyMs,
  );
}

export function recordPlannerHit(kind: "planner" | "cache"): void {
  db.prepare("INSERT INTO planner_hits (id, created_at, kind) VALUES (?, ?, ?)").run(
    crypto.randomUUID(),
    new Date().toISOString(),
    kind,
  );
}

export function listUsage(sinceIso: string): UsageRecord[] {
  const rows = db
    .prepare("SELECT * FROM usage WHERE created_at >= ? ORDER BY created_at DESC")
    .all(sinceIso) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r["id"] as string,
    createdAt: r["created_at"] as string,
    provider: r["provider"] as UsageRecord["provider"],
    model: r["model"] as string,
    purpose: r["purpose"] as UsageRecord["purpose"],
    inputTokens: r["input_tokens"] as number,
    cachedInputTokens: r["cached_tokens"] as number,
    cacheWriteTokens: r["write_tokens"] as number,
    outputTokens: r["output_tokens"] as number,
    costUsd: r["cost_usd"] as number,
    latencyMs: r["latency_ms"] as number,
  }));
}

export function spendSince(sinceIso: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage WHERE created_at >= ?")
    .get(sinceIso) as { total: number };
  return row.total;
}

export function countPlannerHits(sinceIso: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM planner_hits WHERE created_at >= ?")
    .get(sinceIso) as { n: number };
  return row.n;
}

/* ----------------------------- plan cache ---------------------------- */

export function getCachedPlanId(fingerprint: string, ttlMinutes: number): string | undefined {
  const cutoff = new Date(Date.now() - ttlMinutes * 60_000).toISOString();
  const row = db
    .prepare("SELECT plan_id FROM plan_cache WHERE fingerprint = ? AND created_at >= ?")
    .get(fingerprint, cutoff) as { plan_id: string } | undefined;
  return row?.plan_id;
}

export function setCachedPlanId(fingerprint: string, planId: string): void {
  db.prepare(
    `INSERT INTO plan_cache (fingerprint, plan_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       plan_id = excluded.plan_id, created_at = excluded.created_at`,
  ).run(fingerprint, planId, new Date().toISOString());
}

/* --------------------------------- kv -------------------------------- */

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

export function getDigest(): TrainingDigest | undefined {
  return kvGet<TrainingDigest>("training_digest");
}

export function setDigest(digest: TrainingDigest): void {
  kvSet("training_digest", digest);
}
