import type {
  ChatMessage,
  TrainingDigest,
  UsageRecord,
  WorkoutLog,
  WorkoutPlan,
} from "@fc/shared";
import type { Driver, Store, ThreadSummary } from "./types.js";

/**
 * All the domain queries, written once against the minimal `Driver` surface so
 * the Node and Cloudflare backends share exactly the same SQL.
 */
export function createStore(driver: Driver): Store {
  return {
    /* ------------------------------ plans ----------------------------- */

    async savePlan(plan: WorkoutPlan) {
      await driver.run(
        `INSERT INTO plans (id, for_date, created_at, source, json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, source = excluded.source`,
        [plan.id, plan.forDate, plan.createdAt, plan.source, JSON.stringify(plan)],
      );
    },

    async getPlan(id: string) {
      const row = await driver.first<{ json: string }>(
        "SELECT json FROM plans WHERE id = ?",
        [id],
      );
      return row ? (JSON.parse(row.json) as WorkoutPlan) : undefined;
    },

    async listPlans(limit = 20) {
      const rows = await driver.all<{ json: string }>(
        "SELECT json FROM plans ORDER BY created_at DESC LIMIT ?",
        [limit],
      );
      return rows.map((r) => JSON.parse(r.json) as WorkoutPlan);
    },

    /* ------------------------------- logs ----------------------------- */

    async saveLog(log: WorkoutLog) {
      await driver.run(
        `INSERT INTO logs (id, plan_id, started_at, finished_at, json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           finished_at = excluded.finished_at, json = excluded.json`,
        [
          log.id,
          log.planId ?? null,
          log.startedAt,
          log.finishedAt ?? null,
          JSON.stringify(log),
        ],
      );
    },

    async getLog(id: string) {
      const row = await driver.first<{ json: string }>(
        "SELECT json FROM logs WHERE id = ?",
        [id],
      );
      return row ? (JSON.parse(row.json) as WorkoutLog) : undefined;
    },

    async listLogs(limit = 50) {
      const rows = await driver.all<{ json: string }>(
        "SELECT json FROM logs ORDER BY started_at DESC LIMIT ?",
        [limit],
      );
      return rows.map((r) => JSON.parse(r.json) as WorkoutLog);
    },

    /* ------------------------------- chat ----------------------------- */

    async saveChatMessage(threadId: string, message: ChatMessage) {
      await driver.run(
        `INSERT INTO chat_messages (id, thread_id, role, content, plan_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          threadId,
          message.role,
          message.content,
          message.planId ?? null,
          message.createdAt,
        ],
      );
    },

    async getThread(threadId: string, limit = 12) {
      const rows = await driver.all<{
        id: string;
        role: string;
        content: string;
        plan_id: string | null;
        created_at: string;
      }>(
        `SELECT id, role, content, plan_id, created_at FROM chat_messages
         WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`,
        [threadId, limit],
      );
      return rows
        .map((r) => ({
          id: r.id,
          role: r.role as ChatMessage["role"],
          content: r.content,
          createdAt: r.created_at,
          ...(r.plan_id ? { planId: r.plan_id } : {}),
        }))
        .reverse();
    },

    async listThreads(limit = 20): Promise<ThreadSummary[]> {
      const rows = await driver.all<{
        thread_id: string;
        last_at: string;
        preview: string;
      }>(
        `SELECT thread_id, MAX(created_at) AS last_at,
                (SELECT content FROM chat_messages m2
                  WHERE m2.thread_id = m1.thread_id
                  ORDER BY created_at LIMIT 1) AS preview
           FROM chat_messages m1
          GROUP BY thread_id
          ORDER BY last_at DESC LIMIT ?`,
        [limit],
      );
      return rows.map((r) => ({
        threadId: r.thread_id,
        lastAt: r.last_at,
        preview: r.preview,
      }));
    },

    /* ------------------------------ usage ----------------------------- */

    async recordUsage(record: UsageRecord) {
      await driver.run(
        `INSERT INTO usage (id, created_at, provider, model, purpose, input_tokens,
                            cached_tokens, write_tokens, output_tokens, thinking_tokens,
                            cost_usd, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.createdAt,
          record.provider,
          record.model,
          record.purpose,
          record.inputTokens,
          record.cachedInputTokens,
          record.cacheWriteTokens,
          record.outputTokens,
          record.thinkingTokens ?? 0,
          record.costUsd,
          record.latencyMs,
        ],
      );
    },

    async recordPlannerHit(kind: "planner" | "cache") {
      await driver.run(
        "INSERT INTO planner_hits (id, created_at, kind) VALUES (?, ?, ?)",
        [crypto.randomUUID(), new Date().toISOString(), kind],
      );
    },

    async listUsage(sinceIso: string) {
      const rows = await driver.all<Record<string, unknown>>(
        "SELECT * FROM usage WHERE created_at >= ? ORDER BY created_at DESC",
        [sinceIso],
      );
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
        thinkingTokens: (r["thinking_tokens"] as number | undefined) ?? 0,
        costUsd: r["cost_usd"] as number,
        latencyMs: r["latency_ms"] as number,
      }));
    },

    async spendSince(sinceIso: string) {
      const row = await driver.first<{ total: number }>(
        "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage WHERE created_at >= ?",
        [sinceIso],
      );
      return row?.total ?? 0;
    },

    async countPlannerHits(sinceIso: string) {
      const row = await driver.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM planner_hits WHERE created_at >= ?",
        [sinceIso],
      );
      return row?.n ?? 0;
    },

    /* ---------------------------- plan cache -------------------------- */

    async getCachedPlanId(fingerprint: string, ttlMinutes: number) {
      const cutoff = new Date(Date.now() - ttlMinutes * 60_000).toISOString();
      const row = await driver.first<{ plan_id: string }>(
        "SELECT plan_id FROM plan_cache WHERE fingerprint = ? AND created_at >= ?",
        [fingerprint, cutoff],
      );
      return row?.plan_id;
    },

    async setCachedPlanId(fingerprint: string, planId: string) {
      await driver.run(
        `INSERT INTO plan_cache (fingerprint, plan_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(fingerprint) DO UPDATE SET
           plan_id = excluded.plan_id, created_at = excluded.created_at`,
        [fingerprint, planId, new Date().toISOString()],
      );
    },

    /* -------------------------------- kv ------------------------------ */

    async kvGet<T>(key: string) {
      const row = await driver.first<{ value: string }>(
        "SELECT value FROM kv WHERE key = ?",
        [key],
      );
      return row ? (JSON.parse(row.value) as T) : undefined;
    },

    async kvSet(key: string, value: unknown) {
      await driver.run(
        "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, JSON.stringify(value)],
      );
    },

    async getDigest() {
      return this.kvGet<TrainingDigest>("training_digest");
    },

    async setDigest(digest: TrainingDigest) {
      await this.kvSet("training_digest", digest);
    },
  };
}
