/**
 * Phase 1 carry-forward (Plan 01-02 must_haves T-02-04):
 *
 * Every TestCaseParameter mutation site MUST invoke `updateHasParameters`
 * within the same `$transaction` so the denormalized
 * `RepositoryCases.hasParameters` flag stays in sync.
 *
 * This is a static-analysis test: it greps every `tx.testCaseParameter.{create|update}`
 * call site under `app/` and `lib/` and asserts that the next 30 lines
 * contain `updateHasParameters(`. Sites in the helper module
 * (`parameterMutations.ts`) are exempt because the helper itself is
 * the single canonical invocation site (the helpers MUST themselves
 * call `updateHasParameters`, which is verified separately).
 *
 * Phase 2 introduces all current sites; future phases MUST extend this
 * test or refactor through the helpers when adding new mutation paths.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const SCAN_TARGETS = ["app", "lib"].map((d) => resolve(ROOT, d));

interface Hit {
  file: string;
  line: number;
}

function findMutationSites(): Hit[] {
  // Use grep -n to enumerate every tx.testCaseParameter.{create,update} site.
  // Returns lines like:
  //   app/api/.../route.ts:42:    await tx.testCaseParameter.update({
  const cmd =
    `grep -rn -E "tx\\.testCaseParameter\\.(create|update)\\(" ` +
    SCAN_TARGETS.map((s) => `'${s}'`).join(" ") +
    ` --include='*.ts' --include='*.tsx' || true`;
  const out = execSync(cmd, { encoding: "utf-8" });
  if (!out.trim()) return [];
  return out
    .trim()
    .split("\n")
    .map((line) => {
      const m = line.match(/^(.*?):(\d+):/);
      if (!m) return null;
      return { file: m[1], line: Number(m[2]) };
    })
    .filter((x): x is Hit => x !== null);
}

const HELPER_FILE = resolve(ROOT, "lib", "services", "parameterMutations.ts");
const TEST_DIR_MARKER = `${ROOT}/__tests__`;
const SERVICE_TEST_DIR_MARKER = "/__tests__/";

function isExemptFile(file: string): boolean {
  if (file === HELPER_FILE) return true;
  if (file.startsWith(TEST_DIR_MARKER)) return true;
  if (file.includes(SERVICE_TEST_DIR_MARKER)) return true;
  // Co-located test files (e.g. `route.integration.test.ts` next to a
  // route) are also exempt — they exercise mutation paths through fixtures
  // that don't represent production code.
  if (/\.(test|spec|integration\.test)\.(t|j)sx?$/.test(file)) return true;
  return false;
}

function hasUpdateHasParametersWithin(file: string, lineNumber: number, window = 30): boolean {
  const content = readFileSync(file, "utf-8").split("\n");
  const start = Math.max(0, lineNumber - 1);
  const end = Math.min(content.length, lineNumber - 1 + window);
  for (let i = start; i < end; i++) {
    if (content[i].includes("updateHasParameters(")) return true;
  }
  return false;
}

describe("PARAM coverage — updateHasParameters must follow every TestCaseParameter mutation site", () => {
  it("every non-helper, non-test mutation site is followed by updateHasParameters within 30 lines", () => {
    const hits = findMutationSites();
    const offenders: Hit[] = [];
    for (const h of hits) {
      if (isExemptFile(h.file)) continue;
      if (!hasUpdateHasParametersWithin(h.file, h.line)) {
        offenders.push(h);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the helper module itself invokes updateHasParameters at every mutation site", () => {
    // The helper file is exempt from the global scan above. This test
    // confirms the helper still complies with the invariant: every
    // tx.testCaseParameter.{create,update} call inside the helper has
    // updateHasParameters within 30 lines.
    const content = readFileSync(HELPER_FILE, "utf-8").split("\n");
    const offenders: number[] = [];
    for (let i = 0; i < content.length; i++) {
      if (/tx\.testCaseParameter\.(create|update)\(/.test(content[i])) {
        const window = content
          .slice(i, Math.min(content.length, i + 30))
          .join("\n");
        if (!window.includes("updateHasParameters(")) {
          offenders.push(i + 1);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no hard delete on TestCaseParameter anywhere in app/ or lib/", () => {
    const cmd =
      `grep -rn -E "tx\\.testCaseParameter\\.delete\\(" ` +
      SCAN_TARGETS.map((s) => `'${s}'`).join(" ") +
      ` --include='*.ts' --include='*.tsx' || true`;
    const out = execSync(cmd, { encoding: "utf-8" });
    const lines = out
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .filter((l) => {
        const file = l.split(":")[0];
        // exclude tests
        return !file.includes("/__tests__/") && !file.startsWith(TEST_DIR_MARKER);
      });
    expect(lines).toEqual([]);
  });
});
