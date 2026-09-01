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
