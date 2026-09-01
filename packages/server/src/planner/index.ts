import {
  EXERCISES,
  EXERCISE_BY_ID,
  computeProgression,
  isAvailable,
  nextPrescription,
} from "@fc/shared";
import type {
  Exercise,
  Focus,
  Muscle,
  Pattern,
  PlannedExercise,
  SessionConstraints,
  SetPrescription,
  WorkoutBlock,
  WorkoutLog,
  WorkoutPlan,
} from "@fc/shared";
import { BLOCK_FOR_ROLE, BLOCK_ORDER, FOCUS_MUSCLES, TEMPLATES } from "./templates.js";
import type { Slot } from "./templates.js";

/** Soreness at or above this level takes a muscle out of the candidate pool. */
const SORE_BLOCK_LEVEL = 2;

/** Rough seconds per rep, used only for time estimation. */
const SECONDS_PER_REP = 3;

export interface PlannerInput {
  constraints: SessionConstraints;
  /** Recent logs, newest first. Used for progression and rotation. */
  logs: WorkoutLog[];
}

export interface PlannerResult {
  plan: WorkoutPlan;
  /** Notes on anything the planner had to work around. */
  adaptations: string[];
}

/**
 * Builds a complete session with no AI call. Everything the model would
 * otherwise reason about — equipment filtering, injury avoidance, soreness,
 * progression, time fitting — is deterministic here.
 */
export function buildPlan(input: PlannerInput): PlannerResult {
  const { constraints, logs } = input;
  const adaptations: string[] = [];
  const equipment = constraints.equipment.length ? constraints.equipment : ["bodyweight" as const];

  const focus = constraints.focus ?? pickFocus(logs);
  const template = TEMPLATES[focus];

  const soreMuscles = new Set<Muscle>(
    constraints.soreness.filter((s) => s.level >= SORE_BLOCK_LEVEL).map((s) => s.muscle),
  );
  const injuries = new Set(constraints.injuries);

  // Candidate pool: kit you have, nothing that loads an injured area.
  const excludedByInjury: string[] = [];
  const pool = EXERCISES.filter((e) => {
    if (!isAvailable(e, equipment)) return false;
    if (e.stresses.some((area) => injuries.has(area))) {
      excludedByInjury.push(e.name);
      return false;
    }
    return true;
  });

  if (injuries.size) {
    adaptations.push(
      `Excluded ${excludedByInjury.length} exercises that load your ${[...injuries].join(", ")}.`,
    );
  }
  if (soreMuscles.size) {
    adaptations.push(
      `Deprioritised ${[...soreMuscles].join(", ")} — you flagged those as sore.`,
    );
  }

  // Volume scaling from energy: 3 is neutral, 1 cuts a third, 5 adds a little.
  const volumeScale = { 1: 0.6, 2: 0.8, 3: 1, 4: 1, 5: 1.1 }[constraints.energy] ?? 1;
  if (volumeScale < 1) {
    adaptations.push(`Cut volume to ${Math.round(volumeScale * 100)}% for low energy.`);
  }

  // Exercises done in the two most recent sessions, to keep things varied.
  const recentIds = new Set<string>();
  for (const log of logs.slice(0, 2)) {
    for (const e of log.exercises) recentIds.add(e.exerciseId);
  }

  const underTrained = findUnderTrained(logs);

  // Everything the user has ever logged. A movement they have done before is
  // known to be within their capability; an untried difficulty-3 variation is
  // a guess, so proven work is preferred at equal fit.
  const provenIds = new Set<string>();
  for (const log of logs) {
    for (const e of log.exercises) {
      if (!e.skipped && e.sets.some((s) => s.completed)) provenIds.add(e.exerciseId);
    }
  }

  const chosen: Array<{ slot: Slot; exercise: Exercise; sets: SetPrescription[] }> = [];
  const usedIds = new Set<string>();

  for (const slot of template.slots) {
    const exercise = pickForSlot({
      slot,
      pool,
      usedIds,
      recentIds,
      soreMuscles,
      underTrained,
      provenIds,
      energy: constraints.energy,
    });
    if (!exercise) continue;
    usedIds.add(exercise.id);

    const state = computeProgression(exercise.id, exercise.name, logs);
    const sets = nextPrescription(exercise, state, {
      sets: slot.sets,
      repRange: slot.repRange,
      rir: slot.rir,
      volumeScale,
    });
    chosen.push({ slot, exercise, sets });
  }

  // A long session runs the template out of slots before it runs out of
  // clock. Add accessory work from the same pool rather than pushing every
  // movement to eight sets.
  const fillerPatterns: Pattern[][] = [
    ...template.slots
      .filter((s) => s.role === "main" || s.role === "accessory")
      .map((s) => s.patterns),
    ["isolation"],
    ["core"],
  ];

  for (let i = 0; i < fillerPatterns.length * 2; i++) {
    if (estimateMinutes(chosen) >= constraints.minutes * 0.85) break;
    const patterns = fillerPatterns[i % fillerPatterns.length];
    if (!patterns) continue;
    const focusMuscles = FOCUS_MUSCLES[focus];
    const slot: Slot = {
      role: "accessory",
      patterns,
      sets: 3,
      repRange: [8, 12],
      rir: 2,
      priority: 5,
      ...(focusMuscles ? { muscles: focusMuscles } : {}),
    };
    const exercise = pickForSlot({
      slot,
      pool,
      usedIds,
      recentIds,
      soreMuscles,
      underTrained,
      provenIds,
      energy: constraints.energy,
    });
    if (!exercise) continue;
    usedIds.add(exercise.id);
    const state = computeProgression(exercise.id, exercise.name, logs);
    chosen.push({
      slot,
      exercise,
      sets: nextPrescription(exercise, state, {
        sets: slot.sets,
        repRange: slot.repRange,
        rir: slot.rir,
        volumeScale,
      }),
    });
  }

  // Fit the time budget: trim when over, add working sets back when well under.
  const fitted = expandToBudget(fitToBudget(chosen, constraints.minutes), constraints.minutes);
  if (fitted.length < chosen.length) {
    adaptations.push(
      `Trimmed ${chosen.length - fitted.length} exercise(s) to fit ${constraints.minutes} minutes.`,
    );
  }

  const blocks = toBlocks(fitted, recentIds, soreMuscles, injuries);
  const estimatedMinutes = estimateMinutes(fitted);

  const plan: WorkoutPlan = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    forDate: new Date().toISOString().slice(0, 10),
    title: template.title,
    focus,
    estimatedMinutes,
    blocks,
    summary: buildSummary(template.title, fitted.length, estimatedMinutes, adaptations),
    constraints,
    source: "planner",
  };

  return { plan, adaptations };
}

/* ----------------------------- selection ----------------------------- */

interface PickArgs {
  slot: Slot;
  pool: Exercise[];
  usedIds: Set<string>;
  recentIds: Set<string>;
  soreMuscles: Set<Muscle>;
  underTrained: Set<Muscle>;
  provenIds: Set<string>;
  /** Subjective readiness 1-5; low energy biases toward easier variations. */
  energy: number;
}

function pickForSlot(args: PickArgs): Exercise | undefined {
  const { slot, pool, usedIds, recentIds, soreMuscles, underTrained, provenIds, energy } =
    args;

  const scored = pool
    .filter((e) => !usedIds.has(e.id))
    .filter((e) => slot.patterns.includes(e.pattern))
    // A sore muscle blocks an exercise only when it is the primary target.
    .filter((e) => !e.primary.some((m) => soreMuscles.has(m)))
    // A slot asking for triceps work must get triceps work. Without this, a
    // slot whose target muscle is unavailable falls through to any exercise
    // sharing its pattern — which is how a calf raise lands on an upper day.
    .filter(
      (e) =>
        !slot.muscles?.length ||
        [...e.primary, ...e.secondary].some((m) => slot.muscles?.includes(m)),
    )
    .map((e) => {
      let score = 0;

      // Prefer the earlier pattern in the slot's preference list.
      const patternRank = slot.patterns.indexOf(e.pattern);
      score += (slot.patterns.length - patternRank) * 10;

      // Slot muscle bias.
      if (slot.muscles?.length) {
        const hit = e.primary.filter((m) => slot.muscles?.includes(m)).length;
        const partial = e.secondary.filter((m) => slot.muscles?.includes(m)).length;
        score += hit * 25 + partial * 8;
      }

      // Nudge toward muscles that have been neglected lately.
      score += e.primary.filter((m) => underTrained.has(m)).length * 6;

      // Variety: penalise anything done in the last two sessions.
      if (recentIds.has(e.id)) score -= 18;

      // The canonical movement for a pattern is the default; variety and
      // specific constraints are what argue you off it.
      if (e.staple) score += 10;

      // Aim at a difficulty appropriate to the slot rather than the hardest
      // thing available: main work targets a solid intermediate variation,
      // warmups and accessories stay simple. On a low-energy day, drop the
      // target — a wrecked session is no time for a new hard variation.
      const targetDifficulty = slot.role === "main" && energy >= 3 ? 2 : 1;
      score -= Math.abs(e.difficulty - targetDifficulty) * 9;

      // An advanced variation the user has never logged is a guess. Prefer
      // movements they have actually performed.
      if (provenIds.has(e.id)) score += 12;
      else if (e.difficulty === 3) score -= 14;

      return { exercise: e, score };
    })
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id));

  return scored[0]?.exercise;
}

/**
 * Picks the focus that has gone longest without being trained, so calling
 * `generate` repeatedly rotates through the week instead of repeating.
 */
export function pickFocus(logs: WorkoutLog[]): Focus {
  const rotation: Focus[] = ["full_body", "upper", "lower"];
  if (!logs.length) return "full_body";

  const recent = logs.slice(0, 3).map((l) => l.focus);
  for (const focus of rotation) {
    if (!recent.includes(focus)) return focus;
  }
  // Everything trained recently — take whatever is oldest.
  const last = logs[0]?.focus;
  return rotation.find((f) => f !== last) ?? "full_body";
}

/** Muscles with the least trailing volume across the last 8 sessions. */
function findUnderTrained(logs: WorkoutLog[]): Set<Muscle> {
  const counts = new Map<Muscle, number>();
  for (const log of logs.slice(0, 8)) {
    for (const entry of log.exercises) {
      const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
      if (!exercise) continue;
      const workingSets = entry.sets.filter((s) => s.completed).length;
      for (const m of exercise.primary) {
        counts.set(m, (counts.get(m) ?? 0) + workingSets);
      }
    }
  }
  if (!counts.size) return new Set();

  const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
  return new Set(sorted.slice(0, 4).map(([m]) => m));
}

/* ------------------------------ fitting ------------------------------ */

type Chosen = { slot: Slot; exercise: Exercise; sets: SetPrescription[] };

function estimateExerciseSeconds(item: Chosen): number {
  const { exercise, sets } = item;
  let total = 0;
  for (const set of sets) {
    const work =
      set.seconds ??
      (set.metres ? set.metres * 1.5 : (set.reps ?? 10) * SECONDS_PER_REP);
    total += (exercise.unilateral ? work * 2 : work) + exercise.restSec;
  }
  return total;
}

export function estimateMinutes(items: Chosen[]): number {
  const seconds = items.reduce((sum, item) => sum + estimateExerciseSeconds(item), 0);
  // Add a small transition allowance between exercises.
  return Math.round((seconds + items.length * 30) / 60);
}

/**
 * Filling a 30-minute slot with 20 minutes of work wastes the session. When
 * exercises have been filtered out by injuries or missing kit, the remaining
 * movements absorb the leftover time as extra working sets.
 */
function expandToBudget(items: Chosen[], minutes: number, maxSets = 5): Chosen[] {
  if (!items.length) return items;
  const canGrow = (item: Chosen) =>
    item.slot.role !== "warmup" && item.sets.length < maxSets;

  // Add one set at a time to whichever eligible exercise has the fewest,
  // so volume spreads evenly instead of piling onto the first movement.
  for (let guard = 0; guard < 40; guard++) {
    const candidates = items.filter(canGrow);
    if (!candidates.length) break;
    const target = candidates.reduce((a, b) => (a.sets.length <= b.sets.length ? a : b));
    const lastSet = target.sets[target.sets.length - 1];
    if (!lastSet) break;
    target.sets.push({ ...lastSet });
    if (estimateMinutes(items) > minutes) {
      target.sets.pop();
      break;
    }
  }
  return items;
}

function fitToBudget(items: Chosen[], minutes: number): Chosen[] {
  const kept = [...items];
  // Drop lowest priority (highest number) first, then latest in the list.
  while (kept.length > 1 && estimateMinutes(kept) > minutes) {
    let dropIndex = 0;
    let worst = -Infinity;
    for (let i = 0; i < kept.length; i++) {
      const priority = kept[i]?.slot.priority ?? 0;
      if (priority > worst) {
        worst = priority;
        dropIndex = i;
      }
    }
    // Never strip the session down past its main work.
    if (worst <= 1) break;
    kept.splice(dropIndex, 1);
  }

  // Still over budget with only high-priority slots left: shave sets instead.
  while (kept.length && estimateMinutes(kept) > minutes) {
    const longest = kept.reduce((a, b) =>
      estimateExerciseSeconds(a) >= estimateExerciseSeconds(b) ? a : b,
    );
    if (longest.sets.length <= 1) break;
    longest.sets.pop();
  }

  return kept;
}

/* ------------------------------ assembly ----------------------------- */

function toBlocks(
  items: Chosen[],
  recentIds: Set<string>,
  soreMuscles: Set<Muscle>,
  injuries: Set<string>,
): WorkoutBlock[] {
  const byBlock = new Map<string, PlannedExercise[]>();

  for (const item of items) {
    const title = BLOCK_FOR_ROLE[item.slot.role];
    const list = byBlock.get(title) ?? [];
    list.push({
      exerciseId: item.exercise.id,
      name: item.exercise.name,
      metric: item.exercise.metric,
      unilateral: item.exercise.unilateral,
      sets: item.sets,
      restSec: item.exercise.restSec,
      rationale: buildRationale(item, recentIds, soreMuscles, injuries),
    });
    byBlock.set(title, list);
  }

  return BLOCK_ORDER.filter((title) => byBlock.has(title)).map((title) => ({
    title,
    exercises: byBlock.get(title) ?? [],
  }));
}

function buildRationale(
  item: Chosen,
  recentIds: Set<string>,
  soreMuscles: Set<Muscle>,
  injuries: Set<string>,
): string {
  const { slot, exercise, sets } = item;
  const primary = exercise.primary.join(", ").replace(/_/g, " ");
  const first = sets[0];

  if (slot.role === "warmup") return `Opens up ${primary} before the working sets.`;
  if (slot.role === "finisher") return `Short finisher — raises heart rate without adding fatigue that lingers.`;

  const load = first?.weightKg
    ? ` at ${first.weightKg}kg`
    : first?.seconds
      ? ` for ${first.seconds}s`
      : "";

  if (injuries.size && exercise.stresses.length === 0) {
    return `Joint-friendly ${primary} work${load} — nothing that loads your flagged areas.`;
  }
  if (soreMuscles.size && !exercise.primary.some((m) => soreMuscles.has(m))) {
    return `Targets ${primary}${load}, steering clear of what you flagged as sore.`;
  }
  if (recentIds.has(exercise.id)) {
    return `Repeat of last session's ${exercise.name}${load} to keep the progression moving.`;
  }
  return `${slot.role === "main" ? "Main" : "Accessory"} ${primary} work${load}, ${slot.repRange[0]}-${slot.repRange[1]} reps at RIR ${slot.rir}.`;
}

function buildSummary(
  title: string,
  count: number,
  minutes: number,
  adaptations: string[],
): string {
  const base = `${title} session: ${count} exercises, roughly ${minutes} minutes.`;
  if (!adaptations.length) return base;
  return `${base} ${adaptations.join(" ")}`;
}
