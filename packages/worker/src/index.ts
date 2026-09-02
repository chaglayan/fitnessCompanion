import { createApi } from "@fc/server/app";
import { resolveConfig } from "@fc/server/config";
import { createD1Store } from "@fc/server/store/d1";
import type { Deps } from "@fc/server/ai/coach";

/**
 * Cloudflare Worker entry point.
 *
 * Bindings come from wrangler.toml (vars) and `wrangler secret put` (secrets);
 * both arrive on `env`, which is why config is resolved per request rather
 * than read from a module-level singleton at import time.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  AUTH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  GEMINI_API_KEY?: string;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  GEMINI_MODEL?: string;
  AI_PLAN_EFFORT?: string;
  AI_CHAT_EFFORT?: string;
  AI_MONTHLY_BUDGET_USD?: string;
  PLAN_CACHE_TTL_MIN?: string;
  PLANNER_FIRST?: string;
  CORS_ORIGINS?: string;
  ALLOW_NO_AUTH?: string;
}

/**
 * Isolates are reused across requests, so the store and config are cached per
 * `env` identity rather than rebuilt on every call. A different env (a new
 * deployment) simply produces a new entry.
 */
const cache = new WeakMap<object, Deps>();

function depsFor(env: Env): Deps {
  const existing = cache.get(env as unknown as object);
  if (existing) return existing;

  const deps: Deps = {
    config: resolveConfig(env as unknown as Record<string, string | undefined>),
    store: createD1Store(env.DB),
  };
  cache.set(env as unknown as object, deps);
  return deps;
}

const api = createApi((c) => depsFor((c as { env: Env }).env));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Everything under /api is the shared Hono app; everything else is the
    // static PWA, served by Workers Assets.
    if (url.pathname.startsWith("/api")) {
      return api.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
