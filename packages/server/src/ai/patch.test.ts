import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionConstraints, WorkoutPlan } from "@fc/shared";
import { applyPatch } from "./patch.js";

function plan(): WorkoutPlan {
  return {
    id: "p1",
    createdAt: new Date().toISOString(),
    forDate: "2026-01-01",
    title: "Full Body",
    focus: "full_body",
    estimatedMinutes: 40,
    summary: "planner summary",
    source: "planner",
    constraints: base(),
    blocks: [
      {
        title: "Main",
        exercises: [
          {
            exerciseId: "pushup",
            name: "Push-Up",
            metric: "reps",
            unilateral: false,
            sets: [{ reps: 10 }, { reps: 10 }],
            restSec: 75,
            rationale: "main push",
          },
        ],
      },
    ],
  };
}

function base(overrides: Partial<SessionConstraints> = {}): SessionConstraints {
  return {
    equipment: ["bodyweight"],
    minutes: 40,
    soreness: [],
    injuries: [],
    energy: 3,
    ...overrides,
  };
}

test("rejects a hallucinated exercise id", () => {
  const { plan: out, applied, rejected } = applyPatch(
    plan(),
    {
      operations: [
        { op: "add", exerciseId: "turbo_mega_press", block: "Main", sets: 3, reason: "x" },
      ],
    },
    base(),
  );
  assert.equal(applied.length, 0);
  assert.match(rejected.join(" "), /Unknown exercise/);
  assert.equal(out.blocks[0]?.exercises.length, 1);
});

test("rejects an exercise that needs unavailable equipment", () => {
  const { applied, rejected } = applyPatch(
    plan(),
    {
      operations: [
        { op: "add", exerciseId: "back_squat", block: "Main", sets: 3, reason: "x" },
      ],
    },
    base({ equipment: ["bodyweight"] }),
  );
  assert.equal(applied.length, 0);
  assert.match(rejected.join(" "), /equipment you don't have/);
});

test("rejects an exercise that loads an injured area", () => {
  const { applied, rejected } = applyPatch(
    plan(),
    {
      operations: [
        { op: "add", exerciseId: "pike_pushup", block: "Main", sets: 3, reason: "x" },
      ],
    },
    base({ injuries: ["shoulder"] }),
  );
  assert.equal(applied.length, 0);
  assert.match(rejected.join(" "), /loads your shoulder/);
});

test("applies a legitimate swap and records the substitution", () => {
  const { plan: out, applied } = applyPatch(
    plan(),
    {
      operations: [
        {
          op: "swap",
          exerciseId: "pushup",
          withExerciseId: "incline_pushup",
          reason: "Easier on the wrists today.",
        },
      ],
    },
    base({ equipment: ["bodyweight", "bench"] }),
  );
  const entry = out.blocks[0]?.exercises[0];
  assert.equal(entry?.exerciseId, "incline_pushup");
  assert.equal(entry?.substitutedFor, "Push-Up");
  assert.equal(entry?.sets.length, 2, "set count carries across the swap");
  assert.equal(applied.length, 1);
  assert.equal(out.source, "planner+ai");
});

test("a swap to a timed exercise rebuilds the prescription", () => {
  const { plan: out } = applyPatch(
    plan(),
    {
      operations: [
        { op: "swap", exerciseId: "pushup", withExerciseId: "plank", reason: "core focus" },
      ],
    },
    base(),
  );
  const entry = out.blocks[0]?.exercises[0];
  assert.equal(entry?.metric, "time");
  assert.ok(entry?.sets.every((s) => s.seconds && !s.reps), "reps must not survive");
});

test("an empty patch leaves the plan untouched", () => {
  const original = plan();
  const { plan: out, applied } = applyPatch(original, { operations: [] }, base());
  assert.equal(applied.length, 0);
  assert.equal(out.source, "planner");
  assert.deepEqual(out.blocks, original.blocks);
});

test("removing every exercise in a block drops the block", () => {
  const { plan: out } = applyPatch(
    plan(),
    { operations: [{ op: "remove", exerciseId: "pushup", reason: "wrist pain" }] },
    base(),
  );
  assert.equal(out.blocks.length, 0);
});

test("adjust rewrites every set, not just the first", () => {
  const { plan: out } = applyPatch(
    plan(),
    { operations: [{ op: "adjust", exerciseId: "pushup", sets: 4, reps: 6, reason: "heavier" }] },
    base(),
  );
  const entry = out.blocks[0]?.exercises[0];
  assert.equal(entry?.sets.length, 4);
  assert.ok(entry?.sets.every((s) => s.reps === 6));
});
