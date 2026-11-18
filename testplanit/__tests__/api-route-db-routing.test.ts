import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Read-replica routing only works for a handler that runs inside a routing
 * frame, and a write only pins the browser's next reads to the primary when
 * the frame saw it. Both come from wrapping the route's exports
 * (lib/db/requestRouting.ts), so an unwrapped export is a silent gap: its
 * reads never offload and its writes never set the stickiness cookie.
 */

const API_ROOT = path.join(process.cwd(), "app", "api");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
const WRAPPERS = [
  "withRequestRouting",
  "withPrimaryRequestRouting",
  // Report routes: every eligible read goes to a replica.
  "withReplicaRoute",
];

// The generic data route opens its own frame for all five methods.
const OWN_FRAME = new Set([path.join("model", "[...path]", "route.ts")]);

function routeFiles(): string[] {
  return (fs.readdirSync(API_ROOT, { recursive: true }) as string[]).filter(
    (rel) => path.basename(rel) === "route.ts" && !OWN_FRAME.has(rel)
  );
}

describe("API routes run inside a database routing frame", () => {
  it("wraps every exported method handler", () => {
    const unwrapped: string[] = [];
    for (const rel of routeFiles()) {
      const content = fs.readFileSync(path.join(API_ROOT, rel), "utf8");
      for (const method of METHODS) {
        const declared = new RegExp(
          `^export\\s+(?:async\\s+function\\s+${method}\\b|const\\s+${method}\\s*=\\s*([A-Za-z0-9_]*))`,
          "m"
        ).exec(content);
        if (!declared) continue;
        if (!declared[1] || !WRAPPERS.includes(declared[1])) {
          unwrapped.push(`app/api/${rel}: ${method}`);
        }
      }
    }
    expect(
      unwrapped,
      "Export each handler as `export const GET = withRequestRouting(handleGET)`"
    ).toEqual([]);
  });

  it("finds the routes it is meant to check", () => {
    expect(routeFiles().length).toBeGreaterThan(300);
  });
});
