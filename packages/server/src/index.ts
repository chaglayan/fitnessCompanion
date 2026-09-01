import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { assertConfig, config } from "./config.js";
import { api } from "./routes/api.js";
import { refreshDigest } from "./ai/digest.js";

assertConfig();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: config.provider });
});

/**
 * Single shared secret, sent by both the laptop and the phone. Compared with a
 * length-independent scan so a wrong token cannot be recovered by timing.
 */
function authenticate(req: Request, res: Response, next: NextFunction): void {
  if (config.allowNoAuth) {
    next();
    return;
  }
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, config.authToken)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

app.use("/api", authenticate, api);

// Serve the built PWA when it exists, so one process serves both.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
} else {
  console.warn(
    `[server] No web build at ${webDist} — run "npm run build" to serve the PWA from this process.`,
  );
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server]", error);
  res.status(500).json({ error: "Internal error." });
});

// Warm the digest so the first plan request does not pay to build it.
try {
  refreshDigest();
} catch (error) {
  console.warn("[server] Could not build the training digest at startup:", error);
}

app.listen(config.port, config.host, () => {
  console.log(
    `[server] Fitness companion listening on http://${config.host}:${config.port}`,
  );
  console.log(`[server] Provider: ${config.provider} (${config.model})`);
  console.log(
    `[server] AI budget: ${config.monthlyBudgetUsd > 0 ? `$${config.monthlyBudgetUsd}/30d` : "unlimited"}`,
  );
  if (config.allowNoAuth) {
    console.warn("[server] ALLOW_NO_AUTH is on — do not expose this port to the internet.");
  }
});
