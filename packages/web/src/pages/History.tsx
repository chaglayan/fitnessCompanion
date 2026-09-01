import { useEffect, useState } from "react";
import type { ProgressionState, WorkoutLog } from "@fc/shared";
import { api } from "../lib/api.js";

interface Props {
  onOpenExercise: (id: string) => void;
}

export function History({ onOpenExercise }: Props) {
  const [logs, setLogs] = useState<WorkoutLog[]>([]);
  const [progression, setProgression] = useState<ProgressionState[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.logs(), api.progression()])
      .then(([l, p]) => {
        setLogs(l);
        setProgression(p);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <p className="muted">
        <span className="spinner" /> Loading…
      </p>
    );
  }

  return (
    <>
      <h1>History</h1>
      <p className="sub">What you've done, and where it's going.</p>

      {error && <div className="banner banner--error">{error}</div>}

      {!logs.length && !error && (
        <p className="empty">
          No sessions logged yet.
          <br />
          Finish one and it'll show up here.
        </p>
      )}

      {progression.length > 0 && (
        <>
          <h2>Current numbers</h2>
          <div className="card">
            {progression.slice(0, 12).map((state) => (
              <button
                key={state.exerciseId}
                className="stat"
                onClick={() => onOpenExercise(state.exerciseId)}
                style={{
                  width: "100%",
                  background: "none",
                  border: 0,
                  borderBottom: "1px solid var(--line)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>
                  {state.name}
                  <span className="faint"> · {state.sessions} sessions</span>
                </span>
                <span className="stat__value">
                  {formatTopSet(state)}
                  {state.stalledSessions >= 3 && (
                    <span className="trend--down" title="Stalled">
                      {" "}
                      ▾
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {logs.length > 0 && (
        <>
          <h2>Sessions</h2>
          {logs.map((log) => {
            const setCount = log.exercises.reduce(
              (sum, e) => sum + e.sets.filter((s) => s.completed).length,
              0,
            );
            const volume = log.exercises.reduce(
              (sum, e) =>
                sum +
                e.sets.reduce((v, s) => v + (s.reps ?? 0) * (s.weightKg ?? 0), 0),
              0,
            );
            return (
              <div className="card" key={log.id}>
                <div className="card__head">
                  <h3>{titleCase(log.focus)}</h3>
                  <span className="faint">{formatDate(log.startedAt)}</span>
                </div>
                <p className="faint" style={{ margin: "4px 0 8px" }}>
                  {setCount} sets
                  {volume > 0 && ` · ${Math.round(volume).toLocaleString()} kg volume`}
                  {log.finishedAt && ` · ${duration(log.startedAt, log.finishedAt)}`}
                </p>
                <div className="taglist">
                  {log.exercises
                    .filter((e) => !e.skipped)
                    .map((e) => (
                      <button
                        key={e.exerciseId}
                        className="tag"
                        onClick={() => onOpenExercise(e.exerciseId)}
                        style={{ cursor: "pointer" }}
                      >
                        {e.name}
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function formatTopSet(state: ProgressionState): string {
  const top = state.lastTopSet;
  if (!top) return "—";
  if (top.seconds) return `${top.seconds}s`;
  if (top.weightKg) return `${top.reps} × ${top.weightKg}kg`;
  return `${top.reps} reps`;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function duration(from: string, to: string): string {
  const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  return `${minutes} min`;
}
