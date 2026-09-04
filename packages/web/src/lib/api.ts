import type {
  ChatMessage,
  Exercise,
  GeneratePlanRequest,
  GeneratePlanResponse,
  ProgressionState,
  SessionConstraints,
  WorkoutLog,
  WorkoutPlan,
} from "@fc/shared";
import { loadSettings } from "./storage.js";

export interface ExerciseDetail extends Exercise {
  videoUrl: string;
}

export interface UsageSummaryResponse {
  windowStart: string;
  totalCostUsd: number;
  budgetUsd: number;
  callCount: number;
  plannerOnlyCount: number;
  cacheHitRate: number;
  costWithoutCachingUsd: number;
  byPurpose: Record<string, { calls: number; costUsd: number }>;
  recent: Array<{
    id: string;
    createdAt: string;
    model: string;
    purpose: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
  }>;
}

export interface ServerSettings {
  standingNotes: string[];
  defaultEquipment: string[];
  defaultMinutes: number;
  provider: string;
  model: string;
  aiAvailable: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { serverUrl, token } = loadSettings();
  // An empty serverUrl means "same origin", which is the case when the server
  // is serving the built PWA itself.
  const base = serverUrl.replace(/\/$/, "");

  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      base
        ? `Can't reach the server at ${base}. Check it's running and on the same network.`
        : "Can't reach the server.",
      0,
    );
  }

  if (response.status === 401) {
    throw new ApiError("Wrong access token — check Settings.", 401);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(detail.slice(0, 300) || `Request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; provider: string }>("/health"),

  exercises: () => request<ExerciseDetail[]>("/exercises"),
  exercise: (id: string) => request<ExerciseDetail>(`/exercises/${id}`),

  generatePlan: (body: GeneratePlanRequest) =>
    request<GeneratePlanResponse>("/plans/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  plan: (id: string) => request<WorkoutPlan>(`/plans/${id}`),

  /** Deterministic plan tweaks — instant, and free. */
  adjustPlan: (
    id: string,
    body:
      | { op: "harder" | "easier" | "shorter" | "longer" | "more_variety" }
      | { op: "swap" | "remove"; exerciseId: string },
  ) =>
    request<GeneratePlanResponse>(`/plans/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Applies free-text feedback to a plan; always costs an AI call. */
  revisePlan: (id: string, feedback: string) =>
    request<GeneratePlanResponse & { rejected?: string[] }>(`/plans/${id}/revise`, {
      method: "POST",
      body: JSON.stringify({ feedback }),
    }),
  plans: () => request<WorkoutPlan[]>("/plans"),

  saveLog: (log: Omit<WorkoutLog, "id"> & { id?: string }) =>
    request<{ log: WorkoutLog }>("/logs", {
      method: "POST",
      body: JSON.stringify(log),
    }),
  logs: () => request<WorkoutLog[]>("/logs"),

  progression: () => request<ProgressionState[]>("/stats/progression"),

  chat: (message: string, threadId?: string, planId?: string) =>
    request<{ threadId: string; reply: ChatMessage; usage?: unknown }>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, threadId, planId }),
    }),
  thread: (threadId: string) => request<ChatMessage[]>(`/chat/${threadId}`),

  usage: () => request<UsageSummaryResponse>("/usage"),

  settings: () => request<ServerSettings>("/settings"),
  saveSettings: (body: {
    standingNotes?: string[];
    defaultEquipment?: string[];
    defaultMinutes?: number;
  }) => request<{ ok: true }>("/settings", { method: "PUT", body: JSON.stringify(body) }),
};

export type { SessionConstraints };
