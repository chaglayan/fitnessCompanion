import type {
  ChatMessage,
  GeneratePlanResponse,
  SessionConstraints,
  UsageRecord,
  WorkoutPlan,
} from "@fc/shared";
import type { Config } from "../config.js";
import { aiAvailable } from "../config.js";
import type { Store } from "../store/types.js";
import { buildPlan } from "../planner/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { applyPatch } from "./patch.js";
import type { AiProvider } from "./provider.js";

export interface Deps {
  store: Store;
  config: Config;
  /** Overridable so tests can drive the routing without a real API call. */
  provider?: AiProvider;
}

export function getProvider(deps: Deps): AiProvider {
  if (deps.provider) return deps.provider;
  return deps.config.provider === "gemini"
    ? new GeminiProvider(deps.config)
    : new AnthropicProvider(deps.config);
}

/* ------------------------------ budget ------------------------------- */

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  exhausted: boolean;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

export async function budgetStatus(deps: Deps): Promise<BudgetStatus> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const spentUsd = await deps.store.spendSince(since);
  const budgetUsd = deps.config.monthlyBudgetUsd;
  return { spentUsd, budgetUsd, exhausted: budgetUsd > 0 && spentUsd >= budgetUsd };
}

/* --------------------------- plan generation -------------------------- */

/**
 * Stable fingerprint for a plan request. Identical inputs — same kit, same
 * time, same soreness, same note, same training history — reuse the cached
 * plan instead of paying for it twice.
 *
 * Uses Web Crypto rather than node:crypto so it runs unchanged on Workers.
 */
async function fingerprint(
  constraints: SessionConstraints,
  digestStamp: string,
): Promise<string> {
  const normalised = {
    equipment: [...constraints.equipment].sort(),
    minutes: constraints.minutes,
    soreness: [...constraints.soreness]
      .filter((s) => s.level > 0)
      .sort((a, b) => a.muscle.localeCompare(b.muscle)),
    injuries: [...constraints.injuries].sort(),
    energy: constraints.energy,
    focus: constraints.focus ?? null,
    notes: constraints.notes?.trim().toLowerCase() ?? "",
    digestStamp,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(normalised));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export interface GenerateOptions {
  forceAi?: boolean;
  noCache?: boolean;
}

/**
 * Produces a session, spending as little as possible to do it.
 *
 * The routing ladder, cheapest first:
 *   1. Plan cache — identical request seen recently, zero tokens.
 *   2. Deterministic planner — no free-text note, zero tokens.
 *   3. Planner draft + AI patch — a note or an explicit request for AI input.
 * Anything that fails on the AI path degrades back to the deterministic plan
 * rather than erroring, so a missing key or a spent budget never blocks a
 * workout.
 */
export async function generateSession(
  deps: Deps,
  constraints: SessionConstraints,
  options: GenerateOptions = {},
): Promise<GeneratePlanResponse> {
  const { store, config } = deps;
  const digest = await store.getDigest();
  const key = await fingerprint(constraints, digest?.generatedAt ?? "none");

  if (!options.noCache) {
    const cachedId = await store.getCachedPlanId(key, config.planCacheTtlMin);
    const cached = cachedId ? await store.getPlan(cachedId) : undefined;
    if (cached) {
      await store.recordPlannerHit("cache");
      return {
        plan: { ...cached, source: "cache" },
        routing: "Served from the plan cache — identical request, no tokens spent.",
      };
    }
  }

  const logs = await store.listLogs(40);
  const { plan: draft } = buildPlan({ constraints, logs });

  const hasNote = Boolean(constraints.notes?.trim());
  const wantsAi = options.forceAi || hasNote || !config.plannerFirst;

  const usePlanner = async (routing: string): Promise<GeneratePlanResponse> => {
    await store.savePlan(draft);
    await store.recordPlannerHit("planner");
    return { plan: draft, routing };
  };

  if (!wantsAi) {
    await store.savePlan(draft);
    await store.setCachedPlanId(key, draft.id);
    await store.recordPlannerHit("planner");
    return { plan: draft, routing: "Built by the deterministic planner — no AI call needed." };
  }

  if (!aiAvailable(config)) {
    return usePlanner(
      `No ${config.provider} API key configured — used the deterministic planner.`,
    );
  }

  const budget = await budgetStatus(deps);
  if (budget.exhausted) {
    return usePlanner(
      `Monthly AI budget of $${budget.budgetUsd.toFixed(2)} is spent — used the deterministic planner.`,
    );
  }

  try {
    const result = await getProvider(deps).patchPlan({ constraints, digest, draft });
    await store.recordUsage(result.usage);

    const { plan, applied, rejected } = applyPatch(draft, result.data, constraints);
    await store.savePlan(plan);
    await store.setCachedPlanId(key, plan.id);

    return {
      plan,
      usage: result.usage,
      routing: buildRouting(result.usage, applied, rejected, result.refused),
    };
  } catch (error) {
    console.error("[ai] patchPlan failed, falling back to the planner:", error);
    return usePlanner(
      `AI call failed — fell back to the deterministic planner. ${describe(error)}`,
    );
  }
}

/** Surfaces an actionable reason in the UI instead of a bare failure. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

function buildRouting(
  usage: UsageRecord,
  applied: string[],
  rejected: string[],
  refused?: boolean,
): string {
  if (refused) return "The model declined this one — showing the planner's session.";
  const cost = `$${usage.costUsd.toFixed(4)}`;
  const cacheNote = usage.cachedInputTokens > 0 ? ", prompt cache hit" : "";
  const head = applied.length
    ? `AI adjusted ${applied.length} thing(s) (${cost}${cacheNote}): ${applied.join(" ")}`
    : `AI reviewed the session and left it as-is (${cost}${cacheNote}).`;
  return rejected.length ? `${head} Ignored: ${rejected.join(" ")}` : head;
}

/* ------------------------------ revision ------------------------------ */

export interface ReviseResult extends GeneratePlanResponse {
  /** Changes the guardrails refused, so the UI can be honest about them. */
  rejected?: string[];
  /**
   * False when the request never reached the model — no key, or the budget is
   * spent. The client keeps the user's text in that case rather than clearing
   * a paragraph of feedback that was never sent anywhere.
   */
  aiCalled: boolean;
}

/**
 * Applies a user's free-text feedback to a plan they are looking at.
 *
 * Unlike generation, this always calls the model — reacting to "make it
 * harder" or "swap the squats" is exactly the judgement the planner cannot
 * make. The result is saved as a new plan so the original stays in history.
 */
export async function revisePlan(
  deps: Deps,
  planId: string,
  feedback: string,
): Promise<ReviseResult> {
  const { store, config } = deps;
  const current = await store.getPlan(planId);
  if (!current) throw new Error("That session no longer exists — build a new one.");

  if (!aiAvailable(config)) {
    return {
      plan: current,
      aiCalled: false,
      routing:
        `Detailed feedback needs an API key. Set ${config.provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} on the server — ` +
        "your text is still here. The quick buttons above work without one.",
    };
  }

  const budget = await budgetStatus(deps);
  if (budget.exhausted) {
    return {
      plan: current,
      aiCalled: false,
      routing: `Your $${budget.budgetUsd.toFixed(2)} monthly AI budget is spent, so detailed feedback is paused until it resets. The quick buttons still work.`,
    };
  }

  const result = await getProvider(deps).patchPlan({
    constraints: current.constraints,
    digest: await store.getDigest(),
    draft: current,
    feedback,
  });
  await store.recordUsage(result.usage);

  const { plan, applied, rejected } = applyPatch(current, result.data, current.constraints);
  // A revision is a new plan, so the original stays intact in history.
  const revised: WorkoutPlan = {
    ...plan,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: applied.length ? "planner+ai" : plan.source,
  };
  await store.savePlan(revised);

  return {
    plan: revised,
    usage: result.usage,
    aiCalled: true,
    routing: applied.length
      ? `${applied.join(" ")} ($${result.usage.costUsd.toFixed(4)})`
      : `No changes made — the model judged the session already fits what you asked. ($${result.usage.costUsd.toFixed(4)})`,
    ...(rejected.length ? { rejected } : {}),
  };
}

/* ------------------------------- chat -------------------------------- */

export interface ChatResult {
  threadId: string;
  reply: ChatMessage;
  usage?: UsageRecord;
  plan?: WorkoutPlan;
}

export async function chat(
  deps: Deps,
  message: string,
  threadId: string | undefined,
  planId: string | undefined,
): Promise<ChatResult> {
  const { store, config } = deps;
  const thread = threadId ?? crypto.randomUUID();

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: message,
    createdAt: new Date().toISOString(),
  };
  await store.saveChatMessage(thread, userMessage);

  const decline = async (text: string): Promise<ChatResult> => {
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: text,
      createdAt: new Date().toISOString(),
    };
    await store.saveChatMessage(thread, reply);
    return { threadId: thread, reply };
  };

  if (!aiAvailable(config)) {
    return decline(
      `Chat needs an API key. Set ${config.provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} on the server — sessions still work without it.`,
    );
  }

  const budget = await budgetStatus(deps);
  if (budget.exhausted) {
    return decline(
      `Your $${budget.budgetUsd.toFixed(2)} monthly AI budget is spent, so chat is paused. Sessions are still being generated by the planner. Raise AI_MONTHLY_BUDGET_USD to turn chat back on.`,
    );
  }

  const history = (await store.getThread(thread)).filter((m) => m.id !== userMessage.id);
  const plan = planId ? await store.getPlan(planId) : undefined;

  try {
    const result = await getProvider(deps).chat({
      history,
      message,
      digest: await store.getDigest(),
      plan,
    });
    await store.recordUsage(result.usage);

    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.data,
      createdAt: new Date().toISOString(),
      ...(planId ? { planId } : {}),
    };
    await store.saveChatMessage(thread, reply);
    return { threadId: thread, reply, usage: result.usage };
  } catch (error) {
    console.error("[ai] chat failed:", error);
    return decline(`I couldn't reach the model just now. ${describe(error)}`);
  }
}
