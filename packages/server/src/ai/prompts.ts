import { EXERCISES } from "@fc/shared";
import type {
  SessionConstraints,
  TrainingDigest,
  WorkoutPlan,
} from "@fc/shared";

/**
 * A compact, deterministic catalog of every exercise the model may choose
 * from. Full descriptions and videos stay on the server — the model only
 * needs enough to pick and justify a movement.
 *
 * This string must stay byte-stable across requests: it is the bulk of the
 * cached prompt prefix, and any change invalidates the cache for everyone.
 */
function buildCatalog(): string {
  return [...EXERCISES]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const parts = [
        e.id,
        e.name,
        e.pattern,
        e.equipment.join("+"),
        e.primary.join(","),
        e.metric,
      ];
      if (e.stresses.length) parts.push(`stresses:${e.stresses.join(",")}`);
      if (e.unilateral) parts.push("unilateral");
      return parts.join("|");
    })
    .join("\n");
}

const CATALOG = buildCatalog();

/**
 * Frozen system prompt. Sent with `cache_control` so repeat calls read it from
 * cache at ~10% of the input rate. Nothing volatile — no dates, no user data,
 * no request ids — may appear anywhere in this string.
 */
export const SYSTEM_PROMPT = `You are the training coach inside a personal workout app. You know strength training, programming, and how to work around injuries and bad days.

You are given a session that a deterministic planner already built from the user's equipment, time, soreness, injuries, energy, and lift history. Your job is to improve it where your judgement genuinely adds something, and otherwise leave it alone. Returning zero operations is a good answer when the draft is already right.

RULES
- Only ever reference exercises by an id from the CATALOG below. Never invent an id, and never name an exercise that is not in the catalog.
- Injuries are absolute. Never add an exercise whose "stresses" tags include an area the user flagged as injured.
- Respect the equipment list exactly. An exercise is only usable if every item in its equipment field is available.
- Sore muscles should not be the primary target of hard work, but they can be trained lightly or used as secondary movers.
- Do not increase total volume when the user reports low energy or high soreness. Cutting volume is usually the right call.
- Progression is already computed from the user's logged history. Only override a prescribed weight or rep target if the user's note gives you a specific reason.
- Prefer the smallest change that addresses the user's note. Swapping one exercise beats rebuilding the session.
- Keep reasons to a single short sentence written directly to the user, second person, no preamble.

CATALOG
Format: id|name|pattern|equipment|primary_muscles|metric[|stresses:...][|unilateral]
${CATALOG}`;

/** Volatile per-request context. Kept short — this is billed at full rate. */
export function renderConstraints(c: SessionConstraints): string {
  const lines = [
    `equipment: ${c.equipment.length ? c.equipment.join(", ") : "bodyweight"}`,
    `time: ${c.minutes} min`,
    `energy: ${c.energy}/5`,
  ];
  const sore = c.soreness.filter((s) => s.level > 0);
  if (sore.length) {
    lines.push(`soreness: ${sore.map((s) => `${s.muscle} ${s.level}/3`).join(", ")}`);
  }
  if (c.injuries.length) lines.push(`injuries: ${c.injuries.join(", ")}`);
  if (c.focus) lines.push(`focus: ${c.focus}`);
  if (c.notes?.trim()) lines.push(`note: ${c.notes.trim()}`);
  return lines.join("\n");
}

export function renderDigest(digest: TrainingDigest | undefined): string {
  if (!digest) return "history: none yet (first sessions)";
  const lines = [`cadence: ${digest.cadence}`];
  if (digest.recentFocuses.length) {
    lines.push(`recent sessions: ${digest.recentFocuses.join(", ")}`);
  }
  if (digest.keyLifts.length) {
    lines.push(
      `key lifts: ${digest.keyLifts
        .map((l) => `${l.name} ${l.lastTopSet} (${l.trend})`)
        .join("; ")}`,
    );
  }
  if (digest.underTrained.length) {
    lines.push(`under-trained: ${digest.underTrained.join(", ")}`);
  }
  if (digest.standingNotes.length) {
    lines.push(`standing notes: ${digest.standingNotes.join("; ")}`);
  }
  if (digest.recentFeedback.length) {
    lines.push(`how recent sessions felt: ${digest.recentFeedback.join(" | ")}`);
  }
  return lines.join("\n");
}

/** Compact rendering of the draft — ids and prescriptions only. */
export function renderPlanDraft(plan: WorkoutPlan): string {
  const lines: string[] = [`${plan.title} (~${plan.estimatedMinutes} min)`];
  for (const block of plan.blocks) {
    lines.push(`[${block.title}]`);
    for (const e of block.exercises) {
      const first = e.sets[0];
      const target = first?.seconds
        ? `${first.seconds}s`
        : first?.metres
          ? `${first.metres}m`
          : `${first?.reps ?? "?"} reps`;
      const load = first?.weightKg ? ` @ ${first.weightKg}kg` : "";
      lines.push(`  ${e.exerciseId} ${e.sets.length}x${target}${load}`);
    }
  }
  return lines.join("\n");
}
