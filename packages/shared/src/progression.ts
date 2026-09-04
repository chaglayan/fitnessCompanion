import type {
  Exercise,
  Experience,
  LoggedSet,
  ProgressionState,
  SetPrescription,
  WorkoutLog,
} from "./types.js";

/**
 * How each level pitches a first, historyless prescription: where in the rep
 * range to start, and how much to adjust the reps-in-reserve target.
 */
export const EXPERIENCE_PROFILE: Record<
  Experience,
  { startAt: "min" | "mid" | "max"; rirDelta: number; volumeScale: number }
> = {
  beginner: { startAt: "min", rirDelta: 1, volumeScale: 0.85 },
  intermediate: { startAt: "mid", rirDelta: 0, volumeScale: 1 },
  advanced: { startAt: "max", rirDelta: -1, volumeScale: 1.15 },
};

/**
 * Epley estimated one-rep max. Accurate enough for progression decisions in
 * the 1-12 rep range, which is all we use it for.
 */
export function estimate1rm(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Inverse of `estimate1rm` — the load predicted to allow exactly `reps`. */
export function loadForReps(e1rmKg: number, reps: number): number {
  if (reps <= 1) return e1rmKg;
  return e1rmKg / (1 + reps / 30);
}

/** Smallest plate jump available, used to round prescriptions to something loadable. */
export function roundToIncrement(weightKg: number, incrementKg = 2.5): number {
  if (weightKg <= 0) return 0;
  return Math.max(incrementKg, Math.round(weightKg / incrementKg) * incrementKg);
}

function isWorkingSet(set: LoggedSet): boolean {
  return set.completed && (set.reps ?? 0) > 0;
}

/**
 * Walks the log history for one exercise and derives its current state:
 * best e1RM, last top set, volume, and how long it has been stalled.
 *
 * `logs` may be in any order; it is sorted internally, newest last.
 */
export function computeProgression(
  exerciseId: string,
  exerciseName: string,
  logs: WorkoutLog[],
  trailingWindowDays = 28,
): ProgressionState {
  const sorted = [...logs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const cutoff = Date.now() - trailingWindowDays * 86_400_000;

  const state: ProgressionState = {
    exerciseId,
    name: exerciseName,
    sessions: 0,
    trailingVolumeKg: 0,
    stalledSessions: 0,
  };

  /** Best e1RM per session, oldest first — used for the stall check. */
  const perSessionBest: number[] = [];

  for (const log of sorted) {
    const entry = log.exercises.find((e) => e.exerciseId === exerciseId);
    if (!entry || entry.skipped) continue;
    const working = entry.sets.filter(isWorkingSet);
    if (!working.length) continue;

    state.sessions += 1;
    state.lastPerformed = log.startedAt;

    let sessionBestE1rm = 0;
    let topSet: LoggedSet | undefined;

    for (const set of working) {
      const reps = set.reps ?? 0;
      const weight = set.weightKg ?? 0;

      if (new Date(log.startedAt).getTime() >= cutoff) {
        state.trailingVolumeKg += reps * weight;
      }

      // Rank by e1RM when loaded, by reps when bodyweight.
      const score = weight > 0 ? estimate1rm(weight, reps) : reps;
      if (score > sessionBestE1rm) {
        sessionBestE1rm = score;
        topSet = set;
      }
    }

    if (topSet) {
      state.lastTopSet = {
        reps: topSet.reps ?? 0,
        ...(topSet.weightKg === undefined ? {} : { weightKg: topSet.weightKg }),
        ...(topSet.seconds === undefined ? {} : { seconds: topSet.seconds }),
      };
    }
    if ((topSet?.weightKg ?? 0) > 0) {
      state.bestE1rmKg = Math.max(state.bestE1rmKg ?? 0, sessionBestE1rm);
    }
    perSessionBest.push(sessionBestE1rm);
  }

  // Count back from the most recent session while performance has not improved.
  let stalled = 0;
  for (let i = perSessionBest.length - 1; i > 0; i--) {
    const current = perSessionBest[i] ?? 0;
    const previous = perSessionBest[i - 1] ?? 0;
    if (current > previous) break;
    stalled += 1;
  }
  state.stalledSessions = stalled;

  return state;
}

export interface PrescriptionOptions {
  /** Target sets for this slot. */
  sets: number;
  /** Working rep range, inclusive. */
  repRange: [number, number];
  /** Reps in reserve to prescribe. */
  rir: number;
  /** Smallest loadable jump for this exercise, in kg. */
  incrementKg?: number;
  /** Scales volume down for low energy or high soreness (0.5 - 1.0). */
  volumeScale?: number;
  /** Defaults to "intermediate". */
  experience?: Experience;
}

/**
 * Double progression: work up the rep range at a fixed load, then add load and
 * drop back to the bottom of the range. Deloads 10% after three stalled
 * sessions. Falls back to a sensible starting prescription with no history.
 */
export function nextPrescription(
  exercise: Exercise,
  state: ProgressionState | undefined,
  options: PrescriptionOptions,
): SetPrescription[] {
  const { sets, repRange, rir } = options;
  const increment = options.incrementKg ?? (exercise.pattern === "isolation" ? 1.25 : 2.5);
  const scale = options.volumeScale ?? 1;
  const [minReps, maxReps] = repRange;
  const setCount = Math.max(1, Math.round(sets * scale));

  if (exercise.metric === "time") {
    const lastSeconds = state?.lastTopSet?.seconds ?? 0;
    const base = lastSeconds > 0 ? lastSeconds : defaultHoldSeconds(exercise);
    // Add 5s per session on holds until 90s, then it is time for a harder variation.
    const target = Math.round(Math.min(base + (lastSeconds > 0 ? 5 : 0), 90) * scale);
    return Array.from({ length: setCount }, () => ({ seconds: Math.max(15, target) }));
  }

  if (exercise.metric === "distance") {
    const lastMetres = 20;
    return Array.from({ length: setCount }, () => ({
      metres: Math.round(lastMetres * scale),
    }));
  }

  const last = state?.lastTopSet;
  const loaded = requiresLoad(exercise);

  // No history: pitch the first session by stated experience rather than
  // always starting at the bottom of the range.
  if (!last || last.reps === 0) {
    const profile = EXPERIENCE_PROFILE[options.experience ?? "intermediate"];
    const startReps =
      profile.startAt === "min"
        ? minReps
        : profile.startAt === "max"
          ? maxReps
          : Math.round((minReps + maxReps) / 2);
    return Array.from({ length: setCount }, () => ({
      reps: startReps,
      rir: Math.max(0, rir + profile.rirDelta),
    }));
  }

  const lastReps = last.reps;
  const lastWeight = last.weightKg ?? 0;

  // Stalled three sessions running — back off 10% and rebuild.
  if ((state?.stalledSessions ?? 0) >= 3 && lastWeight > 0) {
    const deloaded = roundToIncrement(lastWeight * 0.9, increment);
    return Array.from({ length: setCount }, () => ({
      reps: minReps,
      weightKg: deloaded,
      rir: rir + 1,
    }));
  }

  // Top of the rep range reached: add load (or, unloaded, add reps).
  if (lastReps >= maxReps) {
    if (lastWeight > 0) {
      return Array.from({ length: setCount }, () => ({
        reps: minReps,
        weightKg: roundToIncrement(lastWeight + increment, increment),
        rir,
      }));
    }
    return Array.from({ length: setCount }, () => ({
      reps: lastReps + 1,
      rir,
    }));
  }

  // Mid-range: same load, one more rep.
  return Array.from({ length: setCount }, () => ({
    reps: Math.min(lastReps + 1, maxReps),
    ...(lastWeight > 0 ? { weightKg: lastWeight } : {}),
    rir,
  }));
}

function requiresLoad(exercise: Exercise): boolean {
  return exercise.equipment.some((e) =>
    ["barbell", "dumbbell", "kettlebell", "cable", "machine", "sled"].includes(e),
  );
}

function defaultHoldSeconds(exercise: Exercise): number {
  if (exercise.pattern === "mobility") return 30;
  if (exercise.pattern === "conditioning") return 40;
  return 30;
}
