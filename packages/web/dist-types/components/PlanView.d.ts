import type { PlannedExercise, WorkoutPlan } from "@fc/shared";
/** Renders a set prescription as the short target string shown on the right. */
export declare function targetLabel(exercise: PlannedExercise): string;
interface Props {
    plan: WorkoutPlan;
    onOpenExercise: (id: string) => void;
    /** Exercise ids already completed, shown struck through. */
    done?: Set<string>;
}
export declare function PlanView({ plan, onOpenExercise, done }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PlanView.d.ts.map