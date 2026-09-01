import { useEffect, useState } from "react";
import type {
  Equipment,
  Focus,
  InjuryArea,
  Muscle,
  SessionConstraints,
  SorenessLevel,
  WorkoutPlan,
} from "@fc/shared";
import { api } from "../lib/api.js";
import { loadSettings, saveSettings } from "../lib/storage.js";
import { PlanView } from "../components/PlanView.js";
import type { ActiveSession } from "./Player.js";

const EQUIPMENT_OPTIONS: Array<{ id: Equipment; label: string }> = [
  { id: "bodyweight", label: "Bodyweight" },
  { id: "dumbbell", label: "Dumbbells" },
  { id: "barbell", label: "Barbell" },
  { id: "rack", label: "Rack" },
  { id: "bench", label: "Bench" },
  { id: "kettlebell", label: "Kettlebell" },
  { id: "pullup_bar", label: "Pull-up bar" },
  { id: "dip_bar", label: "Dip bars" },
  { id: "bands", label: "Bands" },
  { id: "cable", label: "Cable" },
  { id: "machine", label: "Machines" },
  { id: "box", label: "Box / step" },
  { id: "rings", label: "Rings" },
  { id: "jump_rope", label: "Jump rope" },
  { id: "ab_wheel", label: "Ab wheel" },
];

const SORE_OPTIONS: Muscle[] = [
  "chest", "back", "lats", "shoulders", "biceps", "triceps",
  "quads", "hamstrings", "glutes", "calves", "core", "lower_back",
];

const INJURY_OPTIONS: InjuryArea[] = [
  "knee", "hip", "lower_back", "shoulder", "elbow", "wrist", "ankle", "neck",
];

const FOCUS_OPTIONS: Array<{ id: Focus | "auto"; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "full_body", label: "Full body" },
  { id: "upper", label: "Upper" },
  { id: "lower", label: "Lower" },
  { id: "push", label: "Push" },
  { id: "pull", label: "Pull" },
  { id: "conditioning", label: "Conditioning" },
  { id: "core", label: "Core" },
  { id: "mobility", label: "Mobility" },
];

const TIME_OPTIONS = [15, 20, 30, 45, 60, 75, 90];
const ENERGY_LABELS = ["Wrecked", "Tired", "Normal", "Good", "Great"];

interface Props {
  plan: WorkoutPlan | undefined;
  onPlan: (plan: WorkoutPlan) => void;
  onStart: (plan: WorkoutPlan) => void;
  onOpenExercise: (id: string) => void;
  resumable: ActiveSession | undefined;
  onResume: () => void;
}

export function Today({
  plan,
  onPlan,
  onStart,
  onOpenExercise,
  resumable,
  onResume,
}: Props) {
  const stored = loadSettings();
  const [equipment, setEquipment] = useState<Equipment[]>(stored.defaultEquipment);
  const [minutes, setMinutes] = useState(stored.defaultMinutes);
  const [energy, setEnergy] = useState<SessionConstraints["energy"]>(3);
  const [soreness, setSoreness] = useState<Record<string, SorenessLevel>>({});
  const [injuries, setInjuries] = useState<InjuryArea[]>(stored.standingInjuries);
  const [focus, setFocus] = useState<Focus | "auto">("auto");
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [routing, setRouting] = useState<string | undefined>();

  // Remember the kit and injuries — they rarely change between sessions.
  useEffect(() => {
    saveSettings({
      defaultEquipment: equipment,
      defaultMinutes: minutes,
      standingInjuries: injuries,
    });
  }, [equipment, minutes, injuries]);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  /** Taps cycle none → mild → moderate → severe → none. */
  const cycleSoreness = (muscle: Muscle) => {
    setSoreness((current) => {
      const next = (((current[muscle] ?? 0) + 1) % 4) as SorenessLevel;
      const updated = { ...current };
      if (next === 0) delete updated[muscle];
      else updated[muscle] = next;
      return updated;
    });
  };

  const generate = async () => {
    setLoading(true);
    setError(undefined);
    setRouting(undefined);
    try {
      const constraints: SessionConstraints = {
        equipment: equipment.length ? equipment : ["bodyweight"],
        minutes,
        energy,
        injuries,
        soreness: Object.entries(soreness).map(([muscle, level]) => ({
          muscle: muscle as Muscle,
          level,
        })),
        ...(focus === "auto" ? {} : { focus }),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const result = await api.generatePlan({ constraints });
      onPlan(result.plan);
      setRouting(result.routing);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1>Today</h1>
      <p className="sub">Tell me what you've got. I'll build the session.</p>

      {resumable && (
        <div className="banner banner--info">
          You have an unfinished session.{" "}
          <button className="btn btn--sm btn--ghost" onClick={onResume}>
            Resume
          </button>
        </div>
      )}

      <div className="field">
        <label className="field__label">Equipment</label>
        <div className="chips">
          {EQUIPMENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              className="chip"
              aria-pressed={equipment.includes(option.id)}
              onClick={() => setEquipment((c) => toggle(c, option.id))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label">Time — {minutes} min</label>
        <div className="chips">
          {TIME_OPTIONS.map((value) => (
            <button
              key={value}
              className="chip"
              aria-pressed={minutes === value}
              onClick={() => setMinutes(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="energy">
          Energy — {ENERGY_LABELS[energy - 1]}
        </label>
        <input
          id="energy"
          type="range"
          min={1}
          max={5}
          step={1}
          value={energy}
          onChange={(e) =>
            setEnergy(Number(e.target.value) as SessionConstraints["energy"])
          }
        />
      </div>

      <div className="field">
        <label className="field__label">Sore? Tap to set how bad</label>
        <div className="chips">
          {SORE_OPTIONS.map((muscle) => {
            const level = soreness[muscle] ?? 0;
            return (
              <button
                key={muscle}
                className="chip"
                aria-pressed={level > 0}
                onClick={() => cycleSoreness(muscle)}
              >
                {muscle.replace(/_/g, " ")}
                {level > 0 && ` ${"•".repeat(level)}`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label className="field__label">Injuries — nothing that loads these</label>
        <div className="chips">
          {INJURY_OPTIONS.map((area) => (
            <button
              key={area}
              className="chip chip--danger"
              aria-pressed={injuries.includes(area)}
              onClick={() => setInjuries((c) => toggle(c, area))}
            >
              {area.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label">Focus</label>
        <div className="chips">
          {FOCUS_OPTIONS.map((option) => (
            <button
              key={option.id}
              className="chip"
              aria-pressed={focus === option.id}
              onClick={() => setFocus(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="notes">
          Anything else? (asking here is what brings the AI in)
        </label>
        <textarea
          id="notes"
          value={notes}
          placeholder="e.g. shoulder felt off yesterday, go easy on pressing"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <button className="btn btn--primary" onClick={generate} disabled={loading}>
        {loading ? <span className="spinner" /> : plan ? "Rebuild session" : "Build session"}
      </button>

      {error && (
        <div className="banner banner--error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      {plan && (
        <>
          <h2>{plan.title}</h2>
          <p className="sub">{plan.summary}</p>
          {routing && <div className="banner banner--info">{routing}</div>}
          <PlanView plan={plan} onOpenExercise={onOpenExercise} />
          <button
            className="btn btn--primary"
            onClick={() => onStart(plan)}
            style={{ marginTop: 8 }}
          >
            Start session
          </button>
        </>
      )}
    </>
  );
}
