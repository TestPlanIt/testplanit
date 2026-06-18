/**
 * COR-02 — child/value/version/join table → owning root-entity attribution.
 *
 * The correlation worker (14-05) groups DataChangeLog rows by operationId, then applies
 * ROLLUP_MAP to roll each child/value/join row up to the RepositoryCases | TestRuns | Sessions
 * entity that owns it. The viewer reads one materialized AuditLog row per owning entity, not
 * dozens of raw child-table mutations.
 *
 * This module is intentionally framework-free: no React, no direct prisma import. The two-hop
 * resolver takes an injected query fn so the unit suite can exercise it without a DB.
 *
 * FK columns are the LIVE-VERIFIED values from 14-OPEN-QUESTIONS-RESOLVED.md (§2 + ancillary),
 * which supersede the 14-RESEARCH.md draft. The draft's `fkCol: 'A'` for every join table was
 * WRONG for the Issue join tables (column A is the Issue FK; the owning-entity FK is column B)
 * and for _TagsToTestRuns (TestRuns is column B). The two singular/plural FK landmines are pinned
 * by rollupMap.test.ts.
 */

/** Direct: the row's owning entity id is `<fkCol>` on the row itself. */
interface DirectRollup {
  ownerTable: "RepositoryCases" | "TestRuns" | "Sessions";
  fkCol: string;
  twoHop?: false;
}

/**
 * Two-hop: the row's `<fkCol>` points at an intermediate `hopTable` row, whose `<hopFkCol>`
 * holds the owning entity id. The worker batches the hop (one query per distinct fk value).
 */
interface TwoHopRollup {
  ownerTable: "RepositoryCases" | "TestRuns" | "Sessions";
  fkCol: string;
  twoHop: true;
  hopTable: string;
  hopFkCol: string;
}

export type RollupConfig = DirectRollup | TwoHopRollup;

/**
 * Every audited Cases/Runs/Sessions child, value, version, and implicit m2m join table mapped to
 * its owning root entity. Root entities (RepositoryCases / TestRuns / Sessions) are deliberately
 * ABSENT — they attribute to themselves.
 */
export const ROLLUP_MAP: Record<string, RollupConfig> = {
  // ── Cases family ────────────────────────────────────────────────────────────
  CaseFieldValues: { ownerTable: "RepositoryCases", fkCol: "testCaseId" },
  Steps: { ownerTable: "RepositoryCases", fkCol: "testCaseId" },
  TestCaseParameter: { ownerTable: "RepositoryCases", fkCol: "testCaseId" }, // A1 confirmed (schema:2085)
  // Issue/Tag join tables: column B is the entity FK for Issue tables; column A for *ToTags.
  _IssueToRepositoryCases: { ownerTable: "RepositoryCases", fkCol: "B" },
  _RepositoryCasesToTags: { ownerTable: "RepositoryCases", fkCol: "A" },

  // ── Runs family ─────────────────────────────────────────────────────────────
  TestRunCases: { ownerTable: "TestRuns", fkCol: "testRunId" },
  TestRunResults: { ownerTable: "TestRuns", fkCol: "testRunId" },
  TestRunStepResults: {
    ownerTable: "TestRuns",
    fkCol: "testRunResultId", // SINGULAR — distinct from ResultFieldValues.testRunResultsId
    twoHop: true,
    hopTable: "TestRunResults",
    hopFkCol: "testRunId",
  },
  TestRunCaseIteration: {
    ownerTable: "TestRuns",
    fkCol: "testRunCaseId",
    twoHop: true,
    hopTable: "TestRunCases",
    hopFkCol: "testRunId",
  },
  ResultFieldValues: {
    ownerTable: "TestRuns",
    // LANDMINE: testRunResultsId is PLURAL here (the column on ResultFieldValues), distinct from
    // TestRunStepResults.testRunResultId (singular). Using the singular form silently mis-attributes.
    fkCol: "testRunResultsId",
    twoHop: true,
    hopTable: "TestRunResults",
    hopFkCol: "testRunId",
  },
  _IssueToTestRuns: { ownerTable: "TestRuns", fkCol: "B" },
  _TagsToTestRuns: { ownerTable: "TestRuns", fkCol: "B" }, // _TagsToTestRuns: A=Tags, B=TestRuns
  _IssueToTestRunResults: {
    ownerTable: "TestRuns",
    fkCol: "B", // column B → TestRunResults.id, then hop to its testRunId
    twoHop: true,
    hopTable: "TestRunResults",
    hopFkCol: "testRunId",
  },
  _IssueToTestRunStepResults: {
    ownerTable: "TestRuns",
    fkCol: "B", // column B → TestRunStepResults.id, then hop to its testRunResultId
    twoHop: true,
    hopTable: "TestRunStepResults",
    hopFkCol: "testRunResultId",
  },

  // ── Sessions family ─────────────────────────────────────────────────────────
  SessionResults: { ownerTable: "Sessions", fkCol: "sessionId" },
  SessionFieldValues: { ownerTable: "Sessions", fkCol: "sessionId" },
  SessionVersions: { ownerTable: "Sessions", fkCol: "sessionId" },
  _IssueToSessions: { ownerTable: "Sessions", fkCol: "B" },
  _SessionsToTags: { ownerTable: "Sessions", fkCol: "A" }, // _SessionsToTags: A=Sessions
  _IssueToSessionResults: {
    ownerTable: "Sessions",
    fkCol: "B", // column B → SessionResults.id, then hop to its sessionId
    twoHop: true,
    hopTable: "SessionResults",
    hopFkCol: "sessionId",
  },
};

/** A single (id, ownerId) row returned by the injected hop query. */
export interface TwoHopRow {
  id: number | string;
  ownerId: number | string;
}

/** The injected lookup: given a hop table and the distinct fk values, return one row per id. */
export type TwoHopQueryFn = (
  hopTable: string,
  hopFkCol: string,
  fkValues: Array<number | string>,
) => Promise<TwoHopRow[]>;

/**
 * Batched two-hop resolver. Given a hop table, the distinct fk values seen across the batch, and
 * an injected query fn, issues ONE lookup (no per-row N+1 — Pitfall F) and returns a
 * Map<fkValue, ownerId>. Distinct values are de-duplicated before the query; an empty input set
 * short-circuits without touching the query fn.
 */
export async function resolveTwoHop(
  config: TwoHopRollup,
  fkValues: Array<number | string>,
  queryFn: TwoHopQueryFn,
): Promise<Map<number | string, number | string>> {
  const out = new Map<number | string, number | string>();
  const distinct = Array.from(new Set(fkValues));
  if (distinct.length === 0) {
    return out;
  }
  const rows = await queryFn(config.hopTable, config.hopFkCol, distinct);
  for (const row of rows) {
    out.set(row.id, row.ownerId);
  }
  return out;
}
