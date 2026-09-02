import type {
  ChatMessage,
  TrainingDigest,
  UsageRecord,
  WorkoutLog,
  WorkoutPlan,
} from "@fc/shared";

export interface ThreadSummary {
  threadId: string;
  lastAt: string;
  preview: string;
}

/**
 * Everything the app needs from storage, async so the same interface covers
 * node:sqlite (synchronous under the hood) and Cloudflare D1 (network-backed).
 */
export interface Store {
  savePlan(plan: WorkoutPlan): Promise<void>;
  getPlan(id: string): Promise<WorkoutPlan | undefined>;
  listPlans(limit?: number): Promise<WorkoutPlan[]>;

  saveLog(log: WorkoutLog): Promise<void>;
  getLog(id: string): Promise<WorkoutLog | undefined>;
  /** Newest first. */
  listLogs(limit?: number): Promise<WorkoutLog[]>;

  saveChatMessage(threadId: string, message: ChatMessage): Promise<void>;
  /** Oldest first, capped — chat context is kept short to save tokens. */
  getThread(threadId: string, limit?: number): Promise<ChatMessage[]>;
  listThreads(limit?: number): Promise<ThreadSummary[]>;

  recordUsage(record: UsageRecord): Promise<void>;
  recordPlannerHit(kind: "planner" | "cache"): Promise<void>;
  listUsage(sinceIso: string): Promise<UsageRecord[]>;
  spendSince(sinceIso: string): Promise<number>;
  countPlannerHits(sinceIso: string): Promise<number>;

  getCachedPlanId(fingerprint: string, ttlMinutes: number): Promise<string | undefined>;
  setCachedPlanId(fingerprint: string, planId: string): Promise<void>;

  getDigest(): Promise<TrainingDigest | undefined>;
  setDigest(digest: TrainingDigest): Promise<void>;
  kvGet<T>(key: string): Promise<T | undefined>;
  kvSet(key: string, value: unknown): Promise<void>;
}

/**
 * The only thing a backend has to implement. Both node:sqlite and D1 speak
 * SQLite dialect, so every query in `createStore` is shared between them.
 */
export interface Driver {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
}
