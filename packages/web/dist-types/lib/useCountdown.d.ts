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
export declare function useCountdown(onFinish?: () => void): Countdown;
export declare function playCue(): void;
/** Unlocks audio on the first tap so later cues are allowed to make sound. */
export declare function primeAudio(): void;
/** Keeps the screen awake during a session, where supported. */
export declare function useWakeLock(active: boolean): void;
//# sourceMappingURL=useCountdown.d.ts.map