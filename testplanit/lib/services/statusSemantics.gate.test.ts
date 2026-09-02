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
//
// THE ONE SAFE NAME. `untested` is seeded and users cannot change it, so
// naming it is guaranteed — and it is the only way to identify it, since the
// flags cannot separate untested from blocked (both are all-false). Every
// other systemName is admin-editable and must never be used to infer meaning.

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
  // These ask a different question: "exclude the seeded default so a case
  // merely ADDED to a run is not counted as executed." `untested` is the one
  // systemName that IS guaranteed -- it is seeded and users cannot change it
  // (the admin Statuses screen disables edit, delete and enable on that row:
  // app/[locale]/admin/statuses/columns.tsx and EditStatus.tsx). It is also
  // the only way to identify it: the flags cannot separate untested from
  // blocked, since both are (false, false, false). So naming it here is
  // correct, not a shortcut. No other systemName carries that guarantee.
  "lib/services/milestoneMemberCoverage.ts":
    "Excludes the seeded, non-editable default from milestone member coverage.",
  "lib/services/requirementCoverage.ts":
    "Excludes the seeded, non-editable default from the covering-case rollup.",
  "utils/resultUnion.ts":
    "Excludes the seeded, non-editable default from the unified result feed.",
  "utils/reportUtils.ts":
    "Excludes the seeded, non-editable default from a report query.",
  "utils/drillDownQueryBuilders.ts":
    "Excludes the seeded, non-editable default from a drill-down query.",
  "utils/executionLogUtils.ts":
    "Excludes the seeded, non-editable default from the execution log.",
  "app/api/milestones/[milestoneId]/export/route.ts":
    "Excludes the seeded, non-editable default from the milestone export.",
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
