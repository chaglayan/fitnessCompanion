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
/**
 * Storage can throw outright in private browsing modes, so every read and
 * write is guarded and falls back to defaults rather than breaking the app.
 */
export declare function loadSettings(): LocalSettings;
export declare function saveSettings(patch: Partial<LocalSettings>): LocalSettings;
export declare function saveActiveSession<T>(state: T): void;
export declare function loadActiveSession<T>(): T | undefined;
export declare function clearActiveSession(): void;
//# sourceMappingURL=storage.d.ts.map