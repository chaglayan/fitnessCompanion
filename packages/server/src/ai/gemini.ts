import type { UsageRecord } from "@fc/shared";
import type { Config } from "../config.js";
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

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

/**
 * Gemini implementation of the same contract, so the provider can be switched
 * with AI_PROVIDER=gemini without touching any calling code.
 *
 * Structured output is handled by asking for JSON and validating with the same
 * Zod schema rather than Gemini's responseSchema — the patch format is a
 * discriminated union, which that schema dialect handles poorly.
 */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  readonly available: boolean;

  constructor(private readonly config: Config) {
    this.available = Boolean(config.geminiApiKey);
  }

  async patchPlan(request: PatchRequest): Promise<AiResult<PlanPatch>> {
    const prompt = [
      "TODAY",
      renderConstraints(request.constraints),
      "",
      "HISTORY",
      renderDigest(request.digest),
      "",
      "DRAFT SESSION",
      renderPlanDraft(request.draft),
      "",
      ...(request.feedback
        ? [`The user has seen this session and asked for changes: "${request.feedback}". Make those changes — this is a direct request.`, ""]
        : []),
      'Reply with JSON only, matching: {"summary"?: string, "operations": [...]}.',
      'Each operation is one of: {"op":"swap","exerciseId":..,"withExerciseId":..,"reason":..}, ',
      '{"op":"remove","exerciseId":..,"reason":..}, ',
      '{"op":"add","exerciseId":..,"block":..,"sets":n,"reps"?:n,"seconds"?:n,"reason":..}, ',
      '{"op":"adjust","exerciseId":..,"sets"?:n,"reps"?:n,"seconds"?:n,"weightKg"?:n,"reason":..}.',
      'An empty operations list is correct when the draft is already right.',
    ].join("\n");

    const { text, usage } = await this.call(prompt, "patch", true, 2048);

    const parsed = safeJson(text);
    const validated = PlanPatchSchema.safeParse(parsed);
    return { data: validated.success ? validated.data : { operations: [] }, usage };
  }

  async chat(request: ChatTurnRequest): Promise<AiResult<string>> {
    const context = [
      "HISTORY",
      renderDigest(request.digest),
      request.plan ? `\nCURRENT SESSION\n${renderPlanDraft(request.plan)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const transcript = request.history
      .map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.content}`)
      .join("\n");

    const prompt = [
      transcript,
      context,
      "",
      `QUESTION\n${request.message}`,
      "",
      "Answer as the coach, in plain prose. No JSON.",
    ]
      .filter(Boolean)
      .join("\n");

    const { text, usage } = await this.call(prompt, "chat", false, 1200);
    return { data: text.trim() || "(no response)", usage };
  }

  private async call(
    prompt: string,
    purpose: UsageRecord["purpose"],
    json: boolean,
    maxOutputTokens: number,
  ): Promise<{ text: string; usage: UsageRecord }> {
    if (!this.config.geminiApiKey) {
      throw new Error("Gemini provider called without an API key configured.");
    }
    const started = Date.now();

    const response = await fetch(
      `${ENDPOINT}/${this.config.geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.config.geminiApiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens,
            temperature: 0.3,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Gemini request failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const body = (await response.json()) as GeminiResponse;
    const text =
      body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    const tokens = {
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      cachedInputTokens: body.usageMetadata?.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };

    return {
      text,
      usage: {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        provider: "gemini",
        model: this.config.geminiModel,
        purpose,
        ...tokens,
        costUsd: computeCostUsd("gemini", this.config.geminiModel, tokens),
        latencyMs: Date.now() - started,
      },
    };
  }
}

/** Tolerates a model that wraps its JSON in a markdown fence. */
function safeJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}
