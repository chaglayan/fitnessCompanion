import type { Equipment, InjuryArea } from "@fc/shared";

export interface LocalSettings {
  /** Empty means same origin — used when the server serves the built PWA. */
  serverUrl: string;
  token: string;
  defaultEquipment: Equipment[];
  defaultMinutes: number;
  standingInjuries: InjuryArea[];
  /** Play a sound and vibrate when a countdown finishes. */
  cues: boolean;
}

const KEY = "fc.settings.v1";

const DEFAULTS: LocalSettings = {
  serverUrl: "",
  token: "",
  defaultEquipment: ["bodyweight"],
  defaultMinutes: 45,
  standingInjuries: [],
  cues: true,
};

/**
 * Storage can throw outright in private browsing modes, so every read and
 * write is guarded and falls back to defaults rather than breaking the app.
 */
export function loadSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(patch: Partial<LocalSettings>): LocalSettings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do — the app still works for this session.
  }
  return next;
}

/* --------------------- in-progress session recovery -------------------- */

const SESSION_KEY = "fc.activeSession.v1";

export function saveActiveSession<T>(state: T): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function loadActiveSession<T>(): T | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function clearActiveSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
