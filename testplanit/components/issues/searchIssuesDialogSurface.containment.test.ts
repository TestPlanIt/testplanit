// Unit-lane structural gate for the SearchIssuesDialog consumer surface
// (27.1-03, WR-01 + WR-06), co-located with the dialogs it guards so it
// runs inside `pnpm precommit`, the always-on unit lane. Same technique as
// lib/services/linkedIssueUpsert.containment.test.ts and
// lib/services/issueRoleScope.containment.test.ts: a repo-wide structural
// search over tracked source, a reviewed allowlist with a written reason
// per entry, a throw-with-actionable-message before the final assertion.
//
// WR-01 half: `<SearchIssuesDialog` widened (commit 2f2f92bd6) to offer an
// Internal-issues source chip whenever an integration is active. Two of
// its four consumers wrap `onIssueSelected` in `if (issue.isExternal)`
// with no else branch — before the widening that guard was dead defensive
// code, after it a reachable dead end (a click that silently drops the
// pick). The fix hides the chip for those two consumers via
// `allowInternalPicks={false}`. This gate keeps the consumer set closed:
// a fifth mount has to be triaged (does its onIssueSelected handle an
// internal pick, or does it need the prop too?) rather than silently
// inheriting whichever default happens to apply.
//
// WR-06 half: both `search-issues-dialog.tsx` and its fork
// `requirement-reference-search-dialog.tsx` open tracker-result URLs via
// `window.open(url, "_blank")`, which — unlike `<a target="_blank">` —
// hands the opened page a live `window.opener` (reverse tab-nabbing).
// Both files' results-list open has been hardened to pass
// `"noopener,noreferrer"`. Both files ALSO define their own
// `handleAuthenticate`, which opens the shared OAuth landing page
// (`/integrations/auth-complete`, see lib/integrations/oauthPopup.ts) in a
// popup that posts its completion back via `window.opener.postMessage(...)`
// — hardening either of those two call sites would silently break
// re-search-after-authenticate in whichever dialog it was applied to. Both
// are therefore documented, load-bearing exceptions — not just the
// origin's, contrary to what an earlier read of this fix's spec assumed
// before the fork's own handleAuthenticate was found at implementation
// time (see the SUMMARY's deviation note).
//
// THE COMMENT-TEXT TRAP (this file's own hazard, same as the precedents
// above): `git grep` and plain substring search cannot tell code from
// comment. Every forbidden/reviewed shape in this file's prose above is
// described without reproducing the literal token sequences the checks
// below search for, so this file cannot match its own gates.
//
// Run via:
//   cd testplanit && pnpm exec vitest run components/issues/searchIssuesDialogSurface.containment.test.ts

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface GrepHit {
  file: string;
  line: string;
}

/**
 * Run `git grep -nE <pattern>` scoped to tracked *.tsx files from
 * process.cwd() (vitest runs with cwd = testplanit/, so relative pathspecs
 * stay inside this package). git grep exits 1 when there are no matches --
 * that is a valid empty result, not a real failure, so it is caught here
 * rather than allowed to throw.
 */
function gitGrep(pattern: string): GrepHit[] {
  let raw = "";
  try {
    raw = execSync(`git grep -nE '${pattern}' -- '*.tsx'`, {
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

const TEST_PATH_MARKERS = [
  "__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  "e2e/",
];

function isTestPath(filePath: string): boolean {
  return TEST_PATH_MARKERS.some((marker) => filePath.includes(marker));
}

/**
 * Strips `//` line comments so a token that only appears in an explanatory
 * comment (e.g. this file's own prose, or a "do NOT do this" note in a
 * production file) is never mistaken for the real, load-bearing shape.
 * Safe for the specific files this gate reads: confirmed none of them
 * contain a "://" substring that a naive `//`-search would misfire on.
 */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

// The four (and only four) reviewed production mounts of
// <SearchIssuesDialog>, confirmed by `git grep -l "<SearchIssuesDialog"`
// against this file's own gate below.
const EXPECTED_CONSUMERS = [
  "app/[locale]/projects/repository/[projectId]/GenerateTestCasesWizard.tsx",
  "components/issues/DeferredIssueManager.tsx",
  "components/issues/ManageExternalIssues.tsx",
  "components/issues/MilestoneIssueManager.tsx",
].sort();

// onIssueSelected wraps its body in `if (issue.isExternal) { ... }` with no
// else -- an internal pick is a silent no-op. Opted out via
// allowInternalPicks={false} (WR-01 fix).
const DEAD_END_CONSUMERS = [
  "app/[locale]/projects/repository/[projectId]/GenerateTestCasesWizard.tsx",
  "components/issues/ManageExternalIssues.tsx",
];

// onIssueSelected handles both an internal AND an external pick --
// unaffected by the WR-01 fix, must carry no allowInternalPicks override.
const HANDLES_BOTH_CONSUMERS = [
  "components/issues/DeferredIssueManager.tsx",
  "components/issues/MilestoneIssueManager.tsx",
];

describe("WR-01: SearchIssuesDialog consumer surface is a reviewed, closed set", () => {
  it("mounts <SearchIssuesDialog exactly at the four reviewed consumer files", () => {
    const hits = gitGrep(String.raw`<SearchIssuesDialog`);
    const files = Array.from(
      new Set(hits.map((hit) => hit.file).filter((file) => !isTestPath(file)))
    ).sort();

    if (
      files.length !== EXPECTED_CONSUMERS.length ||
      files.some((file) => !EXPECTED_CONSUMERS.includes(file))
    ) {
      throw new Error(
        `<SearchIssuesDialog> consumer set changed. Found: ${files.join(", ")}. ` +
          `Expected exactly: ${EXPECTED_CONSUMERS.join(", ")}. ` +
          "A new mount must be triaged: does its onIssueSelected handle an " +
          "internal pick? If not, add allowInternalPicks={false}. Then add " +
          "it to EXPECTED_CONSUMERS (and DEAD_END_CONSUMERS or " +
          "HANDLES_BOTH_CONSUMERS below) with a written reason."
      );
    }
    expect(files).toEqual(EXPECTED_CONSUMERS);
  });

  it("the two dead-end consumers opt out via allowInternalPicks={false}", () => {
    for (const file of DEAD_END_CONSUMERS) {
      const content = stripLineComments(readFileSync(file, "utf8"));
      expect(content.includes("allowInternalPicks={false}")).toBe(true);
    }
  });

  it("the two consumers that handle internal picks carry no allowInternalPicks override", () => {
    for (const file of HANDLES_BOTH_CONSUMERS) {
      const content = stripLineComments(readFileSync(file, "utf8"));
      expect(content.includes("allowInternalPicks")).toBe(false);
    }
  });
});
