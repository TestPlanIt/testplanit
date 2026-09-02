// Structural gate: a query must decide what a result MEANS from the Status
// row's three boolean flags — isSuccess, isFailure, isCompleted — never from
// its name or systemName. Modelled on the read-side containment gate next
// door (issueRoleScope.containment.test.ts): a repo-wide structural search
// over tracked source, an allowlist carrying a written reason per entry, and
// a throw with an actionable message before the final assertion.
//
// WHY THIS EXISTS. Statuses are an admin-configurable, per-project model, not
// a fixed enum. A name check only ever recognises the seeded rows, so an
// admin-defined status is classified by accident. That was live, not
// theoretical: `latestTestResults.ts` filtered `systemName NOT IN ('untested',
// 'skipped')`, so a status named "Unnamed" (systemName `status7`, all three
// flags false) stood as a case's latest result on the repository list — 54
// recorded results, 39 cases — while a Skipped result, which at least
// completed, was correctly walked past.
//
// THE COMMENT-TEXT TRAP, inherited from the sibling gate: `git grep` cannot
// tell code from comment, so a gate whose own prose reproduces the substring
// it greps for reports itself as a violation. The forbidden shape appears in
// this file ONLY inside the String.raw pattern below. Every other mention
// here describes it in prose.
//
// SCOPE. This gate covers status SEMANTICS — deciding pass/fail/complete. It
// deliberately does NOT forbid every mention of the column: reading it for
// display, sync mapping, or filtering by a status a user explicitly picked is
// legitimate. The allowlist below separates the two, and each entry says
// which it is.

import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

interface GrepHit {
  file: string;
  line: string;
}

function gitGrep(pattern: string): GrepHit[] {
  let raw = "";
  try {
    raw = execSync(`git grep -nE '${pattern}' -- '*.ts' '*.tsx'`, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const execError = error as { stdout?: string };
    raw = execError.stdout ?? "";
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^(.+?):(\d+):/.exec(line);
      return match
        ? { file: match[1], line: match[2] }
        : { file: line, line: "?" };
    });
}

const TEST_PATH_MARKERS = ["__tests__/", ".test.ts", ".test.tsx", "e2e/"];

function isTestPath(filePath: string): boolean {
  return TEST_PATH_MARKERS.some((marker) => filePath.includes(marker));
}

/**
 * Every file still deciding something from a status's system name, with the
 * reason it is allowed to. Removing an entry is the point of the exercise;
 * adding one needs a reason that survives review.
 */
const REVIEWED: Record<string, string> = {
  "lib/services/milestoneMemberCoverage.ts":
    "Excludes the seeded default so a case merely ADDED to a run is not counted as executed. This is the 'has anything happened' question, and the flags cannot express it: untested and blocked are both (false,false,false). Needs a product decision, tracked separately -- do not convert blindly.",
  "lib/services/requirementCoverage.ts":
    "Same 'exclude the seeded default' question as milestoneMemberCoverage, in the covering-case count. Same flag ambiguity, same pending decision.",
  "utils/resultUnion.ts":
    "Same 'exclude the seeded default' question, applied to the unified result feed.",
  "utils/reportUtils.ts":
    "Same 'exclude the seeded default' question inside a report query.",
  "utils/drillDownQueryBuilders.ts":
    "Same 'exclude the seeded default' question inside a drill-down query.",
  "utils/executionLogUtils.ts":
    "Same 'exclude the seeded default' question inside the execution-log query.",
  "app/api/milestones/[milestoneId]/export/route.ts":
    "Same 'exclude the seeded default' question inside the milestone export.",
  "lib/services/runCaseStatusSync.ts":
    "Reads systemName to MAP a status, not to classify a result. No verdict is inferred here.",
};

describe("status semantics come from the flags, never from a name", () => {
  it("finds the forbidden shape when it exists (pattern self-test)", () => {
    // Guards against the failure mode where a typo'd pattern matches nothing
    // and the gate reports a false "clean".
    // POSIX ERE: git grep -E has no \s, so character classes are spelled out.
    const hits = gitGrep(
      String.raw`"systemName"[[:space:]]*(NOT[[:space:]]+IN|IN|<>|=)`
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("no unreviewed query classifies a result by its status name", () => {
    const hits = gitGrep(
      String.raw`[a-z]+\."systemName"|status:[[:space:]]*\{[[:space:]]*systemName`
    );

    const unreviewed = hits.filter((hit) => {
      if (isTestPath(hit.file)) return false;
      return !Object.keys(REVIEWED).some((allowed) =>
        hit.file.endsWith(allowed)
      );
    });

    if (unreviewed.length > 0) {
      throw new Error(
        [
          "A query is deciding what a result means from its status NAME.",
          "Statuses are admin-configurable, so a name check only recognises the seeded rows.",
          "Use the Status flags instead:",
          "  carries a verdict   -> isSuccess = true OR isFailure = true",
          "  reached a conclusion -> isCompleted = true",
          "If the check genuinely cannot be expressed in flags, add the file to",
          "REVIEWED in this file with the reason.",
          "",
          ...unreviewed.map((hit) => `  ${hit.file}:${hit.line}`),
        ].join("\n")
      );
    }

    expect(unreviewed).toEqual([]);
  });

  it("the latest-result services decide from the flags", () => {
    const flagged = gitGrep(
      String.raw`isSuccess"[[:space:]]*=[[:space:]]*true[[:space:]]*OR`
    ).map((hit) => hit.file);

    expect(flagged).toContain("lib/services/latestTestResults.ts");
    expect(flagged).toContain("utils/testCaseHealthUtils.ts");
  });
});
