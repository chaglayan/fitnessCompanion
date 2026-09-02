import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApi } from "./app.js";
import { assertConfig, resolveConfig } from "./config.js";
import { findProjectRoot, loadEnvFile } from "./env-file.js";
import { createSqliteStore } from "./store/sqlite.js";
import { refreshDigest } from "./ai/digest.js";
import type { Deps } from "./ai/coach.js";

/**
 * Node entry point — local development and self-hosting. The Cloudflare
 * deployment uses packages/worker, which mounts the same `createApi`.
 */
const projectRoot = findProjectRoot();
if (projectRoot.envFile) loadEnvFile(projectRoot.envFile);

const config = resolveConfig(process.env);
assertConfig(config, projectRoot.envFile);

// Relative DB paths resolve against the project root, not the launch cwd —
// `npm start` runs this with the cwd set to packages/server.
const dbPath = path.resolve(projectRoot.dir, config.dbPath);
const store = createSqliteStore(dbPath);
const deps: Deps = { store, config };

const app = createApi(() => deps);

// Serve the built PWA from the same process, so one origin serves both.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");

if (fs.existsSync(webDist)) {
  const root = path.relative(process.cwd(), webDist) || ".";
  app.use("/*", serveStatic({ root }));
  // Client-side routing: anything not matched falls back to the shell.
  app.get("*", (c) => {
    const html = fs.readFileSync(path.join(webDist, "index.html"), "utf8");
    return c.html(html);
  });
} else {
  console.warn(
    `[server] No web build at ${webDist} — run "npm run build" to serve the PWA from this process.`,
  );
}

const port = Number(process.env["PORT"] ?? 8080);
const hostname = process.env["HOST"] ?? "0.0.0.0";

// Warm the digest so the first plan request does not pay to build it.
refreshDigest(store).catch((error: unknown) => {
  console.warn("[server] Could not build the training digest at startup:", error);
});

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[server] Fitness companion listening on http://${hostname}:${info.port}`);
  console.log(`[server] Provider: ${config.provider} (${config.model})`);
  console.log(`[server] Database: ${dbPath}`);
  console.log(
    `[server] AI budget: ${config.monthlyBudgetUsd > 0 ? `$${config.monthlyBudgetUsd}/30d` : "unlimited"}`,
  );
  if (config.allowNoAuth) {
    console.warn("[server] ALLOW_NO_AUTH is on — do not expose this port to the internet.");
  }
});
