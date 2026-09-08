#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";

import { createRawDbClient } from "~/lib/rawDbClient";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";

/**
 * backfillAutomatedVersions.ts — repair the manual→automated transitions that
 * were never snapshotted.
 *
 * Automation Trends does not read `RepositoryCases.automated`. It reconstructs
 * each case's automated state as of every period from that case's
 * `RepositoryCaseVersions` timeline (`utils/automationTrendsUtils.ts`,
 * `automatedStateAt`). Several paths used to flip the flag on the case row
 * without writing a version snapshot:
 *
 *   - app/api/test-runs/submit-result/route.ts   (automated run result on a
 *     manual case — the high-volume one; fixed)
 *   - workers/testmoImport/automationImports.ts  (match-existing branch; fixed)
 *   - scripts/linkAutomatedToManual.ts, scripts/cleanupLegacyCCases.ts
 *     (one-off maintenance, already run)
 *
 * A case flipped by any of those keeps a version snapshot saying
 * `automated: false`, so the report counts it as MANUAL forever — which is why
 * the Web project read 33 automated instead of 2,316.
 *
 * This script writes the missing snapshot. It does NOT invent timestamps: the
 * `AuditLog` recorded every false→true flip (`changes.automated`), so each
 * backfilled version is dated at the moment the flip actually happened. Cases
 * with no audit evidence are reported and skipped, never guessed at.
 *
 * Idempotent: a case whose latest version already says `automated: true` is
 * not a candidate, so re-running is a no-op.
 *
 * Usage:
 *   tsx scripts/backfillAutomatedVersions.ts             # dry run (default)
 *   tsx scripts/backfillAutomatedVersions.ts --apply     # write
 *   tsx scripts/backfillAutomatedVersions.ts --project 9 # scope to one project
 */

const db = createRawDbClient();
const APPLY = process.argv.includes("--apply");
const projectArgIndex = process.argv.indexOf("--project");
const PROJECT_FILTER =
  projectArgIndex >= 0 ? Number(process.argv[projectArgIndex + 1]) : null;

interface Candidate {
  id: number;
  projectId: number;
  projectName: string;
  currentVersion: number;
  latestVersionAt: Date;
  flippedAt: Date;
  /** Audit actor, when it resolves to a real User row; else null. */
  actorId: string | null;
  actorName: string | null;
  /** True when the audit timestamp predates the latest snapshot and was clamped. */
  clamped: boolean;
}

async function main(): Promise<void> {
  console.log(APPLY ? "Mode: APPLY" : "Mode: DRY RUN — no writes.");
  if (PROJECT_FILTER != null) console.log(`Scope: project ${PROJECT_FILTER}`);

  // Candidates: currently automated, but the newest version snapshot says
  // manual. Cases with NO version rows are deliberately excluded — the report
  // already falls back to the live flag for those, and inventing a version 1
  // for them is a different repair.
  const rows = await db.$queryRaw<
    Array<{
      id: number;
      projectId: number;
      projectName: string;
      currentVersion: number;
      latestVersionAt: Date;
      flippedAt: Date | null;
      actorId: string | null;
      actorName: string | null;
    }>
  >`
    SELECT c.id,
           c."projectId",
           p.name                AS "projectName",
           c."currentVersion",
           v."createdAt"         AS "latestVersionAt",
           a."flippedAt",
           a."actorId",
           a."actorName"
    FROM "RepositoryCases" c
    JOIN "Projects" p ON p.id = c."projectId"
    JOIN LATERAL (
      SELECT rv.automated, rv."createdAt"
      FROM "RepositoryCaseVersions" rv
      WHERE rv."repositoryCaseId" = c.id
      ORDER BY rv.version DESC
      LIMIT 1
    ) v ON TRUE
    LEFT JOIN LATERAL (
      -- LAST flip, not the first. 988 cases were flipped automated on
      -- 2026-07-04, silently reverted to manual by the 2026-07-06 Testmo
      -- re-import (reverts are NOT audited — only false→true is), then
      -- re-flipped 07-24..07-30. Dating those from the first flip would
      -- report them automated across the weeks they were actually manual.
      -- The most recent false→true is the event that established the state
      -- the case is in now, which is what this snapshot represents.
      SELECT MAX(al.timestamp)                                        AS "flippedAt",
             (ARRAY_AGG(u.id     ORDER BY al.timestamp DESC))[1]      AS "actorId",
             (ARRAY_AGG(al."userName" ORDER BY al.timestamp DESC))[1] AS "actorName"
      FROM "AuditLog" al
      LEFT JOIN "User" u ON u.id = al."userId"
      WHERE al."entityType" = 'RepositoryCases'
        AND al.action = 'UPDATE'
        AND al."entityId" = c.id::text
        AND al.changes -> 'automated' ->> 'new' = 'true'
    ) a ON TRUE
    WHERE c."isDeleted" = false
      AND c.automated = true
      AND v.automated = false
      AND (${PROJECT_FILTER}::int IS NULL OR c."projectId" = ${PROJECT_FILTER}::int)
    ORDER BY c."projectId", c.id
  `;

  const candidates: Candidate[] = [];
  const noEvidence: number[] = [];

  for (const r of rows) {
    if (!r.flippedAt) {
      noEvidence.push(r.id);
      continue;
    }
    // The flip cannot predate the snapshot it supersedes. If the audit clock
    // says otherwise, pin it to the existing snapshot so the timeline stays
    // monotonic — `automatedStateAt` walks it in timestamp order.
    const latestVersionAt = new Date(r.latestVersionAt);
    const auditAt = new Date(r.flippedAt);
    const clamped = auditAt < latestVersionAt;
    candidates.push({
      id: r.id,
      projectId: r.projectId,
      projectName: r.projectName,
      currentVersion: r.currentVersion,
      latestVersionAt,
      flippedAt: clamped ? latestVersionAt : auditAt,
      actorId: r.actorId,
      actorName: r.actorName,
      clamped,
    });
  }

  console.log("\n=== BACKFILL PLAN ===");
  console.log(
    `Cases missing an automated snapshot: ${rows.length.toLocaleString()}`
  );
  console.log(
    `  with audit evidence (will fix):    ${candidates.length.toLocaleString()}`
  );
  console.log(
    `  no audit evidence (SKIPPED):       ${noEvidence.length.toLocaleString()}`
  );
  if (noEvidence.length) {
    console.log(
      `    ids: ${noEvidence.slice(0, 20).join(", ")}${noEvidence.length > 20 ? " …" : ""}`
    );
  }
  const clampedCount = candidates.filter((c) => c.clamped).length;
  if (clampedCount) {
    console.log(
      `  audit timestamp clamped forward:   ${clampedCount.toLocaleString()}`
    );
  }

  const byProject = new Map<string, number>();
  for (const c of candidates)
    byProject.set(c.projectName, (byProject.get(c.projectName) ?? 0) + 1);
  console.log("\nPer project:");
  for (const [name, n] of [...byProject.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${name.padEnd(28)} ${n.toLocaleString()}`);

  const byDay = new Map<string, number>();
  for (const c of candidates) {
    const d = c.flippedAt.toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  console.log("\nSnapshots will be dated (from AuditLog):");
  for (const [d, n] of [...byDay.entries()].sort())
    console.log(`  ${d}  ${n.toLocaleString()}`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    return;
  }

  // Every row this script writes is recorded so the run can be undone exactly,
  // rather than inferred back out of the version table afterwards.
  const undo: Array<{ caseId: number; versionId: number }> = [];
  // Written outside the repo so a prod run does not leave an untracked file in
  // the working tree. Override with UNDO_PATH.
  const undoPath =
    process.env.UNDO_PATH ??
    `${process.env.HOME ?? "."}/backfillAutomatedVersions.undo.json`;

  let done = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await db.$transaction(async (tx: any) => {
        // Bump first: the version service snapshots the row as it stands in
        // this transaction and matches the new currentVersion.
        await tx.repositoryCases.update({
          where: { id: c.id },
          data: { currentVersion: { increment: 1 } },
        });
        const created = await createTestCaseVersionInTransaction(tx, c.id, {
          createdAt: c.flippedAt,
          // Attribute to the account that performed the flip when it still
          // exists (e.g. the Jenkins service user); otherwise let the service
          // fall back to the case's original creator. `__system__` script
          // actors are not User rows and would violate the creatorId FK.
          ...(c.actorId
            ? { creatorId: c.actorId, creatorName: c.actorName ?? "" }
            : {}),
          // No `overrides.automated`: the case row already reads true, and the
          // service snapshots it — along with current steps/tags/issues/params.
        });
        undo.push({ caseId: c.id, versionId: created.id });
      });
      done += 1;
      if (done % 500 === 0) {
        // Flush as we go so a crash mid-run still leaves an undo trail.
        writeFileSync(undoPath, JSON.stringify(undo, null, 2));
        console.log(`  …backfilled ${done}/${candidates.length}`);
      }
    } catch (e) {
      failed += 1;
      console.error(
        `  case ${c.id} FAILED:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  writeFileSync(undoPath, JSON.stringify(undo, null, 2));
  console.log(
    `\nDone. Backfilled ${done.toLocaleString()} versions, ${failed} failed.`
  );
  console.log(
    `Undo trail written to ${undoPath} (${undo.length.toLocaleString()} rows).`
  );
  if (done)
    console.log(
      "Automation Trends reads the DB directly — no Elasticsearch reindex needed."
    );
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
