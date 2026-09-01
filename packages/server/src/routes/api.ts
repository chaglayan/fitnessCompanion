import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  EQUIPMENT,
  EXERCISES,
  EXERCISE_BY_ID,
  FOCUSES,
  INJURY_AREAS,
  MUSCLES,
  computeProgression,
  videoUrl,
} from "@fc/shared";
import type { WorkoutLog } from "@fc/shared";
import { config } from "../config.js";
import {
  countPlannerHits,
  getLog,
  getPlan,
  getThread,
  kvGet,
  kvSet,
  listLogs,
  listPlans,
  listThreads,
  listUsage,
  saveLog,
} from "../db.js";
import { budgetStatus, chat, generateSession } from "../ai/coach.js";
import { refreshDigest } from "../ai/digest.js";
import { costWithoutCache } from "../ai/pricing.js";

export const api = Router();

/* ----------------------------- validation ---------------------------- */

const ConstraintsSchema = z.object({
  equipment: z.array(z.enum(EQUIPMENT)).default(["bodyweight"]),
  minutes: z.number().int().min(5).max(240).default(45),
  soreness: z
    .array(
      z.object({
        muscle: z.enum(MUSCLES),
        level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      }),
    )
    .default([]),
  injuries: z.array(z.enum(INJURY_AREAS)).default([]),
  energy: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
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
  soreness: z
    .array(
      z.object({
        muscle: z.enum(MUSCLES),
        level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      }),
    )
    .default([]),
});

/** Wraps an async handler so a rejected promise reaches the error middleware. */
function handle(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/* ----------------------------- exercises ----------------------------- */

api.get("/exercises", (_req, res) => {
  res.json(
    EXERCISES.map((e) => ({ ...e, videoUrl: videoUrl(e) })),
  );
});

api.get("/exercises/:id", (req, res) => {
  const exercise = EXERCISE_BY_ID.get(req.params.id);
  if (!exercise) {
    res.status(404).json({ error: "No such exercise." });
    return;
  }
  res.json({ ...exercise, videoUrl: videoUrl(exercise) });
});

/* ------------------------------- plans ------------------------------- */

api.post(
  "/plans/generate",
  handle(async (req, res) => {
    const parsed = z
      .object({
        constraints: ConstraintsSchema,
        forceAi: z.boolean().optional(),
        noCache: z.boolean().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request.", detail: parsed.error.issues });
      return;
    }

    const { constraints, forceAi, noCache } = parsed.data;
    const result = await generateSession(constraints, {
      ...(forceAi === undefined ? {} : { forceAi }),
      ...(noCache === undefined ? {} : { noCache }),
    });
    res.json(result);
  }),
);

api.get("/plans", (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 20) || 20, 100);
  res.json(listPlans(limit));
});

api.get("/plans/:id", (req, res) => {
  const plan = getPlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: "No such plan." });
    return;
  }
  res.json(plan);
});

/* -------------------------------- logs ------------------------------- */

api.post("/logs", (req, res) => {
  const parsed = LogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid log.", detail: parsed.error.issues });
    return;
  }
  const log: WorkoutLog = {
    ...parsed.data,
    id: parsed.data.id ?? crypto.randomUUID(),
  };
  saveLog(log);
  // The digest feeds every future AI call, so it is rebuilt on write, not read.
  const digest = refreshDigest();
  res.json({ log, digest });
});

api.get("/logs", (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 50) || 50, 200);
  res.json(listLogs(limit));
});

api.get("/logs/:id", (req, res) => {
  const log = getLog(req.params.id);
  if (!log) {
    res.status(404).json({ error: "No such log." });
    return;
  }
  res.json(log);
});

/* ------------------------------- stats ------------------------------- */

api.get("/stats/progression", (req, res) => {
  const logs = listLogs(200);
  const requested = String(req.query["exerciseId"] ?? "");

  if (requested) {
    const exercise = EXERCISE_BY_ID.get(requested);
    if (!exercise) {
      res.status(404).json({ error: "No such exercise." });
      return;
    }
    res.json(computeProgression(exercise.id, exercise.name, logs));
    return;
  }

  // Every exercise that appears in the history, most recently trained first.
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

  res.json(states);
});

/* -------------------------------- chat ------------------------------- */

api.post(
  "/chat",
  handle(async (req, res) => {
    const parsed = z
      .object({
        message: z.string().min(1).max(2000),
        threadId: z.string().optional(),
        planId: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request.", detail: parsed.error.issues });
      return;
    }

    const result = await chat(
      parsed.data.message,
      parsed.data.threadId,
      parsed.data.planId,
    );
    res.json(result);
  }),
);

api.get("/chat/threads", (_req, res) => {
  res.json(listThreads());
});

api.get("/chat/:threadId", (req, res) => {
  res.json(getThread(req.params.threadId, 100));
});

/* ------------------------------- usage ------------------------------- */

api.get("/usage", (req, res) => {
  const days = Math.min(Number(req.query["days"] ?? 30) || 30, 365);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const records = listUsage(since);
  const budget = budgetStatus();

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

  const totalCostUsd = records.reduce((sum, r) => sum + r.costUsd, 0);

  res.json({
    windowStart: since,
    totalCostUsd,
    budgetUsd: budget.budgetUsd,
    callCount: records.length,
    plannerOnlyCount: countPlannerHits(since),
    cacheHitRate: totalInputTokens ? cachedTokens / totalInputTokens : 0,
    /** What these same calls would have cost with no prompt caching. */
    costWithoutCachingUsd: uncachedCost,
    byPurpose,
    recent: records.slice(0, 25),
  });
});

/* ------------------------------ settings ----------------------------- */

const SettingsSchema = z.object({
  /** Persistent facts the coach should always know, e.g. "left shoulder impingement". */
  standingNotes: z.array(z.string().max(200)).max(20).optional(),
  defaultEquipment: z.array(z.enum(EQUIPMENT)).optional(),
  defaultMinutes: z.number().int().min(5).max(240).optional(),
});

api.get("/settings", (_req, res) => {
  res.json({
    standingNotes: kvGet<string[]>("standing_notes") ?? [],
    defaultEquipment: kvGet<string[]>("default_equipment") ?? ["bodyweight"],
    defaultMinutes: kvGet<number>("default_minutes") ?? 45,
    provider: config.provider,
    model: config.provider === "gemini" ? config.geminiModel : config.model,
    aiAvailable:
      config.provider === "gemini"
        ? Boolean(config.geminiApiKey)
        : Boolean(config.anthropicApiKey),
  });
});

api.put("/settings", (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings.", detail: parsed.error.issues });
    return;
  }
  const { standingNotes, defaultEquipment, defaultMinutes } = parsed.data;
  if (standingNotes) {
    kvSet("standing_notes", standingNotes);
    // Standing notes are part of the digest the model sees.
    refreshDigest();
  }
  if (defaultEquipment) kvSet("default_equipment", defaultEquipment);
  if (defaultMinutes) kvSet("default_minutes", defaultMinutes);
  res.json({ ok: true });
});
