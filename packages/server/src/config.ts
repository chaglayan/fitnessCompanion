import fs from "node:fs";
import path from "node:path";

/**
 * Finds the nearest .env by walking up from the working directory.
 *
 * `npm start` runs the workspace script with the cwd set to packages/server,
 * so looking only in the cwd would miss the .env at the repo root — which is
 * where the setup instructions put it. Returns the directory holding the
 * file, so relative paths in it resolve against the same place.
 */
function findProjectRoot(from: string): { dir: string; envFile: string | undefined } {
  let dir = path.resolve(from);
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return { dir, envFile: candidate };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No .env anywhere above us: fall back to the workspace root if we can see
  // one, so DB_PATH still lands somewhere predictable.
  let walk = path.resolve(from);
  for (let depth = 0; depth < 6; depth++) {
    if (fs.existsSync(path.join(walk, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(walk, "package.json"), "utf8")) as {
          workspaces?: unknown;
        };
        if (pkg.workspaces) return { dir: walk, envFile: undefined };
      } catch {
        // Unreadable package.json — keep walking.
      }
    }
    const parent = path.dirname(walk);
    if (parent === walk) break;
    walk = parent;
  }
  return { dir: path.resolve(from), envFile: undefined };
}

const projectRoot = findProjectRoot(process.cwd());

/** Minimal .env loader — avoids a dependency for a single-user server. */
function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

if (projectRoot.envFile) loadDotEnv(projectRoot.envFile);

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type ProviderName = "anthropic" | "gemini";

export const config = {
  port: num("PORT", 8080),
  host: process.env.HOST ?? "0.0.0.0",

  /**
   * Shared secret both your laptop and phone send as `Authorization: Bearer`.
   * The server refuses to start without it unless explicitly opted out, so a
   * box exposed to the internet is never unauthenticated by accident.
   */
  authToken: process.env.AUTH_TOKEN ?? "",
  allowNoAuth: process.env.ALLOW_NO_AUTH === "true",

  /** Relative paths resolve against the project root, not the launch cwd. */
  dbPath: path.resolve(projectRoot.dir, process.env.DB_PATH ?? "data/fitness.sqlite"),

  /** Origins allowed to call the API. "*" is fine on a LAN-only box. */
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),

  provider: (process.env.AI_PROVIDER ?? "anthropic") as ProviderName,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  /**
   * Required for identity-linked API keys, which are scoped to a workspace and
   * reject every request without it. Console → Settings → Workspaces; the id
   * is in the URL and starts with "wrkspc_". Leave blank for a normal key.
   */
  anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",

  /**
   * Model used for planning and chat. Kept configurable so you can trade cost
   * against quality without touching code.
   */
  model: process.env.AI_MODEL ?? "claude-opus-5",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",

  /**
   * Effort caps thinking depth. Planning is structured and well-specified, so
   * "low" is usually enough; raise it if plans feel shallow.
   */
  planEffort: process.env.AI_PLAN_EFFORT ?? "low",
  chatEffort: process.env.AI_CHAT_EFFORT ?? "low",

  /**
   * Hard monthly ceiling. When the rolling 30-day spend crosses this, AI calls
   * stop and every request falls back to the deterministic planner rather
   * than failing. Set to 0 to disable the cap.
   */
  monthlyBudgetUsd: num("AI_MONTHLY_BUDGET_USD", 5),

  /** How long an identical plan request is served from cache, in minutes. */
  planCacheTtlMin: num("PLAN_CACHE_TTL_MIN", 720),

  /** Set false to make every plan go through the model (useful for testing). */
  plannerFirst: process.env.PLANNER_FIRST !== "false",
} as const;

export function assertConfig(): void {
  if (!config.authToken && !config.allowNoAuth) {
    throw new Error(
      projectRoot.envFile
        ? `AUTH_TOKEN is empty in ${projectRoot.envFile}. Set it to any long ` +
          "random string, or set ALLOW_NO_AUTH=true if this server is only " +
          "ever reachable from localhost."
        : `No .env file found (looked upward from ${process.cwd()}). Run ` +
          "`cp .env.example .env` in the project root and set AUTH_TOKEN.",
    );
  }
  if (config.provider === "anthropic" && !config.anthropicApiKey) {
    console.warn(
      "[config] ANTHROPIC_API_KEY is not set — AI features are disabled and " +
        "all sessions will be built by the deterministic planner.",
    );
  }
  if (config.provider === "gemini" && !config.geminiApiKey) {
    console.warn(
      "[config] GEMINI_API_KEY is not set — AI features are disabled and " +
        "all sessions will be built by the deterministic planner.",
    );
  }
}
