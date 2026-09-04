/**
 * Domain types shared by the server, the web PWA, and any future native client.
 * Everything crossing the wire is defined here so a SwiftUI client can be
 * generated against the same contract without touching server internals.
 */

export const EQUIPMENT = [
  "bodyweight",
  "barbell",
  "dumbbell",
  "kettlebell",
  "pullup_bar",
  "dip_bar",
  "bench",
  "rack",
  "bands",
  "cable",
  "machine",
  "box",
  "rings",
  "jump_rope",
  "ab_wheel",
  "sled",
  "bike",
  "treadmill",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const MUSCLES = [
  "chest",
  "back",
  "lats",
  "traps",
  "shoulders",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "obliques",
  "lower_back",
  "hip_flexors",
  "adductors",
  "abductors",
  "full_body",
] as const;
export type Muscle = (typeof MUSCLES)[number];

/**
 * Movement patterns drive session balance: a good session hits complementary
 * patterns rather than three variations of the same push.
 */
export const PATTERNS = [
  "squat",
  "hinge",
  "lunge",
  "push_horizontal",
  "push_vertical",
  "pull_horizontal",
  "pull_vertical",
  "carry",
  "core",
  "conditioning",
  "mobility",
  "isolation",
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Joints/areas a user can flag as injured; exercises declare what they stress. */
export const INJURY_AREAS = [
  "knee",
  "hip",
  "lower_back",
  "shoulder",
  "elbow",
  "wrist",
  "ankle",
  "neck",
] as const;
export type InjuryArea = (typeof INJURY_AREAS)[number];

/** How a set is measured — decides whether the player shows reps or a countdown. */
export type Metric = "reps" | "time" | "distance";

export interface Exercise {
  id: string;
  name: string;
  /** Alternate names so free-text search and AI swaps resolve to a real id. */
  aliases: string[];
  pattern: Pattern;
  /** All of these must be available for the exercise to be selectable. */
  equipment: Equipment[];
  primary: Muscle[];
  secondary: Muscle[];
  metric: Metric;
  /** True for single-limb work; the player prompts per side. */
  unilateral: boolean;
  /** 1 = beginner-safe, 2 = intermediate, 3 = advanced/technical. */
  difficulty: 1 | 2 | 3;
  /** Areas this loads hard. Used to exclude it when that area is injured. */
  stresses: InjuryArea[];
  /** Default rest between sets, in seconds. */
  restSec: number;
  /**
   * The canonical movement for its pattern — the sensible default pick before
   * variety or a specific constraint argues for something else.
   */
  staple: boolean;
  /** Short "how to do it" shown when the exercise name is tapped. */
  description: string;
  /** Form cues, shown as a bulleted list under the description. */
  cues: string[];
  /**
   * Demonstration video. `query` always resolves via YouTube search; set
   * `youtubeId` to pin a specific curated clip (see `videoUrl`).
   */
  video: { query: string; youtubeId?: string };
  /**
   * Rough load factor vs. a barbell back squat for the same muscle, used to
   * seed a starting weight when there is no history for this exercise but
   * there is history for a sibling movement.
   */
  loadFactor?: number;
}

export type SorenessLevel = 0 | 1 | 2 | 3;

export interface Soreness {
  muscle: Muscle;
  level: SorenessLevel;
}

/**
 * How hard to pitch the work. Without history the planner has no other signal,
 * and defaulting everyone to the bottom of the rep range makes a trained
 * person's first session insultingly easy.
 */
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type Experience = (typeof EXPERIENCE_LEVELS)[number];

export const FOCUSES = [
  "full_body",
  "upper",
  "lower",
  "push",
  "pull",
  "conditioning",
  "core",
  "mobility",
] as const;
export type Focus = (typeof FOCUSES)[number];

/** Everything the planner needs to know about today. */
export interface SessionConstraints {
  /** Equipment available right now. Empty is treated as ["bodyweight"]. */
  equipment: Equipment[];
  /** Total time budget including warmup and rest, in minutes. */
  minutes: number;
  /** Only muscles the user actually flagged; anything absent is level 0. */
  soreness: Soreness[];
  injuries: InjuryArea[];
  /** Subjective readiness, 1 (wrecked) to 5 (great). Scales volume. */
  energy: 1 | 2 | 3 | 4 | 5;
  /** Omit to let the planner pick based on what was trained recently. */
  focus?: Focus;
  /** Defaults to "intermediate" when absent. */
  experience?: Experience;
  /** Free text. Its presence is what routes a request to the AI. */
  notes?: string;
}

export interface SetPrescription {
  /** Target reps, when metric is "reps". */
  reps?: number;
  /** Target seconds, when metric is "time". This drives the countdown. */
  seconds?: number;
  /** Target metres, when metric is "distance". */
  metres?: number;
  /** Target load in kg. Omitted for bodyweight movements. */
  weightKg?: number;
  /** Reps in reserve target — how many reps to leave in the tank. */
  rir?: number;
}

export interface PlannedExercise {
  exerciseId: string;
  /** Denormalized so the client can render without a second lookup. */
  name: string;
  metric: Metric;
  unilateral: boolean;
  sets: SetPrescription[];
  restSec: number;
  /** One line on why this exercise is here today. */
  rationale: string;
  /** Set when the exercise replaced a default pick (injury, soreness, kit). */
  substitutedFor?: string;
}

export interface WorkoutBlock {
  /** e.g. "Warmup", "Main", "Accessory", "Finisher". */
  title: string;
  /** Present for circuit-style blocks; the player loops the block. */
  rounds?: number;
  exercises: PlannedExercise[];
}

export interface WorkoutPlan {
  id: string;
  createdAt: string;
  /** ISO date (YYYY-MM-DD) this plan is intended for. */
  forDate: string;
  title: string;
  focus: Focus;
  estimatedMinutes: number;
  blocks: WorkoutBlock[];
  /** Two or three sentences on the shape of the session. */
  summary: string;
  constraints: SessionConstraints;
  /** How the plan was produced — surfaced in the UI and the usage ledger. */
  source: PlanSource;
}

export type PlanSource =
  | "planner"          // deterministic, zero AI tokens
  | "planner+ai"       // deterministic draft, AI patched it
  | "ai"               // AI wrote it from scratch
  | "cache"            // served from the plan cache
  | "manual";          // user built or edited it

/** One performed set, logged during or after the session. */
export interface LoggedSet {
  setIndex: number;
  reps?: number;
  seconds?: number;
  metres?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  /** Which side, for unilateral work. */
  side?: "left" | "right";
}

export interface LoggedExercise {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
  /** Free-text note, e.g. "left shoulder pinched on the last set". */
  note?: string;
  skipped?: boolean;
}

export interface WorkoutLog {
  id: string;
  planId?: string;
  /** ISO datetime the session started. */
  startedAt: string;
  finishedAt?: string;
  focus: Focus;
  exercises: LoggedExercise[];
  /** Post-session subjective rating, 1-5. */
  rating?: number;
  note?: string;
  /** Soreness reported at the start of this session, kept for trend analysis. */
  soreness: Soreness[];
}

/** A single exercise's progression state, derived from the log history. */
export interface ProgressionState {
  exerciseId: string;
  name: string;
  lastPerformed?: string;
  /** Best estimated 1RM seen, in kg. Undefined for bodyweight/time work. */
  bestE1rmKg?: number;
  /** Most recent working set, used to compute the next prescription. */
  lastTopSet?: { reps: number; weightKg?: number; seconds?: number };
  /** Total sessions this exercise appears in. */
  sessions: number;
  /** Sum of reps x weight over the trailing window, in kg. */
  trailingVolumeKg: number;
  /** Consecutive sessions where the top set did not improve. */
  stalledSessions: number;
}

/**
 * A compact, token-cheap rolling summary of training history. This — not the
 * raw logs — is what gets sent to the model, and it is regenerated only when
 * a session is logged.
 */
export interface TrainingDigest {
  version: number;
  generatedAt: string;
  /** e.g. "3.1 sessions/week over the last 4 weeks". */
  cadence: string;
  recentFocuses: Focus[];
  /** Key lifts with their current working numbers, capped to the top N. */
  keyLifts: Array<{
    name: string;
    lastTopSet: string;
    trend: "up" | "flat" | "down";
  }>;
  /** Muscles trained least in the trailing window — the planner biases toward these. */
  underTrained: Muscle[];
  /** Persistent constraints worth remembering across sessions. */
  standingNotes: string[];
  /**
   * How the last few sessions actually landed, in the user's own words.
   * Without this, "that was too easy" has nowhere to go.
   */
  recentFeedback: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** Attached when the assistant produced or changed a plan in this turn. */
  planId?: string;
}

/** Per-call record in the usage ledger. */
export interface UsageRecord {
  id: string;
  createdAt: string;
  provider: "anthropic" | "gemini";
  model: string;
  /** What the call was for — lets the UI show where the money went. */
  purpose: "plan" | "patch" | "chat" | "digest" | "explain";
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface UsageSummary {
  windowStart: string;
  totalCostUsd: number;
  budgetUsd: number;
  callCount: number;
  /** Sessions served without any AI call at all. */
  plannerOnlyCount: number;
  cacheHitRate: number;
  byPurpose: Record<string, { calls: number; costUsd: number }>;
}

/* ------------------------------------------------------------------ */
/* API request/response shapes                                         */
/* ------------------------------------------------------------------ */

export interface GeneratePlanRequest {
  constraints: SessionConstraints;
  /** Force a fresh AI plan even when the deterministic planner would do. */
  forceAi?: boolean;
  /** Skip the plan cache. */
  noCache?: boolean;
}

export interface GeneratePlanResponse {
  plan: WorkoutPlan;
  /** Populated when an AI call was made. */
  usage?: UsageRecord;
  /** Human-readable note about why this route was taken. */
  routing: string;
}

export interface ChatRequest {
  message: string;
  /** Continue an existing thread; omit to start one. */
  threadId?: string;
  /** Plan the user is looking at, so the model can talk about it. */
  planId?: string;
}

export interface ChatResponse {
  threadId: string;
  reply: ChatMessage;
  /** Set when the turn produced a new or modified plan. */
  plan?: WorkoutPlan;
  usage?: UsageRecord;
}
