import {
  EXERCISES,
  EXERCISE_BY_ID,
  EXPERIENCE_PROFILE,
  computeProgression,
  isAvailable,
  nextPrescription,
} from "@fc/shared";
import type {
  Exercise,
  Experience,
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
import type { Slot, SlotRole } from "./templates.js";

/** Soreness at or above this level takes a muscle out of the candidate pool. */
const SORE_BLOCK_LEVEL = 2;

/**
 * Cap on exercises sharing one movement pattern when filling leftover time.
 * The template itself may legitimately assign more (a push day is mostly
 * pressing); this only governs the filler.
 */
const MAX_PER_PATTERN = 2;

/** Rough seconds per rep, used only for time estimation. */
const SECONDS_PER_REP = 3;

/**
 * How much of an exercise's nominal rest a slot actually needs. The value on
 * the exercise assumes a hard loaded set; five bodyweight squats in a warm-up
 * do not need three minutes. This scales the prescribed rest to the real
 * demand, which fixes both the time estimate and the in-session rest timer.
 */
const REST_BY_ROLE: Record<SlotRole, number> = {
  warmup: 0.35,
  main: 1,
  accessory: 0.7,
  core: 0.6,
  finisher: 0.5,
};

/** Unloaded work recovers faster than the same movement under load. */
const UNLOADED_REST_FACTOR = 0.75;

function restForSlot(exercise: Exercise, slot: Slot, sets: SetPrescription[]): number {
  const loaded = (sets[0]?.weightKg ?? 0) > 0;
  const scale = (REST_BY_ROLE[slot.role] ?? 1) * (loaded ? 1 : UNLOADED_REST_FACTOR);
  return Math.max(15, Math.round((exercise.restSec * scale) / 5) * 5);
}

export interface PlannerInput {
  constraints: SessionConstraints;
  /** Recent logs, newest first. Used for progression and rotation. */
  logs: WorkoutLog[];
  /** Exercise ids to avoid — used by the "different exercises" adjustment. */
  excludeIds?: string[];
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
  const excluded = new Set(input.excludeIds ?? []);
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
    if (excluded.has(e.id)) return false;
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

  const statedExperience = constraints.experience ?? "intermediate";

  // Volume scaling from energy and experience: 3 is neutral, 1 cuts a third,
  // 5 adds a little; an advanced lifter carries more of it.
  const energyScale = { 1: 0.6, 2: 0.8, 3: 1, 4: 1, 5: 1.1 }[constraints.energy] ?? 1;

  // Act on the last session's difficulty rating without spending a token.
  //
  // The lever here is intensity, not volume. The session has a fixed time
  // budget, so adding sets cannot add work — it just crowds exercises out of
  // the same 45 minutes. "Too easy" has to mean harder reps, less rest in
  // reserve, and harder variations instead.
  const lastRating = logs.find((l) => l.rating !== undefined)?.rating;
  const { levelShift, rirDelta } = intensityAdjustment(lastRating);

  const experience = shiftExperience(statedExperience, levelShift);
  if (lastRating !== undefined && (levelShift !== 0 || rirDelta !== 0)) {
    adaptations.push(
      rirDelta < 0
        ? "Pushed the intensity up — you said the last session was too easy."
        : "Eased the intensity off — you said the last session was too hard.",
    );
  }

  const volumeScale = energyScale * EXPERIENCE_PROFILE[experience].volumeScale;
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
      experience,
    });
    if (!exercise) continue;
    usedIds.add(exercise.id);

    const state = computeProgression(exercise.id, exercise.name, logs);
    const sets = nextPrescription(exercise, state, {
      sets: slot.sets,
      repRange: slot.repRange,
      rir: Math.max(0, slot.rir + rirDelta),
      volumeScale,
      experience,
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

  /** How many exercises already use a given movement pattern. */
  const patternCount = (pattern: Pattern) =>
    chosen.filter((c) => c.exercise.pattern === pattern).length;

  const target = constraints.minutes * 0.85;

  /**
   * Pattern groups that yielded no candidate. A group with nothing available
   * — pulling with no bar, for instance — always sorts first as the
   * least-represented, so without this it starves the loop: every iteration
   * retries the empty pattern and no other group is ever reached.
   */
  const exhausted = new Set<string>();
  const groupKey = (group: Pattern[]) => group.join("+");

  // Fill in tiers, relaxing the per-pattern cap only once the balanced
  // options are exhausted. A short session therefore stays varied, while a
  // long one is allowed a third movement of a pattern rather than plateauing
  // and silently ignoring the extra time.
  // Relax by one only. Padding a session with a fourth variation of the same
  // press is worse than finishing early — and when the shortfall is caused by
  // missing equipment, the summary already says so and names the fix.
  filler: for (let cap = MAX_PER_PATTERN; cap <= MAX_PER_PATTERN + 1; cap++) {
    for (let i = 0; i < fillerPatterns.length * 2; i++) {
      if (estimateMinutes(chosen) >= target) break filler;

      // Take the least-represented pattern group each round. Cycling blindly
      // let one pattern win repeatedly — an upper session ended up with four
      // different push-up variations and no pulling at all.
      const candidates = [...fillerPatterns]
        .filter((group) => group[0] && !exhausted.has(groupKey(group)))
        .filter((group) => (group[0] ? patternCount(group[0]) < cap : false))
        .sort((a, b) => patternCount(a[0] as Pattern) - patternCount(b[0] as Pattern));
      const patterns = candidates[0];
      if (!patterns) break;
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
        experience,
      });
      if (!exercise) {
        exhausted.add(groupKey(patterns));
        continue;
      }
      usedIds.add(exercise.id);
      const state = computeProgression(exercise.id, exercise.name, logs);
      chosen.push({
        slot,
        exercise,
        sets: nextPrescription(exercise, state, {
          sets: slot.sets,
          repRange: slot.repRange,
          rir: Math.max(0, slot.rir + rirDelta),
          volumeScale,
          experience,
        }),
      });
    }
  }

  // Fit the time budget: trim when over, add working sets back when well under.
  const fitted = expandToBudget(fitToBudget(chosen, constraints.minutes), constraints.minutes);
  if (fitted.length < chosen.length) {
    adaptations.push(
      `Trimmed ${chosen.length - fitted.length} exercise(s) to fit ${constraints.minutes} minutes.`,
    );
  }

  // A session with pressing and no pulling is a real imbalance, and it is
  // almost always the equipment's fault rather than a choice. Say so.
  const patternsUsed = new Set(fitted.map((c) => c.exercise.pattern));
  const pushes = patternsUsed.has("push_horizontal") || patternsUsed.has("push_vertical");
  const pulls = patternsUsed.has("pull_horizontal") || patternsUsed.has("pull_vertical");
  if (pushes && !pulls) {
    adaptations.push(
      "No pulling movements are possible with this equipment — add a pull-up bar, bands, or dumbbells with a bench to balance the session.",
    );
  } else if (pulls && !pushes) {
    adaptations.push("No pressing movements are possible with this equipment.");
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

/**
 * Turns the last session's 1-5 difficulty rating into an intensity change:
 * how many experience levels to shift, and how to move the reps-in-reserve
 * target. Negative `rirDelta` means working closer to failure.
 */
function intensityAdjustment(rating: number | undefined): {
  levelShift: number;
  rirDelta: number;
} {
  switch (rating) {
    case 1:
      return { levelShift: 1, rirDelta: -1 }; // far too easy
    case 2:
      return { levelShift: 0, rirDelta: -1 }; // a bit easy
    case 4:
      return { levelShift: 0, rirDelta: 1 }; // hard
    case 5:
      return { levelShift: -1, rirDelta: 1 }; // too hard
    default:
      return { levelShift: 0, rirDelta: 0 };
  }
}

function shiftExperience(current: Experience, shift: number): Experience {
  const order: Experience[] = ["beginner", "intermediate", "advanced"];
  const index = order.indexOf(current);
  return order[Math.min(order.length - 1, Math.max(0, index + shift))] ?? current;
}

/* ---------------------------- adjustments ---------------------------- */

/**
 * Free, instant changes to a session. These are the adjustments that do not
 * need judgement — shifting difficulty, changing the clock, rotating the
 * exercise choices — so they cost nothing and happen without a round trip to
 * a model. Nuanced requests still go to the AI revise path.
 */
export type AdjustOp =
  | "harder"
  | "easier"
  | "shorter"
  | "longer"
  | "more_variety";

const TIME_STEP_MIN = 15;

export interface AdjustResult {
  plan: WorkoutPlan;
  /** One line describing what changed, for the UI. */
  note: string;
}

export function adjustPlan(
  plan: WorkoutPlan,
  op: AdjustOp,
  logs: WorkoutLog[],
): AdjustResult {
  const current = plan.constraints;
  const level = current.experience ?? "intermediate";

  switch (op) {
    case "harder":
    case "easier": {
      const next = shiftExperience(level, op === "harder" ? 1 : -1);
      if (next === level) {
        return {
          plan,
          note:
            op === "harder"
              ? "Already at the hardest level — use the feedback box to push specific lifts."
              : "Already at the easiest level — try shortening the session instead.",
        };
      }
      const built = buildPlan({ constraints: { ...current, experience: next }, logs });
      return { plan: built.plan, note: `Difficulty set to ${next}.` };
    }

    case "shorter":
    case "longer": {
      const delta = op === "shorter" ? -TIME_STEP_MIN : TIME_STEP_MIN;
      const minutes = Math.min(180, Math.max(10, current.minutes + delta));
      if (minutes === current.minutes) {
        return { plan, note: `Already at ${current.minutes} minutes.` };
      }
      const built = buildPlan({ constraints: { ...current, minutes }, logs });
      return { plan: built.plan, note: `Session is now ${minutes} minutes.` };
    }

    case "more_variety": {
      // Rebuild while avoiding everything currently on the plan, so the user
      // gets a genuinely different session rather than a reshuffle.
      const excludeIds = plan.blocks
        .flatMap((b) => b.exercises)
        .filter((e) => e.metric !== "time" || e.rationale.indexOf("Opens up") === -1)
        .map((e) => e.exerciseId);
      const built = buildPlan({ constraints: current, logs, excludeIds });
      return { plan: built.plan, note: "Swapped in a different set of exercises." };
    }
  }
}

/**
 * Replaces one exercise with the next best alternative for the same movement
 * pattern, respecting equipment, injuries and soreness. Free — no AI call.
 */
export function swapExercise(
  plan: WorkoutPlan,
  exerciseId: string,
  logs: WorkoutLog[],
): AdjustResult {
  const constraints = plan.constraints;
  const equipment = constraints.equipment.length
    ? constraints.equipment
    : ["bodyweight" as const];
  const injuries = new Set(constraints.injuries);
  const soreMuscles = new Set<Muscle>(
    constraints.soreness.filter((s) => s.level >= SORE_BLOCK_LEVEL).map((s) => s.muscle),
  );

  const next: WorkoutPlan = structuredClone(plan);
  let target: PlannedExercise | undefined;
  for (const block of next.blocks) {
    const found = block.exercises.find((e) => e.exerciseId === exerciseId);
    if (found) {
      target = found;
      break;
    }
  }
  if (!target) return { plan, note: "That exercise is not in this session." };

  const currentExercise = EXERCISE_BY_ID.get(exerciseId);
  if (!currentExercise) return { plan, note: "Unknown exercise." };

  // Everything already tried in this slot, plus everything else in the session.
  const seen = new Set<string>([
    exerciseId,
    ...(target.previousIds ?? []),
    ...next.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)),
  ]);

  const candidates = EXERCISES.filter(
    (e) =>
      !seen.has(e.id) &&
      e.pattern === currentExercise.pattern &&
      isAvailable(e, equipment) &&
      !e.stresses.some((area) => injuries.has(area)) &&
      !e.primary.some((m) => soreMuscles.has(m)),
  ).sort((a, b) => Number(b.staple) - Number(a.staple) || a.id.localeCompare(b.id));

  const replacement = candidates[0];
  if (!replacement) {
    return {
      plan,
      note: `No other ${currentExercise.pattern.replace(/_/g, " ")} movement fits your equipment and constraints.`,
    };
  }

  const state = computeProgression(replacement.id, replacement.name, logs);
  const sets = nextPrescription(replacement, state, {
    sets: target.sets.length,
    repRange: [8, 12],
    rir: target.sets[0]?.rir ?? 2,
    experience: constraints.experience ?? "intermediate",
  });

  target.exerciseId = replacement.id;
  target.name = replacement.name;
  target.metric = replacement.metric;
  target.unilateral = replacement.unilateral;
  target.sets = sets;
  target.restSec = replacement.restSec;
  target.rationale = `Swapped in for ${currentExercise.name}.`;
  target.substitutedFor = currentExercise.name;
  target.previousIds = [...(target.previousIds ?? []), exerciseId];

  return { plan: next, note: `${currentExercise.name} → ${replacement.name}.` };
}

/** Drops one exercise from a session. */
export function removeExercise(plan: WorkoutPlan, exerciseId: string): AdjustResult {
  const next: WorkoutPlan = structuredClone(plan);
  let name = exerciseId;
  for (const block of next.blocks) {
    const index = block.exercises.findIndex((e) => e.exerciseId === exerciseId);
    if (index >= 0) {
      name = block.exercises[index]?.name ?? exerciseId;
      block.exercises.splice(index, 1);
      break;
    }
  }
  next.blocks = next.blocks.filter((b) => b.exercises.length > 0);
  return { plan: next, note: `Removed ${name}.` };
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
  experience: Experience;
}

function pickForSlot(args: PickArgs): Exercise | undefined {
  const { slot, pool, usedIds, recentIds, soreMuscles, underTrained, provenIds, energy, experience } =
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

      // Variety for accessories, continuity for main lifts: progression on a
      // squat comes from squatting again, so a main lift done recently is
      // preferred, while accessories rotate to spread the stimulus.
      if (recentIds.has(e.id)) score += slot.role === "main" ? 6 : -18;

      // The canonical movement for a pattern is the default; variety and
      // specific constraints are what argue you off it.
      if (e.staple) score += 10;

      // Aim at a difficulty appropriate to the slot and the lifter rather than
      // the hardest thing available. On a low-energy day, drop the target — a
      // wrecked session is no time to attempt a new hard variation.
      const ceiling = experience === "advanced" ? 3 : experience === "beginner" ? 1 : 2;
      const targetDifficulty = slot.role === "main" && energy >= 3 ? ceiling : Math.max(1, ceiling - 1);
      score -= Math.abs(e.difficulty - targetDifficulty) * 9;

      // An untried advanced variation is a guess, so prefer movements the user
      // has actually performed — but do not hold an advanced lifter back from
      // hard variations just because this app has not seen them do one yet.
      if (provenIds.has(e.id)) score += 12;
      else if (e.difficulty === 3 && experience !== "advanced") score -= 14;

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
  const { exercise, slot, sets } = item;
  let work = 0;
  for (const set of sets) {
    const seconds =
      set.seconds ??
      (set.metres ? set.metres * 1.5 : (set.reps ?? 10) * SECONDS_PER_REP);
    work += exercise.unilateral ? seconds * 2 : seconds;
  }
  // Rest falls BETWEEN sets: four sets means three rests, not four. Charging
  // one per set added a phantom rest to every exercise in the session.
  const rests = Math.max(0, sets.length - 1) * restForSlot(exercise, slot, sets);
  return work + rests;
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
      restSec: restForSlot(item.exercise, item.slot, item.sets),
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
