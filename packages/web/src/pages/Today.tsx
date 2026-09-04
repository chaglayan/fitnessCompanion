import { useEffect, useState } from "react";
import type {
  Equipment,
  Experience,
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

const EXPERIENCE_OPTIONS: Array<{ id: Experience; label: string; hint: string }> = [
  { id: "beginner", label: "Beginner", hint: "Easier variations, more in reserve" },
  { id: "intermediate", label: "Intermediate", hint: "Middle of the rep range" },
  { id: "advanced", label: "Advanced", hint: "Harder variations, closer to failure" },
];

type QuickOp = "harder" | "easier" | "shorter" | "longer" | "more_variety";

/** Deterministic tweaks the planner can make on its own, at no cost. */
const QUICK_ADJUSTMENTS: Array<{ op: QuickOp; label: string }> = [
  { op: "harder", label: "Harder" },
  { op: "easier", label: "Easier" },
  { op: "longer", label: "+15 min" },
  { op: "shorter", label: "−15 min" },
  { op: "more_variety", label: "Different exercises" },
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
  /** Result of a swap or removal made from the exercise sheet. */
  adjustNote?: string;
}

export function Today({
  plan,
  onPlan,
  onStart,
  onOpenExercise,
  resumable,
  onResume,
  adjustNote,
}: Props) {
  const stored = loadSettings();
  const [equipment, setEquipment] = useState<Equipment[]>(stored.defaultEquipment);
  const [minutes, setMinutes] = useState(stored.defaultMinutes);
  const [energy, setEnergy] = useState<SessionConstraints["energy"]>(3);
  const [soreness, setSoreness] = useState<Record<string, SorenessLevel>>({});
  const [injuries, setInjuries] = useState<InjuryArea[]>(stored.standingInjuries);
  const [focus, setFocus] = useState<Focus | "auto">("auto");
  const [experience, setExperience] = useState<Experience>(stored.experience);
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  /** Which quick adjustment is in flight, if any. */
  const [adjusting, setAdjusting] = useState<QuickOp | undefined>();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [routing, setRouting] = useState<string | undefined>();

  // Remember the kit and injuries — they rarely change between sessions.
  useEffect(() => {
    saveSettings({
      defaultEquipment: equipment,
      defaultMinutes: minutes,
      standingInjuries: injuries,
      experience,
    });
  }, [equipment, minutes, injuries, experience]);

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
        experience,
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

  const adjust = async (op: QuickOp) => {
    if (!plan) return;
    setAdjusting(op);
    setError(undefined);
    try {
      const result = await api.adjustPlan(plan.id, { op });
      onPlan(result.plan);
      setRouting(result.routing);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdjusting(undefined);
    }
  };

  const revise = async () => {
    if (!plan || !feedback.trim()) return;
    setRevising(true);
    setError(undefined);
    try {
      const result = await api.revisePlan(plan.id, feedback.trim());
      onPlan(result.plan);
      setRouting(
        result.rejected?.length
          ? `${result.routing} Couldn't do: ${result.rejected.join(" ")}`
          : result.routing,
      );
      setFeedback("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRevising(false);
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
        <label className="field__label">How hard should this be?</label>
        <div className="chips">
          {EXPERIENCE_OPTIONS.map((option) => (
            <button
              key={option.id}
              className="chip"
              aria-pressed={experience === option.id}
              onClick={() => setExperience(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 6 }}>
          {EXPERIENCE_OPTIONS.find((o) => o.id === experience)?.hint}
        </p>
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
          {(adjustNote ?? routing) && (
            <div className="banner banner--info">{adjustNote ?? routing}</div>
          )}
          <PlanView plan={plan} onOpenExercise={onOpenExercise} />

          <div className="card" style={{ marginTop: 14 }}>
            <label className="field__label">Quick changes — instant and free</label>
            <div className="chips">
              {QUICK_ADJUSTMENTS.map((option) => (
                <button
                  key={option.op}
                  className="chip"
                  disabled={adjusting !== undefined}
                  onClick={() => void adjust(option.op)}
                >
                  {adjusting === option.op ? <span className="spinner" /> : option.label}
                </button>
              ))}
            </div>
            <p className="faint" style={{ marginTop: 8, marginBottom: 0 }}>
              To change one exercise, tap it above — you can swap or remove it
              from there. Also free.
            </p>
          </div>

          <div className="card">
            <label className="field__label" htmlFor="feedback">
              Detailed feedback — ask the AI
            </label>
            <textarea
              id="feedback"
              value={feedback}
              placeholder={
                "e.g. my left shoulder has been pinching on anything overhead " +
                "for two weeks, but it's fine on horizontal pressing — keep the " +
                "volume but work around it, and give me something for the rotator " +
                "cuff at the end"
              }
              onChange={(e) => setFeedback(e.target.value)}
              style={{ minHeight: 110 }}
            />
            <button
              className="btn"
              disabled={revising || !feedback.trim()}
              style={{ marginTop: 8 }}
              onClick={() => void revise()}
            >
              {revising ? <span className="spinner" /> : "Apply changes"}
            </button>
            <p className="faint" style={{ marginTop: 8, marginBottom: 0 }}>
              For anything the buttons above can't express — reasoning about
              your shoulder, restructuring the session, specific lifts. Costs
              about half a cent.
            </p>
          </div>

          <button
            className="btn btn--primary"
            onClick={() => onStart(plan)}
            style={{ marginTop: 12 }}
          >
            Start session
          </button>
        </>
      )}
    </>
  );
}
