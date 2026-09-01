import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { UsageRecord } from "@fc/shared";
import { config } from "../config.js";
import { computeCostUsd } from "./pricing.js";
import { PlanPatchSchema } from "./patch.js";
import type { PlanPatch } from "./patch.js";
import {
  SYSTEM_PROMPT,
  renderConstraints,
  renderDigest,
  renderPlanDraft,
} from "./prompts.js";
import type {
  AiProvider,
  AiResult,
  ChatTurnRequest,
  PatchRequest,
} from "./provider.js";

/**
 * An identity-linked key without a workspace id fails identically on every
 * request, so retrying without betas just burns another round trip. Detect it
 * and say exactly what to set instead.
 */
function isWorkspaceIdError(error: InstanceType<typeof Anthropic.BadRequestError>): boolean {
  return error.message.includes("anthropic-workspace-id");
}

function workspaceIdHint(error: InstanceType<typeof Anthropic.BadRequestError>): Error {
  return new Error(
    "This API key is identity-linked, so every request must name a " +
      "workspace. Set ANTHROPIC_WORKSPACE_ID in .env to the workspace id " +
      '(starts with "wrkspc_") from console.anthropic.com → Settings → ' +
      `Workspaces. Original error: ${error.message}`,
  );
}

/** Enables server-side refusal fallbacks. Paired with `fallbacks: "default"`. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The cached prefix. Identical bytes on every request, so after the first call
 * it is billed at roughly a tenth of the input rate. A 1h TTL comfortably
 * spans a training session plus the chat around it.
 */
const CACHED_SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  {
    type: "text",
    text: SYSTEM_PROMPT,
    cache_control: { type: "ephemeral", ttl: "1h" },
  },
];

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function effort(value: string): Effort {
  const allowed: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  return allowed.includes(value as Effort) ? (value as Effort) : "low";
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly available: boolean;
  private readonly client: Anthropic | undefined;
  /**
   * Flipped off permanently if the API rejects the fallbacks parameter, so a
   * platform that does not support it costs one failed call, not every call.
   */
  private fallbacksEnabled = true;

  constructor() {
    this.available = Boolean(config.anthropicApiKey);
    this.client = this.available
      ? new Anthropic({
          apiKey: config.anthropicApiKey,
          // Identity-linked keys are workspace-scoped and reject any request
          // that does not name the workspace it acts in.
          ...(config.anthropicWorkspaceId
            ? {
                defaultHeaders: {
                  "anthropic-workspace-id": config.anthropicWorkspaceId,
                },
              }
            : {}),
        })
      : undefined;
  }

  async patchPlan(request: PatchRequest): Promise<AiResult<PlanPatch>> {
    const client = this.requireClient();
    const started = Date.now();

    const userContent = [
      "TODAY",
      renderConstraints(request.constraints),
      "",
      "HISTORY",
      renderDigest(request.digest),
      "",
      "DRAFT SESSION",
      renderPlanDraft(request.draft),
      "",
      "Review the draft against today's constraints and the user's note. Return only the operations that genuinely improve it — an empty operations list is the correct answer when the draft is already right.",
    ].join("\n");

    const response = await this.send((extra) =>
      client.beta.messages.parse({
        model: config.model,
        max_tokens: 2048,
        system: CACHED_SYSTEM,
        messages: [{ role: "user", content: userContent }],
        output_config: {
          effort: effort(config.planEffort),
          format: zodOutputFormat(PlanPatchSchema),
        },
        ...extra,
      }),
    );

    const usage = this.toUsage(response, "patch", Date.now() - started);

    if (response.stop_reason === "refusal") {
      return { data: { operations: [] }, usage, refused: true };
    }

    return { data: response.parsed_output ?? { operations: [] }, usage };
  }

  async chat(request: ChatTurnRequest): Promise<AiResult<string>> {
    const client = this.requireClient();
    const started = Date.now();

    const context = [
      "HISTORY",
      renderDigest(request.digest),
      request.plan ? `\nCURRENT SESSION\n${renderPlanDraft(request.plan)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...request.history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user" as const, content: `${context}\n\nQUESTION\n${request.message}` },
    ];

    const response = await this.send((extra) =>
      client.beta.messages.create({
        model: config.model,
        max_tokens: 1200,
        system: CACHED_SYSTEM,
        messages,
        output_config: { effort: effort(config.chatEffort) },
        ...extra,
      }),
    );

    const usage = this.toUsage(response, "chat", Date.now() - started);

    if (response.stop_reason === "refusal") {
      return {
        data: "I can't help with that one. Ask me about your training and I'm all yours.",
        usage,
        refused: true,
      };
    }

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return { data: text || "(no response)", usage };
  }

  /**
   * Runs a request with refusal fallbacks enabled, retrying once without them
   * if the API rejects the parameter. Keeps the app working on platforms where
   * server-side fallbacks are unavailable instead of failing every call.
   */
  private async send<T>(
    run: (extra: Record<string, unknown>) => Promise<T>,
  ): Promise<T> {
    if (!this.fallbacksEnabled) return run({});
    try {
      return await run({ betas: [FALLBACK_BETA], fallbacks: "default" });
    } catch (error) {
      if (error instanceof Anthropic.BadRequestError) {
        if (isWorkspaceIdError(error)) throw workspaceIdHint(error);
        this.fallbacksEnabled = false;
        console.warn(
          "[ai] Server-side refusal fallbacks rejected by the API — " +
            "continuing without them for the rest of this process.",
        );
        return run({});
      }
      throw error;
    }
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new Error("Anthropic provider called without an API key configured.");
    }
    return this.client;
  }

  private toUsage(
    response: { model: string; usage: Anthropic.Beta.BetaUsage },
    purpose: UsageRecord["purpose"],
    latencyMs: number,
  ): UsageRecord {
    const tokens = {
      inputTokens: response.usage.input_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
    };
    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      provider: "anthropic",
      // Report the model that actually served the turn, which can differ from
      // the configured one when a refusal fallback fires.
      model: response.model || config.model,
      purpose,
      ...tokens,
      costUsd: computeCostUsd("anthropic", response.model || config.model, tokens),
      latencyMs,
    };
  }
}
