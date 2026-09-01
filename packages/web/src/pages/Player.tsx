import { useCallback, useEffect, useMemo, useState } from "react";
import type { LoggedSet, PlannedExercise, WorkoutLog, WorkoutPlan } from "@fc/shared";
import { api } from "../lib/api.js";
import {
  clearActiveSession,
  loadActiveSession,
  loadSettings,
  saveActiveSession,
} from "../lib/storage.js";
import { playCue, useCountdown, useWakeLock } from "../lib/useCountdown.js";

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

interface FlatExercise extends PlannedExercise {
  blockTitle: string;
}

function flatten(plan: WorkoutPlan): FlatExercise[] {
  return plan.blocks.flatMap((block) =>
    block.exercises.map((exercise) => ({ ...exercise, blockTitle: block.title })),
  );
}

export function Player({ plan, onExit, onFinished, onOpenExercise }: Props) {
  const exercises = useMemo(() => flatten(plan), [plan]);

  const [state, setState] = useState<ActiveSession>(() => {
    const saved = loadActiveSession<ActiveSession>();
    if (saved?.planId === plan.id) return saved;
    return {
      planId: plan.id,
      plan,
      startedAt: new Date().toISOString(),
      exerciseIndex: 0,
      setIndex: 0,
      logged: {},
    };
  });

  const [resting, setResting] = useState(false);
  const [actualReps, setActualReps] = useState<string>("");
  const [actualWeight, setActualWeight] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const current = exercises[state.exerciseIndex];
  const cues = loadSettings().cues;

  useWakeLock(true);

  // Persist on every change: a dead battery mid-session should cost nothing.
  useEffect(() => {
    saveActiveSession(state);
  }, [state]);

  const onTimerDone = useCallback(() => {
    if (cues) playCue();
  }, [cues]);

  const work = useCountdown(onTimerDone);
  const rest = useCountdown(onTimerDone);

  // Prefill the actuals with the prescription, so a set that went to plan is
  // one tap and a set that did not is a quick edit.
  useEffect(() => {
    const set = current?.sets[state.setIndex];
    setActualReps(set?.reps !== undefined ? String(set.reps) : "");
    setActualWeight(set?.weightKg !== undefined ? String(set.weightKg) : "");
    work.stop();
    // Intentionally keyed on position only — re-running on timer identity
    // would reset the countdown on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.exerciseIndex, state.setIndex, current?.exerciseId]);

  useEffect(() => {
    if (rest.finished) setResting(false);
  }, [rest.finished]);

  if (!current) {
    return (
      <div className="app">
        <main className="app__main">
          <p className="empty">This session has no exercises.</p>
          <button className="btn" onClick={onExit}>
            Back
          </button>
        </main>
      </div>
    );
  }

  const prescription = current.sets[state.setIndex];
  const doneSets = state.logged[current.exerciseId] ?? [];
  const isLastSet = state.setIndex >= current.sets.length - 1;
  const isLastExercise = state.exerciseIndex >= exercises.length - 1;

  const completeSet = () => {
    const entry: LoggedSet = {
      setIndex: state.setIndex,
      completed: true,
      ...(current.metric === "time"
        ? { seconds: prescription?.seconds ?? 0 }
        : { reps: Number(actualReps) || prescription?.reps || 0 }),
      ...(actualWeight ? { weightKg: Number(actualWeight) } : {}),
    };

    setState((s) => {
      const logged = { ...s.logged };
      const list = [...(logged[current.exerciseId] ?? [])];
      list[s.setIndex] = entry;
      logged[current.exerciseId] = list;

      const nextSet = s.setIndex + 1;
      if (nextSet < current.sets.length) {
        return { ...s, logged, setIndex: nextSet };
      }
      return {
        ...s,
        logged,
        exerciseIndex: Math.min(s.exerciseIndex + 1, exercises.length - 1),
        setIndex: 0,
      };
    });

    // No point resting after the final set of the final exercise.
    if (!(isLastSet && isLastExercise)) {
      setResting(true);
      rest.start(current.restSec);
    }
  };

  const skipExercise = () => {
    setState((s) => ({
      ...s,
      exerciseIndex: Math.min(s.exerciseIndex + 1, exercises.length - 1),
      setIndex: 0,
    }));
    setResting(false);
    rest.stop();
  };

  const goBack = () => {
    setState((s) =>
      s.setIndex > 0
        ? { ...s, setIndex: s.setIndex - 1 }
        : { ...s, exerciseIndex: Math.max(0, s.exerciseIndex - 1), setIndex: 0 },
    );
    setResting(false);
    rest.stop();
  };

  const finish = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const log: Omit<WorkoutLog, "id"> = {
        planId: plan.id,
        startedAt: state.startedAt,
        finishedAt: new Date().toISOString(),
        focus: plan.focus,
        soreness: plan.constraints.soreness,
        exercises: exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          sets: state.logged[exercise.exerciseId] ?? [],
          skipped: !(state.logged[exercise.exerciseId]?.length ?? 0),
        })),
      };
      await api.saveLog(log);
      clearActiveSession();
      onFinished();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const completedCount = Object.values(state.logged).flat().filter(Boolean).length;
  const totalSets = exercises.reduce((sum, e) => sum + e.sets.length, 0);

  return (
    <div className="app">
      <main className="app__main">
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn btn--sm btn--ghost" onClick={onExit}>
            ‹ Plan
          </button>
          <span className="grow faint" style={{ textAlign: "center" }}>
            {completedCount}/{totalSets} sets
          </span>
          <button className="btn btn--sm btn--ghost" onClick={finish} disabled={saving}>
            {saving ? <span className="spinner" /> : "Finish"}
          </button>
        </div>

        <div className="bar" style={{ marginBottom: 18 }}>
          <div
            className="bar__fill"
            style={{ width: `${totalSets ? (completedCount / totalSets) * 100 : 0}%` }}
          />
        </div>

        {error && <div className="banner banner--error">{error}</div>}

        <p className="block__title" style={{ margin: 0 }}>
          {current.blockTitle} · {state.exerciseIndex + 1} of {exercises.length}
        </p>

        <button
          className="btn btn--ghost"
          onClick={() => onOpenExercise(current.exerciseId)}
          style={{ textAlign: "left", padding: "10px 0", border: 0, fontSize: 22 }}
        >
          {current.name}
          <span className="faint" style={{ fontWeight: 400 }}>
            {"  "}ⓘ
          </span>
        </button>
        <p className="faint" style={{ marginTop: -4 }}>
          {current.rationale}
          {current.unilateral && " · each side"}
        </p>

        {resting ? (
          <>
            <div className="timer">
              <div className="timer__label">Rest</div>
              <div className="timer__value timer__value--rest">{format(rest.remaining)}</div>
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="btn btn--sm grow" onClick={() => rest.adjust(30)}>
                +30s
              </button>
              <button className="btn btn--sm grow" onClick={() => rest.adjust(-15)}>
                −15s
              </button>
            </div>
            <button
              className="btn btn--primary"
              onClick={() => {
                rest.stop();
                setResting(false);
              }}
            >
              Skip rest
            </button>
          </>
        ) : current.metric === "time" ? (
          <>
            <div className="timer">
              <div className="timer__label">Hold</div>
              <div
                className={`timer__value${work.finished ? " timer__value--done" : ""}`}
              >
                {format(work.running || work.remaining ? work.remaining : (prescription?.seconds ?? 0))}
              </div>
            </div>
            <SetDots count={current.sets.length} done={doneSets.length} current={state.setIndex} />
            {work.running ? (
              <div className="row">
                <button className="btn grow" onClick={work.pause}>
                  Pause
                </button>
                <button className="btn btn--primary grow" onClick={completeSet}>
                  Done
                </button>
              </div>
            ) : (
              <div className="row">
                <button
                  className="btn btn--primary grow"
                  onClick={() => work.start(prescription?.seconds ?? 30)}
                >
                  {work.finished ? "Restart" : "Start"}
                </button>
                {(work.finished || doneSets.length > 0) && (
                  <button className="btn grow" onClick={completeSet}>
                    Log set
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="reps">
              <div className="timer__label">Target</div>
              <div className="reps__value">
                {prescription?.reps ?? "—"}
                <span className="reps__unit"> reps</span>
              </div>
              {prescription?.weightKg !== undefined && (
                <p className="muted" style={{ marginTop: 6 }}>
                  {prescription.weightKg} kg
                  {prescription.rir !== undefined && ` · leave ${prescription.rir} in reserve`}
                </p>
              )}
            </div>

            <SetDots count={current.sets.length} done={doneSets.length} current={state.setIndex} />

            <div className="row" style={{ margin: "14px 0" }}>
              <label className="grow">
                <span className="field__label">Reps done</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={actualReps}
                  onChange={(e) => setActualReps(e.target.value)}
                />
              </label>
              <label className="grow">
                <span className="field__label">Weight (kg)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  value={actualWeight}
                  placeholder="—"
                  onChange={(e) => setActualWeight(e.target.value)}
                />
              </label>
            </div>

            <button className="btn btn--primary" onClick={completeSet}>
              Complete set {state.setIndex + 1} of {current.sets.length}
            </button>
          </>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn--sm btn--ghost grow" onClick={goBack}>
            ‹ Back
          </button>
          <button className="btn btn--sm btn--ghost grow" onClick={skipExercise}>
            Skip exercise ›
          </button>
        </div>
      </main>
    </div>
  );
}

function SetDots({
  count,
  done,
  current,
}: {
  count: number;
  done: number;
  current: number;
}) {
  return (
    <div className="setdots">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`setdot${i < done ? " setdot--done" : ""}${
            i === current && i >= done ? " setdot--current" : ""
          }`}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : String(s);
}
