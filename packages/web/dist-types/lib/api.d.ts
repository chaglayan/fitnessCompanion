import type { ChatMessage, Exercise, GeneratePlanRequest, GeneratePlanResponse, ProgressionState, SessionConstraints, WorkoutLog, WorkoutPlan } from "@fc/shared";
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
    byPurpose: Record<string, {
        calls: number;
        costUsd: number;
    }>;
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
export declare class ApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare const api: {
    health: () => Promise<{
        ok: boolean;
        provider: string;
    }>;
    exercises: () => Promise<ExerciseDetail[]>;
    exercise: (id: string) => Promise<ExerciseDetail>;
    generatePlan: (body: GeneratePlanRequest) => Promise<GeneratePlanResponse>;
    plan: (id: string) => Promise<WorkoutPlan>;
    /** Deterministic plan tweaks — instant, and free. */
    adjustPlan: (id: string, body: {
        op: "harder" | "easier" | "shorter" | "longer" | "more_variety";
    } | {
        op: "swap" | "remove";
        exerciseId: string;
    }) => Promise<GeneratePlanResponse>;
    /** Applies free-text feedback to a plan; always costs an AI call. */
    revisePlan: (id: string, feedback: string) => Promise<GeneratePlanResponse & {
        rejected?: string[];
        aiCalled: boolean;
    }>;
    plans: () => Promise<WorkoutPlan[]>;
    saveLog: (log: Omit<WorkoutLog, "id"> & {
        id?: string;
    }) => Promise<{
        log: WorkoutLog;
    }>;
    logs: () => Promise<WorkoutLog[]>;
    progression: () => Promise<ProgressionState[]>;
    chat: (message: string, threadId?: string, planId?: string) => Promise<{
        threadId: string;
        reply: ChatMessage;
        usage?: unknown;
    }>;
    thread: (threadId: string) => Promise<ChatMessage[]>;
    usage: () => Promise<UsageSummaryResponse>;
    settings: () => Promise<ServerSettings>;
    saveSettings: (body: {
        standingNotes?: string[];
        defaultEquipment?: string[];
        defaultMinutes?: number;
    }) => Promise<{
        ok: true;
    }>;
};
export type { SessionConstraints };
//# sourceMappingURL=api.d.ts.map