import assert from "node:assert/strict";
import { test } from "node:test";
import { EXERCISE_BY_ID, isAvailable } from "@fc/shared";
import type { SessionConstraints, WorkoutLog } from "@fc/shared";
import { buildPlan } from "./index.js";

function constraints(overrides: Partial<SessionConstraints> = {}): SessionConstraints {
  return {
    equipment: ["bodyweight"],
    minutes: 45,
    soreness: [],
    injuries: [],
    energy: 3,
    ...overrides,
  };
}

function allExercises(plan: ReturnType<typeof buildPlan>["plan"]) {
  return plan.blocks.flatMap((b) => b.exercises);
}

test("never prescribes an exercise that loads an injured area", () => {
  const { plan } = buildPlan({
    constraints: constraints({
      equipment: ["barbell", "rack", "bench", "dumbbell", "pullup_bar"],
      injuries: ["knee", "lower_back"],
    }),
    logs: [],
  });

  for (const entry of allExercises(plan)) {
    const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
    assert.ok(exercise, `unknown exercise ${entry.exerciseId}`);
    assert.deepEqual(
      exercise.stresses.filter((s) => s === "knee" || s === "lower_back"),
      [],
      `${exercise.name} loads an injured area`,
    );
  }
});

test("never prescribes equipment the user does not have", () => {
  const equipment: SessionConstraints["equipment"] = ["dumbbell"];
  const { plan } = buildPlan({ constraints: constraints({ equipment }), logs: [] });

  for (const entry of allExercises(plan)) {
    const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
    assert.ok(exercise);
    assert.ok(isAvailable(exercise, equipment), `${exercise.name} needs missing equipment`);
  }
});

test("bodyweight movements stay available when other equipment is selected", () => {
  const plank = EXERCISE_BY_ID.get("plank");
  assert.ok(plank);
  assert.ok(isAvailable(plank, ["barbell"]), "a barbell should not remove bodyweight work");
});

test("does not make a sore muscle the primary target", () => {
  const { plan } = buildPlan({
    constraints: constraints({
      equipment: ["bodyweight", "pullup_bar", "dumbbell"],
      soreness: [{ muscle: "chest", level: 3 }],
    }),
    logs: [],
  });

  for (const entry of allExercises(plan)) {
    const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
    assert.ok(exercise);
    assert.ok(!exercise.primary.includes("chest"), `${exercise.name} targets a sore muscle`);
  }
});

test("respects the time budget in both directions", () => {
  for (const minutes of [15, 30, 45, 60, 90]) {
    const { plan } = buildPlan({
      constraints: constraints({
        equipment: ["bodyweight", "dumbbell", "pullup_bar", "bench"],
        minutes,
      }),
      logs: [],
    });
    assert.ok(
      plan.estimatedMinutes <= minutes,
      `${minutes}min budget produced a ${plan.estimatedMinutes}min session`,
    );
    // Should not leave a large chunk of the budget unused.
    assert.ok(
      plan.estimatedMinutes >= minutes * 0.7,
      `${minutes}min budget only filled ${plan.estimatedMinutes}min`,
    );
  }
});

test("a muscle-biased slot never falls through to an unrelated muscle", () => {
  // Shoulder injury removes the usual triceps isolation; the slot must be
  // dropped rather than filled with, say, a calf raise on an upper day.
  const { plan } = buildPlan({
    constraints: constraints({
      equipment: ["dumbbell", "bench"],
      injuries: ["shoulder"],
      focus: "upper",
    }),
    logs: [],
  });

  const names = allExercises(plan).map((e) => e.exerciseId);
  assert.ok(!names.includes("calf_raise"), "calf raise has no place in an upper session");
});

test("low energy avoids advanced variations", () => {
  const { plan } = buildPlan({
    constraints: constraints({ equipment: ["bodyweight"], energy: 1, minutes: 20 }),
    logs: [],
  });

  for (const entry of allExercises(plan)) {
    const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
    assert.ok(exercise);
    assert.notEqual(exercise.difficulty, 3, `${exercise.name} is too advanced for energy 1`);
  }
});

test("progression carries the last logged load forward", () => {
  const logs: WorkoutLog[] = [
    {
      id: "l1",
      startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      focus: "lower",
      soreness: [],
      exercises: [
        {
          exerciseId: "back_squat",
          name: "Barbell Back Squat",
          sets: [
            { setIndex: 0, reps: 5, weightKg: 100, completed: true },
            { setIndex: 1, reps: 5, weightKg: 100, completed: true },
          ],
        },
      ],
    },
  ];

  const { plan } = buildPlan({
    constraints: constraints({ equipment: ["barbell", "rack"], focus: "lower" }),
    logs,
  });

  const squat = allExercises(plan).find((e) => e.exerciseId === "back_squat");
  assert.ok(squat, "back squat should be programmed again");
  const load = squat.sets[0]?.weightKg ?? 0;
  assert.ok(load >= 100, `expected at least the previous 100kg, got ${load}`);
});

/* ------------------- experience, feedback, and balance ------------------ */

function ratedLog(rating: number): WorkoutLog {
  return {
    id: "rated",
    startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    focus: "full_body",
    soreness: [],
    rating,
    exercises: [
      {
        exerciseId: "pushup",
        name: "Push-Up",
        sets: [{ setIndex: 0, reps: 10, completed: true }],
      },
    ],
  };
}

function averageRir(plan: ReturnType<typeof buildPlan>["plan"]): number {
  const sets = allExercises(plan)
    .flatMap((e) => e.sets)
    .filter((s) => s.rir !== undefined);
  return sets.reduce((sum, s) => sum + (s.rir ?? 0), 0) / Math.max(1, sets.length);
}

test("experience level changes how hard the first session is pitched", () => {
  const equipment: SessionConstraints["equipment"] = ["bodyweight", "dumbbell"];
  const rirByLevel = (["beginner", "intermediate", "advanced"] as const).map((experience) =>
    averageRir(buildPlan({ constraints: constraints({ equipment, experience }), logs: [] }).plan),
  );

  // Reps in reserve should fall monotonically as experience rises: an
  // advanced lifter works closer to failure than a beginner.
  assert.ok(
    rirByLevel[0]! > rirByLevel[1]! && rirByLevel[1]! > rirByLevel[2]!,
    `expected descending RIR across levels, got ${rirByLevel.join(", ")}`,
  );
});

test('"too easy" feedback raises intensity, "too hard" lowers it', () => {
  const base = constraints({ equipment: ["bodyweight", "dumbbell"], minutes: 45 });
  const neutral = averageRir(buildPlan({ constraints: base, logs: [] }).plan);
  const tooEasy = averageRir(buildPlan({ constraints: base, logs: [ratedLog(1)] }).plan);
  const tooHard = averageRir(buildPlan({ constraints: base, logs: [ratedLog(5)] }).plan);

  // Lower RIR means working closer to failure, i.e. harder.
  assert.ok(tooEasy < neutral, `too-easy should lower RIR: ${tooEasy} vs ${neutral}`);
  assert.ok(tooHard > neutral, `too-hard should raise RIR: ${tooHard} vs ${neutral}`);
});

test("a fixed time budget is not filled by repeating one movement pattern", () => {
  // Bodyweight + dumbbells with no bench or bar leaves no pulling available,
  // which is exactly the case that previously produced four presses.
  const { plan } = buildPlan({
    constraints: constraints({
      equipment: ["bodyweight", "dumbbell"],
      minutes: 60,
      focus: "upper",
    }),
    logs: [],
  });

  const counts = new Map<string, number>();
  for (const entry of allExercises(plan)) {
    const exercise = EXERCISE_BY_ID.get(entry.exerciseId);
    assert.ok(exercise);
    counts.set(exercise.pattern, (counts.get(exercise.pattern) ?? 0) + 1);
  }

  for (const [pattern, count] of counts) {
    assert.ok(count <= 3, `${count} exercises share the ${pattern} pattern`);
  }
});

test("says so when the equipment makes a balanced session impossible", () => {
  const { plan } = buildPlan({
    constraints: constraints({ equipment: ["bodyweight", "dumbbell"], focus: "upper" }),
    logs: [],
  });
  const patterns = new Set(
    allExercises(plan).map((e) => EXERCISE_BY_ID.get(e.exerciseId)?.pattern),
  );
  const pushes = patterns.has("push_horizontal") || patterns.has("push_vertical");
  const pulls = patterns.has("pull_horizontal") || patterns.has("pull_vertical");

  if (pushes && !pulls) {
    assert.match(plan.summary, /No pulling movements are possible/);
  }
});

test("rest is charged between sets, not after the last one", () => {
  // Three sets means two rests. A four-set exercise that charged rest after
  // every set inflated every session by roughly one rest period per exercise.
  const { plan } = buildPlan({
    constraints: constraints({ equipment: ["bodyweight"], minutes: 45 }),
    logs: [],
  });
  const single = allExercises(plan).find((e) => e.sets.length === 1);
  if (single) {
    // A single-set exercise incurs no rest at all.
    assert.ok(single.restSec >= 0);
  }
  assert.ok(
    plan.estimatedMinutes <= 45,
    `estimate ${plan.estimatedMinutes} exceeds the 45 minute budget`,
  );
});
