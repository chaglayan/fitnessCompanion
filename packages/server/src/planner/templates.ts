import type { Focus, Muscle, Pattern } from "@fc/shared";

export type SlotRole = "warmup" | "main" | "accessory" | "core" | "finisher";

export interface Slot {
  role: SlotRole;
  /** Acceptable movement patterns, most preferred first. */
  patterns: Pattern[];
  sets: number;
  repRange: [number, number];
  /** Reps in reserve — how hard to push this slot. */
  rir: number;
  /** Bias selection toward exercises hitting these muscles. */
  muscles?: Muscle[];
  /**
   * Drop order when the time budget is tight: higher numbers are cut first.
   * Warmups and main lifts are 1-2; finishers and isolation are 4-5.
   */
  priority: number;
}

export interface Template {
  focus: Focus;
  title: string;
  slots: Slot[];
}

const WARMUP: Slot[] = [
  { role: "warmup", patterns: ["mobility"], sets: 1, repRange: [8, 10], rir: 4, priority: 2 },
  { role: "warmup", patterns: ["mobility"], sets: 1, repRange: [8, 10], rir: 4, priority: 3 },
];

export const TEMPLATES: Record<Focus, Template> = {
  full_body: {
    focus: "full_body",
    title: "Full Body",
    slots: [
      ...WARMUP,
      { role: "main", patterns: ["squat"], sets: 3, repRange: [5, 8], rir: 2, priority: 1 },
      { role: "main", patterns: ["push_horizontal", "push_vertical"], sets: 3, repRange: [6, 10], rir: 2, priority: 1 },
      { role: "main", patterns: ["pull_vertical", "pull_horizontal"], sets: 3, repRange: [6, 10], rir: 2, priority: 1 },
      { role: "accessory", patterns: ["hinge"], sets: 3, repRange: [8, 12], rir: 2, priority: 2 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 3 },
      { role: "finisher", patterns: ["conditioning"], sets: 3, repRange: [10, 15], rir: 1, priority: 5 },
    ],
  },
  upper: {
    focus: "upper",
    title: "Upper Body",
    slots: [
      ...WARMUP,
      { role: "main", patterns: ["push_horizontal"], sets: 4, repRange: [5, 8], rir: 2, priority: 1 },
      { role: "main", patterns: ["pull_vertical"], sets: 4, repRange: [5, 8], rir: 2, priority: 1 },
      { role: "accessory", patterns: ["push_vertical"], sets: 3, repRange: [8, 12], rir: 2, priority: 2 },
      { role: "accessory", patterns: ["pull_horizontal"], sets: 3, repRange: [8, 12], rir: 2, priority: 2 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [10, 15], rir: 1, muscles: ["biceps"], priority: 4 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [10, 15], rir: 1, muscles: ["triceps"], priority: 4 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 3 },
    ],
  },
  lower: {
    focus: "lower",
    title: "Lower Body",
    slots: [
      ...WARMUP,
      { role: "main", patterns: ["squat"], sets: 4, repRange: [5, 8], rir: 2, priority: 1 },
      { role: "main", patterns: ["hinge"], sets: 4, repRange: [6, 10], rir: 2, priority: 1 },
      { role: "accessory", patterns: ["lunge"], sets: 3, repRange: [8, 12], rir: 2, priority: 2 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [12, 20], rir: 1, muscles: ["calves"], priority: 4 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 3 },
    ],
  },
  push: {
    focus: "push",
    title: "Push",
    slots: [
      ...WARMUP,
      { role: "main", patterns: ["push_horizontal"], sets: 4, repRange: [5, 8], rir: 2, priority: 1 },
      { role: "main", patterns: ["push_vertical"], sets: 4, repRange: [6, 10], rir: 2, priority: 1 },
      { role: "accessory", patterns: ["push_horizontal"], sets: 3, repRange: [8, 12], rir: 2, priority: 2 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [10, 15], rir: 1, muscles: ["shoulders"], priority: 4 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [10, 15], rir: 1, muscles: ["triceps"], priority: 4 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 3 },
    ],
  },
  pull: {
    focus: "pull",
    title: "Pull",
    slots: [
      ...WARMUP,
      { role: "main", patterns: ["pull_vertical"], sets: 4, repRange: [5, 8], rir: 2, priority: 1 },
      { role: "main", patterns: ["pull_horizontal"], sets: 4, repRange: [6, 10], rir: 2, priority: 1 },
      { role: "accessory", patterns: ["hinge"], sets: 3, repRange: [8, 12], rir: 2, priority: 2 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [10, 15], rir: 1, muscles: ["biceps"], priority: 4 },
      { role: "accessory", patterns: ["isolation"], sets: 3, repRange: [12, 20], rir: 1, muscles: ["shoulders", "back"], priority: 4 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 3 },
    ],
  },
  conditioning: {
    focus: "conditioning",
    title: "Conditioning",
    slots: [
      ...WARMUP,
      { role: "main", patterns: ["conditioning"], sets: 4, repRange: [12, 20], rir: 1, priority: 1 },
      { role: "main", patterns: ["conditioning", "squat"], sets: 4, repRange: [12, 20], rir: 1, priority: 1 },
      { role: "accessory", patterns: ["conditioning", "lunge"], sets: 3, repRange: [12, 20], rir: 1, priority: 2 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [12, 20], rir: 1, priority: 3 },
    ],
  },
  core: {
    focus: "core",
    title: "Core",
    slots: [
      ...WARMUP,
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 1 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [10, 15], rir: 2, priority: 1 },
      { role: "core", patterns: ["core"], sets: 3, repRange: [12, 20], rir: 2, priority: 2 },
      { role: "core", patterns: ["carry", "core"], sets: 3, repRange: [10, 15], rir: 2, priority: 3 },
    ],
  },
  mobility: {
    focus: "mobility",
    title: "Mobility",
    slots: [
      { role: "warmup", patterns: ["mobility"], sets: 2, repRange: [8, 12], rir: 4, priority: 1 },
      { role: "warmup", patterns: ["mobility"], sets: 2, repRange: [8, 12], rir: 4, priority: 1 },
      { role: "warmup", patterns: ["mobility"], sets: 2, repRange: [8, 12], rir: 4, priority: 2 },
      { role: "warmup", patterns: ["mobility"], sets: 2, repRange: [8, 12], rir: 4, priority: 2 },
      { role: "warmup", patterns: ["mobility"], sets: 2, repRange: [8, 12], rir: 4, priority: 3 },
    ],
  },
};

/** Block a slot's output belongs in, and the order blocks are rendered. */
export const BLOCK_FOR_ROLE: Record<SlotRole, string> = {
  warmup: "Warm-up",
  main: "Main",
  accessory: "Accessory",
  core: "Core",
  finisher: "Finisher",
};

export const BLOCK_ORDER = ["Warm-up", "Main", "Accessory", "Core", "Finisher"];

/**
 * Muscles that belong to each focus. Used to keep filler accessory work on
 * theme — an upper-body session should not gain a calf raise just because
 * there was time left on the clock.
 *
 * Focuses that legitimately span the whole body are absent, meaning no bias.
 */
export const FOCUS_MUSCLES: Partial<Record<Focus, Muscle[]>> = {
  upper: ["chest", "back", "lats", "shoulders", "biceps", "triceps", "traps", "forearms"],
  lower: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  push: ["chest", "shoulders", "triceps"],
  pull: ["back", "lats", "biceps", "traps", "forearms"],
  core: ["core", "obliques"],
};
