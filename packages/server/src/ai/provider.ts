import type {
  ChatMessage,
  SessionConstraints,
  TrainingDigest,
  UsageRecord,
  WorkoutPlan,
} from "@fc/shared";
import type { PlanPatch } from "./patch.js";

export interface PatchRequest {
  constraints: SessionConstraints;
  digest: TrainingDigest | undefined;
  draft: WorkoutPlan;
  /**
   * What the user asked to change about this specific session, e.g. "too
   * easy", "swap the squats", "I've only got 20 minutes now". Present only
   * when revising an already-shown plan.
   */
  feedback?: string;
}

export interface ChatTurnRequest {
  /** Prior turns, oldest first. Deliberately short. */
  history: ChatMessage[];
  message: string;
  digest: TrainingDigest | undefined;
  /** The session the user is currently looking at, if any. */
  plan: WorkoutPlan | undefined;
}

export interface AiResult<T> {
  data: T;
  usage: UsageRecord;
  /** True when the model declined the request. */
  refused?: boolean;
}

export interface AiProvider {
  readonly name: "anthropic" | "gemini";
  /** False when no API key is configured — callers fall back to the planner. */
  readonly available: boolean;
  /** Reviews a deterministic draft and returns a (usually small) patch. */
  patchPlan(request: PatchRequest): Promise<AiResult<PlanPatch>>;
  /** Free-form coaching conversation. */
  chat(request: ChatTurnRequest): Promise<AiResult<string>>;
}
