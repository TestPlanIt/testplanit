import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Static backstop: every report-builder route handler must be exported
 * through withReplicaRoute() so its reads can be offloaded to a read replica.
 *
 * The routes are POST-heavy (filters travel in the body), so the automatic
 * GET offload in the model route never applies to them; the explicit wrap is
 * the only thing that keeps report reads off the primary. It was lost once
 * when the single report-builder route was split into per-report routes.
 */

const ROUTE_ROOT = path.join("app", "api", "report-builder");
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

function* routeFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* routeFiles(full);
    } else if (entry.name === "route.ts") {
      yield full;
    }
  }
}

describe("report-builder routes", () => {
  const files = [...routeFiles(ROUTE_ROOT)];

  it("are found", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("export every handler through withReplicaRoute()", () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      const rel = path.relative(process.cwd(), file);

      if (!source.includes('from "~/lib/db/replicaRoute"')) {
        violations.push(`${rel}: does not import withReplicaRoute`);
      }

      for (const method of HTTP_METHODS) {
        const bare = new RegExp(
          `^export\\s+(async\\s+)?function\\s+${method}\\b`,
          "m"
        );
        if (bare.test(source)) {
          violations.push(`${rel}: bare \`export function ${method}\``);
        }
        const assigned = new RegExp(
          `^export\\s+const\\s+${method}\\s*=\\s*(.*)$`,
          "m"
        );
        const match = assigned.exec(source);
        if (match && !match[1].startsWith("withReplicaRoute(")) {
          violations.push(`${rel}: \`export const ${method}\` not wrapped`);
        }
      }

      if (!/^export const (GET|POST) = withReplicaRoute\(/m.test(source)) {
        violations.push(`${rel}: no wrapped GET/POST export`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});
