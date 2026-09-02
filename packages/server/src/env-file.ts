/**
 * Node-only .env loading. Kept out of config.ts so that module stays
 * importable from the Cloudflare Worker, which has no filesystem.
 */
import fs from "node:fs";
import path from "node:path";

export interface ProjectRoot {
  dir: string;
  envFile: string | undefined;
}

/**
 * Finds the nearest .env by walking up from the working directory.
 *
 * `npm start` runs the workspace script with the cwd set to packages/server,
 * so looking only in the cwd would miss the .env at the repo root — which is
 * where the setup instructions put it. Returns the directory holding the file
 * so relative paths in it resolve against the same place.
 */
export function findProjectRoot(from: string = process.cwd()): ProjectRoot {
  let dir = path.resolve(from);
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return { dir, envFile: candidate };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No .env above us: fall back to the workspace root so DB_PATH still lands
  // somewhere predictable.
  let walk = path.resolve(from);
  for (let depth = 0; depth < 6; depth++) {
    const pkg = path.join(walk, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, "utf8")) as { workspaces?: unknown };
        if (parsed.workspaces) return { dir: walk, envFile: undefined };
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

/** Populates process.env from a .env file without overwriting real env vars. */
export function loadEnvFile(file: string): void {
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
