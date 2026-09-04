import type { WorkoutPlan } from "@fc/shared";
interface Props {
    exerciseId: string;
    onClose: () => void;
    /**
     * Present when the sheet was opened from a session that has not started.
     * Enables the free swap/remove actions.
     */
    planId?: string;
    onPlanChanged?: (plan: WorkoutPlan, note: string) => void;
}
export declare function ExerciseSheet({ exerciseId, onClose, planId, onPlanChanged }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=ExerciseSheet.d.ts.map