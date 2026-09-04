import { useCallback, useEffect, useState } from "react";
import type { WorkoutPlan } from "@fc/shared";
import { ExerciseSheet } from "./components/ExerciseSheet.js";
import { Today } from "./pages/Today.js";
import { Player } from "./pages/Player.js";
import { History } from "./pages/History.js";
import { Coach } from "./pages/Coach.js";
import { You } from "./pages/You.js";
import { primeAudio } from "./lib/useCountdown.js";
import { loadActiveSession } from "./lib/storage.js";
import type { ActiveSession } from "./pages/Player.js";

export type Tab = "today" | "history" | "coach" | "you";

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "today", label: "Today", icon: "▶" },
  { id: "history", label: "History", icon: "≡" },
  { id: "coach", label: "Coach", icon: "✦" },
  { id: "you", label: "You", icon: "◍" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [plan, setPlan] = useState<WorkoutPlan | undefined>();
  const [playing, setPlaying] = useState(false);
  /** Exercise id whose detail sheet is open. */
  const [detailId, setDetailId] = useState<string | undefined>();
  /** Note from a free swap/remove, surfaced on the Today screen. */
  const [adjustNote, setAdjustNote] = useState<string | undefined>();

  // Offer to resume a session that was interrupted (phone died, tab closed).
  const [resumable, setResumable] = useState<ActiveSession | undefined>(() =>
    loadActiveSession<ActiveSession>(),
  );

  // The first tap anywhere unlocks audio, so timer cues can make a sound
  // later — iOS only allows an AudioContext to start from a user gesture.
  useEffect(() => {
    const onFirstTap = () => primeAudio();
    window.addEventListener("pointerdown", onFirstTap, { once: true });
    return () => window.removeEventListener("pointerdown", onFirstTap);
  }, []);

  const startSession = useCallback((next: WorkoutPlan) => {
    setPlan(next);
    setResumable(undefined);
    setPlaying(true);
  }, []);

  const endSession = useCallback(() => {
    setPlaying(false);
    setResumable(undefined);
    setTab("history");
  }, []);

  if (playing && plan) {
    return (
      <>
        <Player
          plan={plan}
          onExit={() => setPlaying(false)}
          onFinished={endSession}
          onOpenExercise={setDetailId}
        />
        {detailId && (
          <ExerciseSheet exerciseId={detailId} onClose={() => setDetailId(undefined)} />
        )}
      </>
    );
  }

  return (
    <div className="app">
      <main className="app__main">
        {tab === "today" && (
          <Today
            plan={plan}
            onPlan={setPlan}
            onStart={startSession}
            onOpenExercise={setDetailId}
            resumable={resumable}
            onResume={() => setPlaying(true)}
            adjustNote={adjustNote}
          />
        )}
        {tab === "history" && <History onOpenExercise={setDetailId} />}
        {tab === "coach" && <Coach planId={plan?.id} />}
        {tab === "you" && <You />}
      </main>

      <nav className="nav">
        {TABS.map((item) => (
          <button
            key={item.id}
            className="nav__item"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            <span className="nav__icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      {detailId && (
        <ExerciseSheet
          exerciseId={detailId}
          onClose={() => setDetailId(undefined)}
          {...(tab === "today" && plan ? { planId: plan.id } : {})}
          onPlanChanged={(next, note) => {
            setPlan(next);
            setAdjustNote(note);
          }}
        />
      )}
    </div>
  );
}
