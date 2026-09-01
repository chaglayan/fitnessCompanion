import type { LoggedSet, WorkoutPlan } from "@fc/shared";
export interface ActiveSession {
    planId: string;
    plan: WorkoutPlan;
    startedAt: string;
    exerciseIndex: number;
    setIndex: number;
    /** Completed sets, keyed by exercise id. */
    logged: Record<string, LoggedSet[]>;
}
interface Props {
    plan: WorkoutPlan;
    onExit: () => void;
    onFinished: () => void;
    onOpenExercise: (id: string) => void;
}
export declare function Player({ plan, onExit, onFinished, onOpenExercise }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=Player.d.ts.map