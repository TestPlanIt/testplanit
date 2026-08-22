// Unit-lane structural scaffold for PROV-06 raw-write containment,
// co-located with the shell it will guard (lib/services/linkedIssueUpsert.ts)
// so it runs inside `pnpm precommit`, the always-on gate. This is a decision
// record, not a rubber stamp — the reviewed allowlist of files permitted to
// write Issue via a raw/base client, and why each one is on it:
//
//   - lib/integrations/services/SyncService.ts — the blessed sync ingestion
//     path, where the external tracker is deliberately the source of truth
//     for locked fields, and which already carries the cross-project
//     projectId-reassignment guard (PROV-05, Phase 20).
//   - lib/services/linkedIssueUpsert.ts — the one reviewed shell every
//     non-sync write routes through (PROV-06's single containment point).
//   - app/api/issues/[issueId]/link/route.ts and
//     app/api/issues/[issueId]/unlink/route.ts — resolve their client
//     through getEnhancedDb, so the field-level requirement-lock deny
//     predicate already applies to them, and they write relation connects
//     rather than locked columns directly.
//   - app/api/projects/[projectId]/requirements/[issueId]/reparent/route.ts
//     (Phase 25) — resolves its client through getEnhancedDb before writing
//     parentId. parentId IS one of LOCKED_ISSUE_FIELDS, so unlike the two
//     entries above this write relies on the schema's field-level @deny for
//     real enforcement: a synced, non-detached requirement's reparent is
//     rejected by policy and the route maps that rejection to a 403, never
//     silently applied. assertValidReparent (Node-only, called beforehand
//     against baseDb) is the separate structural-validity guard (same
//     project, no cycle); this enhanced-client write is the field-lock
//     layer underneath it.
//   - app/api/projects/[projectId]/requirements/[issueId]/detach/route.ts
//     (Phase 25) — resolves its client through getEnhancedDb; writes only
//     requirementDetachedAt, which is deliberately NOT one of
//     LOCKED_ISSUE_FIELDS, so this write is the same shape as link/unlink's
//     relation-connect writes above -- it never touches a locked column,
//     and never writes integrationId (the Jira-reference badge depends on
//     it surviving detach).
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/linkedIssueUpsert.containment.test.ts

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Reviewed allowlist — the only files permitted to call `issue.update(...)`
// or `issue.upsert(...)` directly against a raw/base client. Rationale for
// each entry lives in the header comment above.
const ALLOWED_FILES = [
  "lib/integrations/services/SyncService.ts",
  "lib/services/linkedIssueUpsert.ts",
  "app/api/issues/[issueId]/link/route.ts",
  "app/api/issues/[issueId]/unlink/route.ts",
  "app/api/projects/[projectId]/requirements/[issueId]/reparent/route.ts",
  "app/api/projects/[projectId]/requirements/[issueId]/detach/route.ts",
];

// Test fixtures legitimately write issues directly — never subject to the
// allowlist gate.
const TEST_PATH_MARKERS = ["__tests__/", ".test.ts", ".spec.ts", "e2e/"];

function isTestPath(filePath: string): boolean {
  return TEST_PATH_MARKERS.some((marker) => filePath.includes(marker));
}

interface GrepHit {
  file: string;
  line: string;
}

/**
 * Run `git grep -nE <pattern>` scoped to tracked *.ts/*.tsx files from
 * process.cwd() (vitest runs with cwd = testplanit/, so relative pathspecs
 * stay inside this package). git grep exits 1 when there are no matches —
 * that is a valid empty result, not a real failure, so it is caught here
 * rather than allowed to throw.
 */
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

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("Issue raw-write containment (PROV-06, structural)", () => {
  it("no file outside the reviewed allowlist calls issue.update or issue.upsert", () => {
    const hits = gitGrep(String.raw`\.issue\.(update|upsert)\(`).filter(
      (hit) => !isTestPath(hit.file)
    );
    const offenders = hits.filter((hit) => !ALLOWED_FILES.includes(hit.file));

    if (offenders.length > 0) {
      const offenderList = offenders
        .map((hit) => `${hit.file}:${hit.line}`)
        .join(", ");
      throw new Error(
        `Found raw Issue write(s) outside the reviewed allowlist: ${offenderList}. ` +
          "Route the write through upsertLinkedIssueShell (lib/services/linkedIssueUpsert.ts), " +
          "or add the file to ALLOWED_FILES here with a written reason after review."
      );
    }
    expect(offenders).toEqual([]);

    // Narrower updateMany check. The pattern above has a trailing open-paren
    // that deliberately excludes updateMany (a separate, data-blob-only
    // shape) — without this second assertion that exclusion would be a
    // silent blind spot for a future raw updateMany write.
    const updateManyHits = gitGrep(String.raw`\.issue\.updateMany\(`).filter(
      (hit) => !isTestPath(hit.file)
    );
    const updateManyFiles = new Set(updateManyHits.map((hit) => hit.file));
    // lib/services/jira-link-service.ts is exempt on both of its call sites,
    // for the same reason: neither writes a locked column. syncJiraIssueData
    // writes only the `data` JSON blob, and the orphaned-shell cleanup the
    // unlink paths share writes only `isDeleted` — that cleanup is a bulk
    // write rather than a single-row one precisely so its defect-role scope
    // predicate is re-evaluated by the database inside the write itself.
    expect(updateManyFiles).toEqual(
      new Set(["lib/services/jira-link-service.ts"])
    );
    // Hit count, not just file set: a new bulk write inside an
    // already-exempt file must still land in front of a reviewer.
    expect(updateManyHits.length).toBe(2);
  });

  it("jira-link-service routes every issue upsert through the shared shell", () => {
    const content = readFileSync("lib/services/jira-link-service.ts", "utf8");
    expect(countOccurrences(content, "upsertLinkedIssueShell(")).toBe(6);
    expect(countOccurrences(content, "baseDb.issue.upsert(")).toBe(0);
  });

  it("the create-issue routes and the test-case importer route through the shared shell", () => {
    const files = [
      "app/api/integrations/jira/create/route.ts",
      "app/api/integrations/[id]/create-issue/route.ts",
      "lib/services/testCaseImport.ts",
    ];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(countOccurrences(content, "upsertLinkedIssueShell(")).toBe(1);
      expect(countOccurrences(content, "issue.upsert(")).toBe(0);
    }
  });
});
