import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { ExerciseDetail } from "../lib/api.js";

interface Props {
  exerciseId: string;
  onClose: () => void;
}

/** Cached across opens so re-tapping an exercise is instant and offline-safe. */
const cache = new Map<string, ExerciseDetail>();

export function ExerciseSheet({ exerciseId, onClose }: Props) {
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
