import { sql } from "kysely";
import type { DbClient, TxClient } from "~/lib/zenstack";
import { fingerprintFailure } from "./fingerprint";

/**
 * Groups automated failures into FailureSignature rows.
 *
 * Every FAILURE/ERROR `JUnitTestResult` without a signature is fingerprinted
 * and attached to the signature with the same fingerprint in its project
 * (created on first sight). Counters and the flaky-candidate flag are then
 * recomputed from the attached results, so they stay correct across
 * backfills, re-imports and result deletions.
 */

export type TriageDb = DbClient | TxClient;

export const TRIAGE_BATCH_SIZE = 500;
/** Verdicts per case considered for the flaky heuristic. */
export const FLAKY_HISTORY_WINDOW = 10;
/** Pass/fail transitions within the window that make a case flaky. */
export const FLAKY_MIN_FLIPS = 2;
/** Share of a signature's cases that must be flaky for the signature to be a candidate. */
export const FLAKY_CASE_SHARE = 0.5;

export interface UntriagedFailureRow {
  id: number;
  message: string | null;
  content: string | null;
  systemErr: string | null;
  repositoryCaseId: number;
  executedAt: Date | null;
  createdAt: Date;
  repositoryCase: { name: string } | null;
}

export interface TriageBatchResult {
  /** Results that received a signature in this pass */
  processed: number;
  /** Every signature touched (created, reopened or extended) */
  signatureIds: number[];
  newSignatureIds: number[];
  reopenedSignatureIds: number[];
}

const emptyResult = (): TriageBatchResult => ({
  processed: 0,
  signatureIds: [],
  newSignatureIds: [],
  reopenedSignatureIds: [],
});

function mergeResults(into: TriageBatchResult, add: TriageBatchResult) {
  into.processed += add.processed;
  for (const key of [
    "signatureIds",
    "newSignatureIds",
    "reopenedSignatureIds",
  ] as const) {
    for (const id of add[key]) if (!into[key].includes(id)) into[key].push(id);
  }
}

const UNTRIAGED_SELECT = {
  id: true,
  message: true,
  content: true,
  systemErr: true,
  repositoryCaseId: true,
  executedAt: true,
  createdAt: true,
  repositoryCase: { select: { name: true } },
} as const;

/** Attach signatures to every untriaged failure of one run. */
export async function triageRunFailures(
  db: TriageDb,
  params: { testRunId: number; projectId: number }
): Promise<TriageBatchResult> {
  const total = emptyResult();
  for (;;) {
    const rows = (await db.jUnitTestResult.findMany({
      where: {
        testSuite: { testRunId: params.testRunId },
        type: { in: ["FAILURE", "ERROR"] },
        failureSignatureId: null,
      },
      select: UNTRIAGED_SELECT,
      orderBy: { id: "asc" },
      take: TRIAGE_BATCH_SIZE,
    })) as UntriagedFailureRow[];
    if (rows.length === 0) break;
    mergeResults(total, await assignSignatures(db, params.projectId, rows));
    if (rows.length < TRIAGE_BATCH_SIZE) break;
  }
  return total;
}

/** Attach signatures to every untriaged failure of a project (backfill). */
export async function triageProjectFailures(
  db: TriageDb,
  params: {
    projectId: number;
    onBatch?: (progress: { processed: number }) => Promise<void> | void;
  }
): Promise<TriageBatchResult> {
  const total = emptyResult();
  for (;;) {
    const rows = (await db.jUnitTestResult.findMany({
      where: {
        repositoryCase: { projectId: params.projectId },
        type: { in: ["FAILURE", "ERROR"] },
        failureSignatureId: null,
      },
      select: UNTRIAGED_SELECT,
      orderBy: { id: "asc" },
      take: TRIAGE_BATCH_SIZE,
    })) as UntriagedFailureRow[];
    if (rows.length === 0) break;
    mergeResults(total, await assignSignatures(db, params.projectId, rows));
    await params.onBatch?.({ processed: total.processed });
    if (rows.length < TRIAGE_BATCH_SIZE) break;
  }
  return total;
}

/** Pure grouping step, exported for tests. */
export function groupByFingerprint(rows: UntriagedFailureRow[]) {
  const groups = new Map<
    string,
    {
      fingerprint: ReturnType<typeof fingerprintFailure>;
      rows: UntriagedFailureRow[];
      firstSeenAt: Date;
      lastSeenAt: Date;
    }
  >();
  for (const row of rows) {
    const fp = fingerprintFailure(row);
    const seenAt = row.executedAt ?? row.createdAt;
    const group = groups.get(fp.fingerprint);
    if (group) {
      group.rows.push(row);
      if (seenAt < group.firstSeenAt) group.firstSeenAt = seenAt;
      if (seenAt > group.lastSeenAt) group.lastSeenAt = seenAt;
    } else {
      groups.set(fp.fingerprint, {
        fingerprint: fp,
        rows: [row],
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      });
    }
  }
  return groups;
}

/** A signature with no diagnostic text is named after its case. */
export function signatureTitle(
  fp: ReturnType<typeof fingerprintFailure>,
  rows: UntriagedFailureRow[]
): string {
  if (fp.title) return fp.title;
  return (
    rows[0]?.repositoryCase?.name ??
    `Case ${rows[0]?.repositoryCaseId ?? ""}`.trim()
  );
}

async function assignSignatures(
  db: TriageDb,
  projectId: number,
  rows: UntriagedFailureRow[]
): Promise<TriageBatchResult> {
  const result = emptyResult();
  const groups = groupByFingerprint(rows);

  for (const group of groups.values()) {
    const fp = group.fingerprint;
    const existing = await db.failureSignature.findUnique({
      where: {
        projectId_fingerprint: { projectId, fingerprint: fp.fingerprint },
      },
      select: { id: true, status: true, firstSeenAt: true, lastSeenAt: true },
    });

    let signatureId: number;
    if (!existing) {
      const created = await db.failureSignature.create({
        data: {
          projectId,
          fingerprint: fp.fingerprint,
          kind: fp.kind.toUpperCase() as "STACK" | "MESSAGE" | "NONE",
          title: signatureTitle(fp, group.rows),
          exceptionType: fp.exceptionType,
          normalizedMessage: fp.normalizedMessage || null,
          frames: fp.frames,
          firstSeenAt: group.firstSeenAt,
          lastSeenAt: group.lastSeenAt,
        },
        select: { id: true },
      });
      signatureId = created.id;
      result.newSignatureIds.push(signatureId);
    } else {
      signatureId = existing.id;
      const reopen =
        existing.status === "RESOLVED" &&
        group.lastSeenAt > existing.lastSeenAt;
      await db.failureSignature.update({
        where: { id: signatureId },
        data: {
          firstSeenAt:
            group.firstSeenAt < existing.firstSeenAt
              ? group.firstSeenAt
              : undefined,
          lastSeenAt:
            group.lastSeenAt > existing.lastSeenAt
              ? group.lastSeenAt
              : undefined,
          ...(reopen
            ? { status: "OPEN", resolvedAt: null, resolvedById: null }
            : {}),
        },
      });
      if (reopen) result.reopenedSignatureIds.push(signatureId);
    }

    await db.jUnitTestResult.updateMany({
      where: { id: { in: group.rows.map((r) => r.id) } },
      data: { failureSignatureId: signatureId },
    });
    result.signatureIds.push(signatureId);
    result.processed += group.rows.length;
  }

  if (result.signatureIds.length > 0) {
    await recomputeSignatureStats(db, result.signatureIds);
  }
  return result;
}

/**
 * Recomputes occurrence / case / run counters and the flaky-candidate flag
 * from the results currently attached to each signature.
 */
export async function recomputeSignatureStats(
  db: TriageDb,
  signatureIds: number[]
): Promise<void> {
  if (signatureIds.length === 0) return;
  await sql`
    UPDATE "FailureSignature" fs
    SET "occurrenceCount" = s.occurrences,
        "caseCount" = s.cases,
        "runCount" = s.runs
    FROM (
      SELECT r."failureSignatureId" AS sid,
             COUNT(*)::int AS occurrences,
             COUNT(DISTINCT r."repositoryCaseId")::int AS cases,
             COUNT(DISTINCT ts."testRunId")::int AS runs
      FROM "JUnitTestResult" r
      JOIN "JUnitTestSuite" ts ON ts.id = r."testSuiteId"
      WHERE r."failureSignatureId" = ANY(${signatureIds}::int[])
      GROUP BY r."failureSignatureId"
    ) s
    WHERE fs.id = s.sid
  `.execute(db.$qb);

  const caseRows = await sql<{ sid: number; case_id: number }>`
    SELECT DISTINCT r."failureSignatureId" AS sid, r."repositoryCaseId" AS case_id
    FROM "JUnitTestResult" r
    WHERE r."failureSignatureId" = ANY(${signatureIds}::int[])
  `.execute(db.$qb);
  const casesBySignature = new Map<number, number[]>();
  for (const row of caseRows.rows) {
    const list = casesBySignature.get(row.sid) ?? [];
    list.push(row.case_id);
    casesBySignature.set(row.sid, list);
  }
  const allCaseIds = [...new Set(caseRows.rows.map((r) => r.case_id))];
  const history = await getCaseVerdictHistory(
    db,
    allCaseIds,
    FLAKY_HISTORY_WINDOW
  );

  for (const sid of signatureIds) {
    const caseIds = casesBySignature.get(sid) ?? [];
    const flaky = isFlakyCandidate(caseIds.map((id) => history.get(id) ?? []));
    await db.failureSignature.update({
      where: { id: sid },
      data: { flakyCandidate: flaky },
    });
  }
}

/** `true` = passed, `false` = failed; newest first. */
export type VerdictHistory = boolean[];

/**
 * The last `window` automated verdicts per case (PASSED vs FAILURE/ERROR,
 * skips ignored), newest first.
 */
export async function getCaseVerdictHistory(
  db: TriageDb,
  caseIds: number[],
  window: number
): Promise<Map<number, VerdictHistory>> {
  const out = new Map<number, VerdictHistory>();
  if (caseIds.length === 0) return out;
  const rows = await sql<{ case_id: number; verdicts: boolean[] }>`
    WITH ranked AS (
      SELECT r."repositoryCaseId" AS case_id,
             (r.type = 'PASSED') AS ok,
             ROW_NUMBER() OVER (
               PARTITION BY r."repositoryCaseId"
               ORDER BY COALESCE(r."executedAt", r."createdAt") DESC, r.id DESC
             ) AS rn
      FROM "JUnitTestResult" r
      WHERE r."repositoryCaseId" = ANY(${caseIds}::int[])
        AND r.type IN ('PASSED', 'FAILURE', 'ERROR')
    )
    SELECT case_id, ARRAY_AGG(ok ORDER BY rn) AS verdicts
    FROM ranked
    WHERE rn <= ${window}
    GROUP BY case_id
  `.execute(db.$qb);
  for (const row of rows.rows) out.set(row.case_id, row.verdicts);
  return out;
}

/** Pass/fail transitions in a newest-first verdict list. */
export function countFlips(verdicts: VerdictHistory): number {
  let flips = 0;
  for (let i = 1; i < verdicts.length; i++) {
    if (verdicts[i] !== verdicts[i - 1]) flips++;
  }
  return flips;
}

/**
 * A signature is a flaky candidate when at least half of its cases flipped
 * between pass and fail FLAKY_MIN_FLIPS or more times in their recent history.
 */
export function isFlakyCandidate(histories: VerdictHistory[]): boolean {
  const withSamples = histories.filter((h) => h.length >= 3);
  if (withSamples.length === 0) return false;
  const flaky = withSamples.filter(
    (h) => countFlips(h) >= FLAKY_MIN_FLIPS
  ).length;
  return flaky / withSamples.length >= FLAKY_CASE_SHARE;
}

/** Renders a verdict list as `P F P P F` for prompts and tooltips. */
export function formatVerdicts(verdicts: VerdictHistory): string {
  return verdicts.map((ok) => (ok ? "P" : "F")).join(" ");
}
