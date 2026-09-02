/**
 * Runtime configuration.
 *
 * This module is deliberately free of Node built-ins so it can be imported by
 * the Cloudflare Worker as well. Values come from a plain string map — on Node
 * that is `process.env` (after `loadEnvFile` has populated it), on Workers it
 * is the request's `env` bindings.
 */

export type ProviderName = "anthropic" | "gemini";

export interface Config {
  authToken: string;
  allowNoAuth: boolean;
  corsOrigins: string[];

  provider: ProviderName;
  anthropicApiKey: string;
  /**
   * Required for identity-linked API keys, which are scoped to a workspace and
   * reject every request without it. Console → Settings → Workspaces; the id
   * is in the URL and starts with "wrkspc_". Leave blank for a normal key.
   */
  anthropicWorkspaceId: string;
  geminiApiKey: string;

  model: string;
  geminiModel: string;
  planEffort: string;
  chatEffort: string;

  /** Rolling 30-day ceiling in USD. 0 disables the cap. */
  monthlyBudgetUsd: number;
  /** How long an identical plan request is reused from cache, in minutes. */
  planCacheTtlMin: number;
  /** False routes every session through the model — testing only. */
  plannerFirst: boolean;

  /** Node only; ignored on Workers, where D1 is the store. */
  dbPath: string;
}

export type EnvSource = Record<string, string | undefined>;

function num(source: EnvSource, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(source: EnvSource, name: string, fallback: boolean): boolean {
  const raw = source[name];
  if (raw === undefined || raw === "") return fallback;
  return raw !== "false";
}

export function resolveConfig(source: EnvSource): Config {
  return {
    authToken: source["AUTH_TOKEN"] ?? "",
    allowNoAuth: source["ALLOW_NO_AUTH"] === "true",
    corsOrigins: (source["CORS_ORIGINS"] ?? "*").split(",").map((s) => s.trim()),

    provider: (source["AI_PROVIDER"] ?? "anthropic") as ProviderName,
    anthropicApiKey: source["ANTHROPIC_API_KEY"] ?? "",
    anthropicWorkspaceId: source["ANTHROPIC_WORKSPACE_ID"] ?? "",
    geminiApiKey: source["GEMINI_API_KEY"] ?? "",

    model: source["AI_MODEL"] ?? "claude-opus-5",
    geminiModel: source["GEMINI_MODEL"] ?? "gemini-2.5-flash",
    planEffort: source["AI_PLAN_EFFORT"] ?? "low",
    chatEffort: source["AI_CHAT_EFFORT"] ?? "low",

    monthlyBudgetUsd: num(source, "AI_MONTHLY_BUDGET_USD", 5),
    planCacheTtlMin: num(source, "PLAN_CACHE_TTL_MIN", 720),
    plannerFirst: bool(source, "PLANNER_FIRST", true),

    dbPath: source["DB_PATH"] ?? "data/fitness.sqlite",
  };
}

/** True when the configured provider has a usable key. */
export function aiAvailable(config: Config): boolean {
  return config.provider === "gemini"
    ? Boolean(config.geminiApiKey)
    : Boolean(config.anthropicApiKey);
}

export function activeModel(config: Config): string {
  return config.provider === "gemini" ? config.geminiModel : config.model;
}

/**
 * Throws when the server would start in an unsafe or unusable state. `envPath`
 * is only for the error text — it names the file the operator should edit.
 */
export function assertConfig(config: Config, envPath?: string): void {
  if (!config.authToken && !config.allowNoAuth) {
    throw new Error(
      envPath
        ? `AUTH_TOKEN is empty in ${envPath}. Set it to any long random ` +
          "string, or set ALLOW_NO_AUTH=true if this server is only ever " +
          "reachable from localhost."
        : "AUTH_TOKEN is not set. Set it to any long random string (on " +
          "Cloudflare: `wrangler secret put AUTH_TOKEN`), or set " +
          "ALLOW_NO_AUTH=true for a localhost-only server.",
    );
  }
}
