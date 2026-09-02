import { EXERCISE_BY_ID, computeProgression } from "@fc/shared";
import type { Focus, Muscle, TrainingDigest, WorkoutLog } from "@fc/shared";
import type { Store } from "../store/types.js";

const WINDOW_DAYS = 28;
const MAX_KEY_LIFTS = 6;

/**
 * Compresses training history into a few hundred tokens.
 *
 * This is the single biggest input-token lever in the app: sending the raw
 * logs for a few months of training would be tens of thousands of tokens per
 * call, and almost none of it changes the model's answer. The digest is
 * rebuilt only when a session is logged, not on every request.
 */
export function buildDigest(logs: WorkoutLog[], standingNotes: string[]): TrainingDigest {
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const recent = logs.filter((l) => new Date(l.startedAt).getTime() >= cutoff);

  const perWeek = recent.length / (WINDOW_DAYS / 7);
  const cadence = recent.length
    ? `${perWeek.toFixed(1)} sessions/week over the last ${WINDOW_DAYS} days`
    : "no sessions in the last 4 weeks";

  const recentFocuses: Focus[] = logs.slice(0, 5).map((l) => l.focus);

  const frequency = new Map<string, number>();
  for (const log of recent) {
    for (const entry of log.exercises) {
      if (entry.skipped) continue;
      frequency.set(entry.exerciseId, (frequency.get(entry.exerciseId) ?? 0) + 1);
    }
  }

  const keyLifts = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_KEY_LIFTS)
    .flatMap(([exerciseId]) => {
      const exercise = EXERCISE_BY_ID.get(exerciseId);
      if (!exercise) return [];
      const state = computeProgression(exerciseId, exercise.name, logs);
      const top = state.lastTopSet;
      if (!top) return [];
      const lastTopSet = top.weightKg
        ? `${top.reps}x${top.weightKg}kg`
        : top.seconds
          ? `${top.seconds}s`
          : `${top.reps} reps`;
      const trend: "up" | "flat" | "down" =
        state.stalledSessions === 0 ? "up" : state.stalledSessions >= 3 ? "down" : "flat";
      return [{ name: exercise.name, lastTopSet, trend }];
    });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    cadence,
    recentFocuses,
    keyLifts,
    underTrained: findUnderTrained(recent),
    standingNotes,
  };
}

function findUnderTrained(logs: WorkoutLog[]): Muscle[] {
  const counts = new Map<Muscle, number>();
  for (const log of logs) {
    for (const entry of log.exercises) {
      const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
      if (!exercise || entry.skipped) continue;
      const sets = entry.sets.filter((s) => s.completed).length;
      for (const m of exercise.primary) counts.set(m, (counts.get(m) ?? 0) + sets);
    }
  }
  if (!counts.size) return [];
  return [...counts.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([m]) => m);
}

/** Rebuilds and persists the digest. Called after a session is logged. */
export async function refreshDigest(store: Store): Promise<TrainingDigest> {
  const [logs, standingNotes] = await Promise.all([
    store.listLogs(60),
    store.kvGet<string[]>("standing_notes"),
  ]);
  const digest = buildDigest(logs, standingNotes ?? []);
  await store.setDigest(digest);
  return digest;
}
