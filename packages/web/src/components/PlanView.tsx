import type { PlannedExercise, WorkoutPlan } from "@fc/shared";

/** Renders a set prescription as the short target string shown on the right. */
export function targetLabel(exercise: PlannedExercise): string {
  const first = exercise.sets[0];
  if (!first) return "";
  const count = exercise.sets.length;
  if (first.seconds !== undefined) return `${count} × ${first.seconds}s`;
  if (first.metres !== undefined) return `${count} × ${first.metres}m`;
  const load = first.weightKg ? ` @ ${first.weightKg}kg` : "";
  return `${count} × ${first.reps ?? "?"}${load}`;
}

interface Props {
  plan: WorkoutPlan;
  onOpenExercise: (id: string) => void;
  /** Exercise ids already completed, shown struck through. */
  done?: Set<string>;
}

export function PlanView({ plan, onOpenExercise, done }: Props) {
  return (
    <>
      {plan.blocks.map((block) => (
        <section key={block.title}>
          <h3 className="block__title">{block.title}</h3>
          {block.exercises.map((exercise) => (
            <button
              key={exercise.exerciseId}
              className={`exercise${done?.has(exercise.exerciseId) ? " exercise--done" : ""}`}
              onClick={() => onOpenExercise(exercise.exerciseId)}
            >
              <span className="grow">
                <span className="exercise__name">{exercise.name}</span>
                <span className="exercise__meta">
                  {exercise.rationale}
                  {exercise.substitutedFor && ` (swapped in for ${exercise.substitutedFor})`}
                </span>
              </span>
              <span className="exercise__target">{targetLabel(exercise)}</span>
            </button>
          ))}
        </section>
      ))}
      <p className="faint" style={{ marginTop: 4 }}>
        Tap any exercise for how to do it and a video. Estimated{" "}
        {plan.estimatedMinutes} minutes.
      </p>
    </>
  );
}
