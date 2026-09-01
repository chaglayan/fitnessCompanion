import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A countdown that stays correct when the phone sleeps.
 *
 * iOS throttles or suspends timers in a backgrounded tab, so counting down by
 * decrementing on an interval drifts badly — lock the screen for a minute of
 * rest and you come back to a timer that barely moved. This tracks a wall-clock
 * deadline instead and derives the remaining time on every tick, so the
 * interval only drives repaints and its accuracy does not matter.
 */
export interface Countdown {
  /** Whole seconds left, never negative. */
  remaining: number;
  running: boolean;
  /** True from the moment it reaches zero until it is reset. */
  finished: boolean;
  start: (seconds: number) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Adds (or with a negative value, removes) seconds mid-countdown. */
  adjust: (seconds: number) => void;
}

export function useCountdown(onFinish?: () => void): Countdown {
  const [deadline, setDeadline] = useState<number | undefined>();
  const [pausedAt, setPausedAt] = useState<number | undefined>();
  const [remaining, setRemaining] = useState(0);
  const [finished, setFinished] = useState(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const compute = useCallback(
    (now: number) => {
      if (deadline === undefined) return 0;
      const end = pausedAt !== undefined ? deadline - (Date.now() - pausedAt) : deadline;
      return Math.max(0, Math.ceil((end - now) / 1000));
    },
    [deadline, pausedAt],
  );

  useEffect(() => {
    if (deadline === undefined || pausedAt !== undefined) return;

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setDeadline(undefined);
        setFinished(true);
        finishRef.current?.();
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    // Recompute the instant the tab is foregrounded again, so the number is
    // right before the next interval fires.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [deadline, pausedAt]);

  const start = useCallback((seconds: number) => {
    setFinished(false);
    setPausedAt(undefined);
    setRemaining(seconds);
    setDeadline(Date.now() + seconds * 1000);
  }, []);

  const pause = useCallback(() => {
    if (deadline === undefined || pausedAt !== undefined) return;
    setPausedAt(Date.now());
    setRemaining(compute(Date.now()));
  }, [deadline, pausedAt, compute]);

  const resume = useCallback(() => {
    if (pausedAt === undefined || deadline === undefined) return;
    setDeadline(deadline + (Date.now() - pausedAt));
    setPausedAt(undefined);
  }, [pausedAt, deadline]);

  const stop = useCallback(() => {
    setDeadline(undefined);
    setPausedAt(undefined);
    setRemaining(0);
    setFinished(false);
  }, []);

  const adjust = useCallback((seconds: number) => {
    setDeadline((current) =>
      current === undefined ? current : Math.max(Date.now(), current + seconds * 1000),
    );
  }, []);

  return {
    remaining,
    running: deadline !== undefined && pausedAt === undefined,
    finished,
    start,
    pause,
    resume,
    stop,
    adjust,
  };
}

/**
 * Beeps and buzzes when a timer ends. Web Audio is used rather than an audio
 * file so there is nothing to load, and it is created lazily because iOS only
 * allows an AudioContext to start from a user gesture.
 */
let audioContext: AudioContext | undefined;

export function playCue(): void {
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* not supported */
  }
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();

    const now = audioContext.currentTime;
    for (const [index, frequency] of [880, 1174].entries()) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      const at = now + index * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    }
  } catch {
    /* audio unavailable */
  }
}

/** Unlocks audio on the first tap so later cues are allowed to make sound. */
export function primeAudio(): void {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    /* ignore */
  }
}

/** Keeps the screen awake during a session, where supported. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | undefined;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        /* denied or unsupported */
      }
    };

    void acquire();
    // iOS drops the lock whenever the tab is backgrounded; take it again.
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
