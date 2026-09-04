import type { WorkoutPlan } from "@fc/shared";
import type { ActiveSession } from "./Player.js";
interface Props {
    plan: WorkoutPlan | undefined;
    onPlan: (plan: WorkoutPlan) => void;
    onStart: (plan: WorkoutPlan) => void;
    onOpenExercise: (id: string) => void;
    resumable: ActiveSession | undefined;
    onResume: () => void;
    /** Result of a swap or removal made from the exercise sheet. */
    adjustNote?: string;
}
export declare function Today({ plan, onPlan, onStart, onOpenExercise, resumable, onResume, adjustNote, }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=Today.d.ts.map