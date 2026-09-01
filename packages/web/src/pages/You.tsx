import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import type { ServerSettings, UsageSummaryResponse } from "../lib/api.js";
import { loadSettings, saveSettings } from "../lib/storage.js";

export function You() {
  const stored = loadSettings();
  const [serverUrl, setServerUrl] = useState(stored.serverUrl);
  const [token, setToken] = useState(stored.token);
  const [cues, setCues] = useState(stored.cues);
  const [standingNotes, setStandingNotes] = useState("");

  const [server, setServer] = useState<ServerSettings | undefined>();
  const [usage, setUsage] = useState<UsageSummaryResponse | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const refresh = () => {
    setError(undefined);
    Promise.all([api.settings(), api.usage()])
      .then(([s, u]) => {
        setServer(s);
        setUsage(u);
        setStandingNotes(s.standingNotes.join("\n"));
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(refresh, []);

  const saveConnection = () => {
    saveSettings({ serverUrl: serverUrl.trim(), token: token.trim(), cues });
    setStatus("Saved. Checking…");
    api
      .health()
      .then(() => {
        setStatus("Connected.");
        refresh();
      })
      .catch((e: Error) => setStatus(e.message));
  };

  const saveNotes = async () => {
    const lines = standingNotes
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    try {
      await api.saveSettings({ standingNotes: lines });
      setStatus("Standing notes saved.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const budgetUsed = usage && usage.budgetUsd > 0 ? usage.totalCostUsd / usage.budgetUsd : 0;
  const saved = usage ? usage.costWithoutCachingUsd - usage.totalCostUsd : 0;

  return (
    <>
      <h1>You</h1>
      <p className="sub">Connection, coach memory, and what the AI is costing.</p>

      {error && <div className="banner banner--error">{error}</div>}
      {status && <div className="banner banner--info">{status}</div>}

      <h2>Connection</h2>
      <div className="card">
        <div className="field">
          <label className="field__label" htmlFor="url">
            Server address
          </label>
          <input
            id="url"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="http://192.168.1.20:8080"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
          />
          <p className="faint" style={{ marginTop: 6 }}>
            Leave blank if this page is served by the server itself.
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="token">
            Access token
          </label>
          <input
            id="token"
            type="password"
            autoCapitalize="off"
            autoCorrect="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>

        <div className="field">
          <button
            className="chip"
            aria-pressed={cues}
            onClick={() => setCues((c) => !c)}
            style={{ width: "100%" }}
          >
            {cues ? "Sound & vibration on" : "Sound & vibration off"}
          </button>
        </div>

        <button className="btn btn--primary" onClick={saveConnection}>
          Save & test
        </button>
      </div>

      <h2>Coach memory</h2>
      <div className="card">
        <p className="faint" style={{ marginTop: 0 }}>
          Facts the coach should always know — one per line. These go into every
          plan, so keep them short.
        </p>
        <textarea
          value={standingNotes}
          placeholder={"left shoulder impingement since 2024\ntraining for a half marathon in May"}
          onChange={(e) => setStandingNotes(e.target.value)}
        />
        <button className="btn" onClick={saveNotes} style={{ marginTop: 10 }}>
          Save notes
        </button>
      </div>

      <h2>AI usage</h2>
      {usage && server ? (
        <div className="card">
          <div className="stat">
            <span>Provider</span>
            <span className="stat__value">
              {server.provider} · {server.model}
            </span>
          </div>
          <div className="stat">
            <span>Spent (30 days)</span>
            <span className="stat__value">${usage.totalCostUsd.toFixed(3)}</span>
          </div>
          {usage.budgetUsd > 0 && (
            <>
              <div className="stat">
                <span>Budget</span>
                <span className="stat__value">${usage.budgetUsd.toFixed(2)}</span>
              </div>
              <div className="bar">
                <div
                  className={`bar__fill${budgetUsed > 0.8 ? " bar__fill--warn" : ""}`}
                  style={{ width: `${Math.min(100, budgetUsed * 100)}%` }}
                />
              </div>
            </>
          )}
          <div className="stat">
            <span>AI calls</span>
            <span className="stat__value">{usage.callCount}</span>
          </div>
          <div className="stat">
            <span>Sessions with no AI call</span>
            <span className="stat__value">{usage.plannerOnlyCount}</span>
          </div>
          <div className="stat">
            <span>Prompt cache hit rate</span>
            <span className="stat__value">{(usage.cacheHitRate * 100).toFixed(0)}%</span>
          </div>
          {saved > 0.0005 && (
            <div className="stat">
              <span>Saved by caching</span>
              <span className="stat__value trend--up">${saved.toFixed(3)}</span>
            </div>
          )}

          {!server.aiAvailable && (
            <div className="banner banner--warn" style={{ marginTop: 12 }}>
              No API key on the server. Sessions still work — they're built by
              the planner — but chat is off.
            </div>
          )}

          {usage.recent.length > 0 && (
            <>
              <h3 style={{ marginTop: 18 }}>Recent calls</h3>
              {usage.recent.slice(0, 8).map((record) => (
                <div className="stat" key={record.id}>
                  <span className="faint">
                    {record.purpose} ·{" "}
                    {new Date(record.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                  <span className="mono faint">
                    {record.inputTokens + record.cachedInputTokens}in/
                    {record.outputTokens}out · ${record.costUsd.toFixed(4)}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <p className="muted">
          <span className="spinner" /> Loading…
        </p>
      )}
    </>
  );
}
