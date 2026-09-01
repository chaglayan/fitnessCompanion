import { createHash } from "node:crypto";
import type {
  ChatMessage,
  GeneratePlanResponse,
  SessionConstraints,
  UsageRecord,
  WorkoutPlan,
} from "@fc/shared";
import { config } from "../config.js";
import {
  getCachedPlanId,
  getDigest,
  getPlan,
  getThread,
  listLogs,
  recordPlannerHit,
  recordUsage,
  saveChatMessage,
  savePlan,
  setCachedPlanId,
  spendSince,
} from "../db.js";
import { buildPlan } from "../planner/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { applyPatch } from "./patch.js";
import type { AiProvider } from "./provider.js";

let provider: AiProvider | undefined;

export function getProvider(): AiProvider {
  if (!provider) {
    provider = config.provider === "gemini" ? new GeminiProvider() : new AnthropicProvider();
  }
  return provider;
}

/* ------------------------------ budget ------------------------------- */

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  exhausted: boolean;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

export function budgetStatus(): BudgetStatus {
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const spentUsd = spendSince(since);
  const budgetUsd = config.monthlyBudgetUsd;
  return {
    spentUsd,
    budgetUsd,
    exhausted: budgetUsd > 0 && spentUsd >= budgetUsd,
  };
}

/* --------------------------- plan generation -------------------------- */

/**
 * Stable fingerprint for a plan request. Identical inputs — same kit, same
 * time, same soreness, same note, same training history — reuse the cached
 * plan instead of paying for it twice.
 */
function fingerprint(constraints: SessionConstraints, digestStamp: string): string {
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
  return createHash("sha256").update(JSON.stringify(normalised)).digest("hex").slice(0, 32);
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
  constraints: SessionConstraints,
  options: GenerateOptions = {},
): Promise<GeneratePlanResponse> {
  const digest = getDigest();
  const stamp = digest?.generatedAt ?? "none";
  const key = fingerprint(constraints, stamp);

  if (!options.noCache) {
    const cachedId = getCachedPlanId(key, config.planCacheTtlMin);
    const cached = cachedId ? getPlan(cachedId) : undefined;
    if (cached) {
      recordPlannerHit("cache");
      return {
        plan: { ...cached, source: "cache" },
        routing: "Served from the plan cache — identical request, no tokens spent.",
      };
    }
  }

  const logs = listLogs(40);
  const { plan: draft } = buildPlan({ constraints, logs });

  const hasNote = Boolean(constraints.notes?.trim());
  const wantsAi = options.forceAi || hasNote || !config.plannerFirst;
  const ai = getProvider();
  const budget = budgetStatus();

  if (!wantsAi) {
    savePlan(draft);
    setCachedPlanId(key, draft.id);
    recordPlannerHit("planner");
    return {
      plan: draft,
      routing: "Built by the deterministic planner — no AI call needed.",
    };
  }

  if (!ai.available) {
    savePlan(draft);
    recordPlannerHit("planner");
    return {
      plan: draft,
      routing: `No ${config.provider} API key configured — used the deterministic planner.`,
    };
  }

  if (budget.exhausted) {
    savePlan(draft);
    recordPlannerHit("planner");
    return {
      plan: draft,
      routing: `Monthly AI budget of $${budget.budgetUsd.toFixed(2)} is spent — used the deterministic planner.`,
    };
  }

  try {
    const result = await ai.patchPlan({ constraints, digest, draft });
    recordUsage(result.usage);

    const { plan, applied, rejected } = applyPatch(draft, result.data, constraints);
    savePlan(plan);
    setCachedPlanId(key, plan.id);

    const routing = buildRouting(result.usage, applied, rejected, result.refused);
    return { plan, usage: result.usage, routing };
  } catch (error) {
    console.error("[ai] patchPlan failed, falling back to the planner:", error);
    savePlan(draft);
    recordPlannerHit("planner");
    return {
      plan: draft,
      routing: "AI call failed — fell back to the deterministic planner.",
    };
  }
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

/* ------------------------------- chat -------------------------------- */

export interface ChatResult {
  threadId: string;
  reply: ChatMessage;
  usage?: UsageRecord;
  plan?: WorkoutPlan;
}

export async function chat(
  message: string,
  threadId: string | undefined,
  planId: string | undefined,
): Promise<ChatResult> {
  const thread = threadId ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: message,
    createdAt: now,
  };
  saveChatMessage(thread, userMessage);

  const ai = getProvider();
  const budget = budgetStatus();

  const decline = (text: string): ChatResult => {
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: text,
      createdAt: new Date().toISOString(),
    };
    saveChatMessage(thread, reply);
    return { threadId: thread, reply };
  };

  if (!ai.available) {
    return decline(
      `Chat needs an API key. Set ${config.provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} in the server's .env — sessions still work without it.`,
    );
  }
  if (budget.exhausted) {
    return decline(
      `Your $${budget.budgetUsd.toFixed(2)} monthly AI budget is spent, so chat is paused. Sessions are still being generated by the planner. Raise AI_MONTHLY_BUDGET_USD to turn chat back on.`,
    );
  }

  // History excludes the message we just saved; the provider appends it.
  const history = getThread(thread).filter((m) => m.id !== userMessage.id);
  const plan = planId ? getPlan(planId) : undefined;

  try {
    const result = await ai.chat({
      history,
      message,
      digest: getDigest(),
      plan,
    });
    recordUsage(result.usage);

    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.data,
      createdAt: new Date().toISOString(),
      ...(planId ? { planId } : {}),
    };
    saveChatMessage(thread, reply);
    return { threadId: thread, reply, usage: result.usage };
  } catch (error) {
    console.error("[ai] chat failed:", error);
    return decline("I couldn't reach the model just now. Try again in a moment.");
  }
}
