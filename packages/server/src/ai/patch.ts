import { z } from "zod";
import { EXERCISE_BY_ID, isAvailable } from "@fc/shared";
import type {
  Exercise,
  PlannedExercise,
  SessionConstraints,
  WorkoutPlan,
} from "@fc/shared";

/**
 * The model returns a patch against the deterministic draft, not a whole
 * plan. A full plan costs ~1500-2500 output tokens; a patch is typically
 * under 200, and most of the time it is empty.
 */
export const PlanPatchSchema = z.object({
  /** Replacement session summary. Omit to keep the planner's. */
  summary: z.string().optional(),
  operations: z
    .array(
      z.discriminatedUnion("op", [
        z.object({
          op: z.literal("swap"),
          exerciseId: z.string(),
          withExerciseId: z.string(),
          reason: z.string().max(140),
        }),
        z.object({
          op: z.literal("remove"),
          exerciseId: z.string(),
          reason: z.string().max(140),
        }),
        z.object({
          op: z.literal("add"),
          exerciseId: z.string(),
          block: z.string(),
          sets: z.number().int().min(1).max(8),
          reps: z.number().int().min(1).max(100).optional(),
          seconds: z.number().int().min(5).max(600).optional(),
          reason: z.string().max(140),
        }),
        z.object({
          op: z.literal("adjust"),
          exerciseId: z.string(),
          sets: z.number().int().min(1).max(8).optional(),
          reps: z.number().int().min(1).max(100).optional(),
          seconds: z.number().int().min(5).max(600).optional(),
          weightKg: z.number().min(0).max(500).optional(),
          reason: z.string().max(140),
        }),
      ]),
    )
    .max(8),
});

export type PlanPatch = z.infer<typeof PlanPatchSchema>;

export interface ApplyResult {
  plan: WorkoutPlan;
  /** Operations that were applied, as user-facing sentences. */
  applied: string[];
  /** Operations rejected by the guardrails, with why. */
  rejected: string[];
}

/**
 * Applies a model-produced patch to a plan, enforcing every safety rule the
 * prompt asked for. The model is untrusted here: a hallucinated exercise id,
 * an exercise that needs equipment the user does not have, or anything that
 * loads an injured joint is dropped rather than shown to the user.
 */
export function applyPatch(
  plan: WorkoutPlan,
  patch: PlanPatch,
  constraints: SessionConstraints,
): ApplyResult {
  const applied: string[] = [];
  const rejected: string[] = [];
  const next: WorkoutPlan = structuredClone(plan);
  const equipment = constraints.equipment.length ? constraints.equipment : ["bodyweight" as const];
  const injuries = new Set(constraints.injuries);

  const admissible = (id: string): Exercise | undefined => {
    const exercise = EXERCISE_BY_ID.get(id);
    if (!exercise) {
      rejected.push(`Unknown exercise id "${id}".`);
      return undefined;
    }
    if (!isAvailable(exercise, equipment)) {
      rejected.push(`${exercise.name} needs equipment you don't have.`);
      return undefined;
    }
    const conflict = exercise.stresses.find((area) => injuries.has(area));
    if (conflict) {
      rejected.push(`${exercise.name} loads your ${conflict}.`);
      return undefined;
    }
    return exercise;
  };

  const findEntry = (
    id: string,
  ): { blockIndex: number; index: number; entry: PlannedExercise } | undefined => {
    for (let b = 0; b < next.blocks.length; b++) {
      const block = next.blocks[b];
      if (!block) continue;
      const index = block.exercises.findIndex((e) => e.exerciseId === id);
      const entry = index >= 0 ? block.exercises[index] : undefined;
      if (entry) return { blockIndex: b, index, entry };
    }
    return undefined;
  };

  for (const op of patch.operations) {
    switch (op.op) {
      case "swap": {
        const target = findEntry(op.exerciseId);
        if (!target) {
          rejected.push(`Can't swap ${op.exerciseId} — not in this session.`);
          break;
        }
        const replacement = admissible(op.withExerciseId);
        if (!replacement) break;
        if (findEntry(replacement.id)) {
          rejected.push(`${replacement.name} is already in this session.`);
          break;
        }
        const block = next.blocks[target.blockIndex];
        if (!block) break;
        block.exercises[target.index] = {
          exerciseId: replacement.id,
          name: replacement.name,
          metric: replacement.metric,
          unilateral: replacement.unilateral,
          // Carry the prescription across; metric changes are normalised below.
          sets: normaliseSets(target.entry, replacement),
          restSec: replacement.restSec,
          rationale: op.reason,
          substitutedFor: target.entry.name,
        };
        applied.push(`Swapped ${target.entry.name} for ${replacement.name} — ${op.reason}`);
        break;
      }

      case "remove": {
        const target = findEntry(op.exerciseId);
        if (!target) {
          rejected.push(`Can't remove ${op.exerciseId} — not in this session.`);
          break;
        }
        const block = next.blocks[target.blockIndex];
        if (!block) break;
        block.exercises.splice(target.index, 1);
        applied.push(`Removed ${target.entry.name} — ${op.reason}`);
        break;
      }

      case "add": {
        const exercise = admissible(op.exerciseId);
        if (!exercise) break;
        if (findEntry(exercise.id)) {
          rejected.push(`${exercise.name} is already in this session.`);
          break;
        }
        let block = next.blocks.find((b) => b.title.toLowerCase() === op.block.toLowerCase());
        if (!block) {
          block = { title: op.block, exercises: [] };
          next.blocks.push(block);
        }
        const setCount = op.sets;
        const prescription =
          exercise.metric === "time"
            ? { seconds: op.seconds ?? 30 }
            : { reps: op.reps ?? 10 };
        block.exercises.push({
          exerciseId: exercise.id,
          name: exercise.name,
          metric: exercise.metric,
          unilateral: exercise.unilateral,
          sets: Array.from({ length: setCount }, () => ({ ...prescription })),
          restSec: exercise.restSec,
          rationale: op.reason,
        });
        applied.push(`Added ${exercise.name} — ${op.reason}`);
        break;
      }

      case "adjust": {
        const target = findEntry(op.exerciseId);
        if (!target) {
          rejected.push(`Can't adjust ${op.exerciseId} — not in this session.`);
          break;
        }
        const entry = target.entry;
        if (op.sets !== undefined) {
          const template = entry.sets[0] ?? {};
          entry.sets = Array.from({ length: op.sets }, (_, i) => ({
            ...(entry.sets[i] ?? template),
          }));
        }
        for (const set of entry.sets) {
          if (op.reps !== undefined && entry.metric === "reps") set.reps = op.reps;
          if (op.seconds !== undefined && entry.metric === "time") set.seconds = op.seconds;
          if (op.weightKg !== undefined) set.weightKg = op.weightKg;
        }
        entry.rationale = op.reason;
        applied.push(`Adjusted ${entry.name} — ${op.reason}`);
        break;
      }
    }
  }

  // Drop any block the patch emptied.
  next.blocks = next.blocks.filter((b) => b.exercises.length > 0);

  if (patch.summary?.trim()) next.summary = patch.summary.trim();
  if (applied.length) next.source = "planner+ai";

  return { plan: next, applied, rejected };
}

/**
 * Keeps set count when swapping, but rebuilds the prescription if the new
 * exercise is measured differently (e.g. a timed plank replacing a rep-based
 * crunch).
 */
function normaliseSets(
  previous: PlannedExercise,
  replacement: Exercise,
): PlannedExercise["sets"] {
  if (previous.metric === replacement.metric) {
    // A loaded prescription is meaningless on a bodyweight substitute.
    const loaded = replacement.equipment.some((e) =>
      ["barbell", "dumbbell", "kettlebell", "cable", "machine"].includes(e),
    );
    return previous.sets.map((s) => (loaded ? { ...s } : { ...s, weightKg: undefined }));
  }
  const count = previous.sets.length;
  if (replacement.metric === "time") {
    return Array.from({ length: count }, () => ({ seconds: 30 }));
  }
  if (replacement.metric === "distance") {
    return Array.from({ length: count }, () => ({ metres: 20 }));
  }
  return Array.from({ length: count }, () => ({ reps: 10 }));
}
