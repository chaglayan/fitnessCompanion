import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  EQUIPMENT,
  EXERCISES,
  EXERCISE_BY_ID,
  FOCUSES,
  INJURY_AREAS,
  MUSCLES,
  SELECTABLE_MODELS,
  computeProgression,
  videoUrl,
} from "@fc/shared";
import type { WorkoutLog } from "@fc/shared";
import { activeModel, aiAvailable } from "./config.js";
import { budgetStatus, chat, generateSession, revisePlan } from "./ai/coach.js";
import { adjustPlan, removeExercise, swapExercise } from "./planner/index.js";
import type { Deps } from "./ai/coach.js";
import { refreshDigest } from "./ai/digest.js";
import { costWithoutCache } from "./ai/pricing.js";

/* ----------------------------- validation ---------------------------- */

const SorenessSchema = z.array(
  z.object({
    muscle: z.enum(MUSCLES),
    level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  }),
);

const ConstraintsSchema = z.object({
  equipment: z.array(z.enum(EQUIPMENT)).default(["bodyweight"]),
  minutes: z.number().int().min(5).max(240).default(45),
  soreness: SorenessSchema.default([]),
  injuries: z.array(z.enum(INJURY_AREAS)).default([]),
  energy: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  focus: z.enum(FOCUSES).optional(),
  notes: z.string().max(1000).optional(),
});

const SetSchema = z.object({
  setIndex: z.number().int().min(0),
  reps: z.number().int().min(0).max(500).optional(),
  seconds: z.number().int().min(0).max(7200).optional(),
  metres: z.number().min(0).max(100000).optional(),
  weightKg: z.number().min(0).max(1000).optional(),
  rpe: z.number().min(1).max(10).optional(),
  completed: z.boolean(),
  side: z.enum(["left", "right"]).optional(),
});

const LogSchema = z.object({
  id: z.string().optional(),
  planId: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  focus: z.enum(FOCUSES),
  exercises: z.array(
    z.object({
      exerciseId: z.string(),
      name: z.string(),
      sets: z.array(SetSchema),
      note: z.string().max(500).optional(),
      skipped: z.boolean().optional(),
    }),
  ),
  rating: z.number().int().min(1).max(5).optional(),
  note: z.string().max(1000).optional(),
  soreness: SorenessSchema.default([]),
});

const SettingsSchema = z.object({
  /** Persistent facts the coach should always know, e.g. "left shoulder impingement". */
  standingNotes: z.array(z.string().max(200)).max(20).optional(),
  defaultEquipment: z.array(z.enum(EQUIPMENT)).optional(),
  defaultMinutes: z.number().int().min(5).max(240).optional(),
  model: z.enum(SELECTABLE_MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
});

/** Compares two strings without leaking their difference through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The HTTP API. Runs unchanged on Node and on Cloudflare Workers — the entry
 * points differ only in how they build `Deps` and how they serve static files.
 */
export function createApi(getDeps: (c: { env: unknown }) => Deps): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const { config } = getDeps(c as unknown as { env: unknown });
    return cors({
      origin: config.corsOrigins.includes("*") ? "*" : config.corsOrigins,
    })(c, next);
  });

  // Open, so uptime checks work without handing out the token.
  app.get("/api/health", (c) => {
    const { config } = getDeps(c as unknown as { env: unknown });
    return c.json({ ok: true, provider: config.provider });
  });

  // Single shared secret, sent by both the laptop and the phone.
  app.use("/api/*", async (c, next) => {
    const { config } = getDeps(c as unknown as { env: unknown });
    if (config.allowNoAuth) return next();
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!timingSafeEqual(token, config.authToken)) {
      return c.json({ error: "Unauthorized." }, 401);
    }
    return next();
  });

  /* ---------------------------- exercises --------------------------- */

  app.get("/api/exercises", (c) =>
    c.json(EXERCISES.map((e) => ({ ...e, videoUrl: videoUrl(e) }))),
  );

  app.get("/api/exercises/:id", (c) => {
    const exercise = EXERCISE_BY_ID.get(c.req.param("id"));
    if (!exercise) return c.json({ error: "No such exercise." }, 404);
    return c.json({ ...exercise, videoUrl: videoUrl(exercise) });
  });

  /* ------------------------------ plans ----------------------------- */

  app.post("/api/plans/generate", async (c) => {
    const deps = getDeps(c as unknown as { env: unknown });
    const parsed = z
      .object({
        constraints: ConstraintsSchema,
        forceAi: z.boolean().optional(),
        noCache: z.boolean().optional(),
      })
      .safeParse(await c.req.json().catch(() => undefined));

    if (!parsed.success) {
      return c.json({ error: "Invalid request.", detail: parsed.error.issues }, 400);
    }
    const { constraints, forceAi, noCache } = parsed.data;
    return c.json(
      await generateSession(deps, constraints, {
        ...(forceAi === undefined ? {} : { forceAi }),
        ...(noCache === undefined ? {} : { noCache }),
      }),
    );
  });

  /**
   * Free, instant plan changes. Everything here is deterministic — no model
   * call, no tokens — which is why it is a separate endpoint from /revise.
   */
  app.post("/api/plans/:id/adjust", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const parsed = z
      .discriminatedUnion("op", [
        z.object({
          op: z.enum(["harder", "easier", "shorter", "longer", "more_variety"]),
        }),
        z.object({ op: z.enum(["swap", "remove"]), exerciseId: z.string().min(1) }),
      ])
      .safeParse(await c.req.json().catch(() => undefined));

    if (!parsed.success) {
      return c.json({ error: "Unknown adjustment.", detail: parsed.error.issues }, 400);
    }

    const current = await store.getPlan(c.req.param("id"));
    if (!current) return c.json({ error: "That session no longer exists." }, 404);

    const logs = await store.listLogs(40);
    const body = parsed.data;
    const result =
      body.op === "swap"
        ? swapExercise(current, body.exerciseId, logs)
        : body.op === "remove"
          ? removeExercise(current, body.exerciseId)
          : adjustPlan(current, body.op, logs);

    await store.savePlan(result.plan);
    return c.json({ plan: result.plan, routing: `${result.note} (free — no AI call)` });
  });

  app.post("/api/plans/:id/revise", async (c) => {
    const deps = getDeps(c as unknown as { env: unknown });
    const parsed = z
      .object({ feedback: z.string().min(1).max(1000) })
      .safeParse(await c.req.json().catch(() => undefined));

    if (!parsed.success) {
      return c.json({ error: "Tell me what to change.", detail: parsed.error.issues }, 400);
    }
    try {
      return c.json(await revisePlan(deps, c.req.param("id"), parsed.data.feedback));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 404);
    }
  });

  app.get("/api/plans", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
    return c.json(await store.listPlans(limit));
  });

  app.get("/api/plans/:id", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const plan = await store.getPlan(c.req.param("id"));
    if (!plan) return c.json({ error: "No such plan." }, 404);
    return c.json(plan);
  });

  /* ------------------------------- logs ----------------------------- */

  app.post("/api/logs", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const parsed = LogSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "Invalid log.", detail: parsed.error.issues }, 400);
    }
    const log: WorkoutLog = { ...parsed.data, id: parsed.data.id ?? crypto.randomUUID() };
    await store.saveLog(log);
    // The digest feeds every future AI call, so it is rebuilt on write.
    const digest = await refreshDigest(store);
    return c.json({ log, digest });
  });

  app.get("/api/logs", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    return c.json(await store.listLogs(limit));
  });

  app.get("/api/logs/:id", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const log = await store.getLog(c.req.param("id"));
    if (!log) return c.json({ error: "No such log." }, 404);
    return c.json(log);
  });

  /* ------------------------------ stats ----------------------------- */

  app.get("/api/stats/progression", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const logs = await store.listLogs(200);
    const requested = c.req.query("exerciseId") ?? "";

    if (requested) {
      const exercise = EXERCISE_BY_ID.get(requested);
      if (!exercise) return c.json({ error: "No such exercise." }, 404);
      return c.json(computeProgression(exercise.id, exercise.name, logs));
    }

    const seen = new Set<string>();
    for (const log of logs) for (const e of log.exercises) seen.add(e.exerciseId);

    const states = [...seen]
      .flatMap((id) => {
        const exercise = EXERCISE_BY_ID.get(id);
        return exercise ? [computeProgression(id, exercise.name, logs)] : [];
      })
      // Planned-but-skipped exercises have nothing to report.
      .filter((state) => state.sessions > 0)
      .sort((a, b) => (b.lastPerformed ?? "").localeCompare(a.lastPerformed ?? ""));

    return c.json(states);
  });

  /* ------------------------------- chat ----------------------------- */

  app.post("/api/chat", async (c) => {
    const deps = getDeps(c as unknown as { env: unknown });
    const parsed = z
      .object({
        message: z.string().min(1).max(2000),
        threadId: z.string().optional(),
        planId: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => undefined));

    if (!parsed.success) {
      return c.json({ error: "Invalid request.", detail: parsed.error.issues }, 400);
    }
    return c.json(
      await chat(deps, parsed.data.message, parsed.data.threadId, parsed.data.planId),
    );
  });

  app.get("/api/chat/threads", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    return c.json(await store.listThreads());
  });

  app.get("/api/chat/:threadId", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    return c.json(await store.getThread(c.req.param("threadId"), 100));
  });

  /* ------------------------------ usage ----------------------------- */

  app.get("/api/usage", async (c) => {
    const deps = getDeps(c as unknown as { env: unknown });
    const days = Math.min(Number(c.req.query("days") ?? 30) || 30, 365);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [records, budget, plannerOnlyCount] = await Promise.all([
      deps.store.listUsage(since),
      budgetStatus(deps),
      deps.store.countPlannerHits(since),
    ]);

    const byPurpose: Record<string, { calls: number; costUsd: number }> = {};
    let cachedTokens = 0;
    let totalInputTokens = 0;
    let uncachedCost = 0;

    for (const r of records) {
      const bucket = byPurpose[r.purpose] ?? { calls: 0, costUsd: 0 };
      bucket.calls += 1;
      bucket.costUsd += r.costUsd;
      byPurpose[r.purpose] = bucket;

      cachedTokens += r.cachedInputTokens;
      totalInputTokens += r.inputTokens + r.cachedInputTokens + r.cacheWriteTokens;
      uncachedCost += costWithoutCache(r.provider, r.model, r);
    }

    return c.json({
      windowStart: since,
      totalCostUsd: records.reduce((sum, r) => sum + r.costUsd, 0),
      budgetUsd: budget.budgetUsd,
      callCount: records.length,
      plannerOnlyCount,
      cacheHitRate: totalInputTokens ? cachedTokens / totalInputTokens : 0,
      /** What these same calls would have cost with no prompt caching. */
      costWithoutCachingUsd: uncachedCost,
      byPurpose,
      recent: records.slice(0, 25),
    });
  });

  /* ----------------------------- settings --------------------------- */

  app.get("/api/settings", async (c) => {
    const { store, config } = getDeps(c as unknown as { env: unknown });
    const [standingNotes, defaultEquipment, defaultMinutes] = await Promise.all([
      store.kvGet<string[]>("standing_notes"),
      store.kvGet<string[]>("default_equipment"),
      store.kvGet<number>("default_minutes"),
    ]);
    return c.json({
      standingNotes: standingNotes ?? [],
      defaultEquipment: defaultEquipment ?? ["bodyweight"],
      defaultMinutes: defaultMinutes ?? 45,
      provider: config.provider,
      model: (await store.kvGet<string>("ai_model")) ?? activeModel(config),
      aiAvailable: aiAvailable(config),
      selectableModels: SELECTABLE_MODELS,
    });
  });

  app.put("/api/settings", async (c) => {
    const { store } = getDeps(c as unknown as { env: unknown });
    const parsed = SettingsSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "Invalid settings.", detail: parsed.error.issues }, 400);
    }
    const { standingNotes, defaultEquipment, defaultMinutes } = parsed.data;
    if (standingNotes) {
      await store.kvSet("standing_notes", standingNotes);
      // Standing notes are part of the digest the model sees.
      await refreshDigest(store);
    }
    if (defaultEquipment) await store.kvSet("default_equipment", defaultEquipment);
    if (defaultMinutes) await store.kvSet("default_minutes", defaultMinutes);
    if (parsed.data.model) await store.kvSet("ai_model", parsed.data.model);
    return c.json({ ok: true });
  });

  app.onError((error, c) => {
    console.error("[server]", error);
    return c.json({ error: "Internal error." }, 500);
  });

  return app;
}
