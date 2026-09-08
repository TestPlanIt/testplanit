import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Static backstop: server-side zod schemas must not declare bare `z.any()` /
 * `z.unknown()` object properties.
 *
 * Server actions and JSON bodies delete undefined-valued keys in transit
 * (React's flight deserializer and JSON.stringify both drop them), so an
 * unset client value arrives as a MISSING key — and zod 4.4+ rejects a
 * missing key on a bare `z.any()`/`z.unknown()` property with
 * "Invalid input: expected nonoptional, received undefined".
 * Declare such properties as `z.any().optional()` / `z.unknown().optional()`.
 *
 * Scope is server-side code only; client-side form schemas parse in-memory
 * objects where the key is present, so they are not scanned.
 */

const SCAN_ROOTS = ["app/api", "app/actions", "lib", "server", "workers"];

// lib/hooks is the ZenStack tanstack-query output directory (generated).
const EXCLUDED_DIRS = new Set([path.normalize("lib/hooks")]);

// Matches an object property whose schema is a bare z.any()/z.unknown(),
// e.g. `value: z.any(),` — but not record/array value positions like
// `z.record(z.string(), z.any())`, where the call is not preceded by `:`.
const BARE_ANY_PROPERTY = /:\s*z\.(any|unknown)\(\)\s*(,|$)/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(path.normalize(path.relative(process.cwd(), full))))
        continue;
      yield* sourceFiles(full);
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield full;
    }
  }
}

describe("server-boundary zod schemas", () => {
  it("declare z.any()/z.unknown() object properties as .optional()", () => {
    const violations: string[] = [];

    for (const root of SCAN_ROOTS) {
      if (!fs.existsSync(root)) continue;
      for (const file of sourceFiles(root)) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (BARE_ANY_PROPERTY.test(line)) {
            violations.push(
              `${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`
            );
          }
        });
      }
    }

    expect(
      violations,
      `Bare z.any()/z.unknown() object properties in server-side schemas ` +
        `reject unset client values (wire formats drop undefined-valued keys; ` +
        `zod 4.4+ then fails on the missing key). Add .optional():\n` +
        violations.join("\n")
    ).toEqual([]);
  });
});
