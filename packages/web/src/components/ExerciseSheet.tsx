import { useEffect, useState } from "react";
import type { WorkoutPlan } from "@fc/shared";
import { api } from "../lib/api.js";
import type { ExerciseDetail } from "../lib/api.js";

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

/** Cached across opens so re-tapping an exercise is instant and offline-safe. */
const cache = new Map<string, ExerciseDetail>();

export function ExerciseSheet({ exerciseId, onClose, planId, onPlanChanged }: Props) {
  const [busy, setBusy] = useState<"swap" | "remove" | undefined>();
  const [exercise, setExercise] = useState<ExerciseDetail | undefined>(() =>
    cache.get(exerciseId),
  );
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (cache.has(exerciseId)) {
      setExercise(cache.get(exerciseId));
      return;
    }
    let cancelled = false;
    api
      .exercise(exerciseId)
      .then((detail) => {
        cache.set(exerciseId, detail);
        if (!cancelled) setExercise(detail);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  // Escape closes on desktop; the phone's back gesture hits the backdrop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (op: "swap" | "remove") => {
    if (!planId || !onPlanChanged) return;
    setBusy(op);
    setError(undefined);
    try {
      const result = await api.adjustPlan(planId, { op, exerciseId });
      onPlanChanged(result.plan, result.routing);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div
      className="sheet__backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Exercise detail"
    >
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet__grip" />

        {error && <div className="banner banner--error">{error}</div>}

        {!exercise && !error && (
          <p className="muted">
            <span className="spinner" /> Loading…
          </p>
        )}

        {exercise && (
          <>
            <h1>{exercise.name}</h1>
            <p className="sub">
              {exercise.pattern.replace(/_/g, " ")} ·{" "}
              {exercise.primary.join(", ").replace(/_/g, " ")}
            </p>

            <p>{exercise.description}</p>

            <h3>Form cues</h3>
            <ul className="cues">
              {exercise.cues.map((cue) => (
                <li key={cue}>{cue}</li>
              ))}
            </ul>

            <div className="taglist">
              {exercise.equipment.map((item) => (
                <span key={item} className="tag">
                  {item.replace(/_/g, " ")}
                </span>
              ))}
              {exercise.unilateral && <span className="tag">per side</span>}
              <span className="tag">rest {exercise.restSec}s</span>
              {exercise.stresses.map((area) => (
                <span key={area} className="tag">
                  loads {area.replace(/_/g, " ")}
                </span>
              ))}
            </div>

            {planId && onPlanChanged && (
              <>
                <div className="row" style={{ marginBottom: 6 }}>
                  <button
                    className="btn grow"
                    disabled={busy !== undefined}
                    onClick={() => void act("swap")}
                  >
                    {busy === "swap" ? <span className="spinner" /> : "Swap exercise"}
                  </button>
                  <button
                    className="btn btn--danger grow"
                    disabled={busy !== undefined}
                    onClick={() => void act("remove")}
                  >
                    {busy === "remove" ? <span className="spinner" /> : "Remove"}
                  </button>
                </div>
                <p className="faint" style={{ marginBottom: 14, textAlign: "center" }}>
                  Instant and free — no AI call.
                </p>
              </>
            )}

            <a
              className="btn btn--primary"
              href={exercise.videoUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: "grid", placeItems: "center", textDecoration: "none" }}
            >
              Watch demonstration ↗
            </a>
            <p className="faint" style={{ marginTop: 10, textAlign: "center" }}>
              Opens YouTube in a new tab.
            </p>
          </>
        )}

        <button className="btn btn--ghost" onClick={onClose} style={{ marginTop: 8 }}>
          Close
        </button>
      </div>
    </div>
  );
}
