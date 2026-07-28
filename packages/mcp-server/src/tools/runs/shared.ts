import type {
  JUnitTestResultGroupByArgs,
  JUnitTestResultInclude,
  JUnitTestSuiteFindManyArgs,
  StatusFindManyArgs,
  TestRunCasesGroupByArgs,
  TestRunCasesInclude,
  TestRunResultsInclude,
  TestRunStepResultsSelect,
  TestRunsInclude,
} from "@db/input";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import {
  extractProseMirrorText,
  denormalizeCustomFields,
} from "../cases/shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Typed includes — every literal carries `as const satisfies Prisma.<Model><Include|Select>`.
// Reintroducing an unknown column produces TS2353 (Phase 6 WR-09 invariant).
//
// CRITICAL invariants:
//   R1 — TestRunCases has NO `isDeleted` column (Cascade deletes only); never
//        add `isDeleted: false` to a TestRunCases-shaped where clause.
//   R2 — TestRunStepResults relation to Status is named `stepStatus` (NOT `status`).
//   R3 — Status rollup total is summed FROM groupBy results, never from a
//        separate count call (counts must always sum to total).
//   D7-02 — "latest result per case" = `executedAt` desc, take 1.
// ─────────────────────────────────────────────────────────────────────────────

export const RUN_ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  state: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  configuration: { select: { id: true, name: true } },
  milestone: { select: { id: true, name: true } },
  tags: { select: { id: true, name: true } },
  issues: {
    where: { isDeleted: false },
    select: {
      id: true,
      externalKey: true,
      title: true,
      externalStatus: true,
      integration: { select: { provider: true } },
    },
  },
} as const satisfies TestRunsInclude;

// EXEC-02 / EXEC-03 inline test-case shape (latest result via take:1 nested include).
// A function (not a constant) because the JUnit half of the latestResult union
// must be scoped to THIS run: JUnitTestResult has no testRunCaseId — it hangs
// off repositoryCaseId and reaches the run only via testSuite.testRunId, so the
// nested include needs the runId at build time.
export function runDetailTestCaseInclude(runId: number) {
  return {
    repositoryCase: {
      select: {
        id: true,
        name: true,
        source: true,
        // Automated (JUNIT/TESTNG/…) runs write results to JUnitTestResult,
        // never TestRunResults. Latest JUnit result for this case WITHIN this
        // run; mapRunDetailTestCase unions it with results[0].
        // NOTE: JUnitTestResult has NO isDeleted column (Cascade deletes only).
        junitResults: {
          where: { testSuite: { testRunId: runId } },
          orderBy: [{ executedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            id: true,
            executedAt: true,
            status: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    },
    assignedTo: { select: { id: true, name: true, email: true } },
    // CRITICAL: TestRunCases relation IS named `status` (not stepStatus — that's
    // TestRunStepResults). Verified against Prisma TestRunCasesInclude.
    status: { select: { id: true, name: true } },
    results: {
      where: { isDeleted: false },
      orderBy: { executedAt: "desc" }, // D7-02 — matches @@index([testRunCaseId, executedAt(sort: Desc)])
      take: 1,
      select: {
        id: true,
        statusId: true,
        status: { select: { id: true, name: true } },
        executedBy: { select: { id: true, name: true, email: true } },
        executedAt: true,
      },
    },
  } as const satisfies TestRunCasesInclude;
}

// EXEC-04 list rows
export const RUN_RESULT_LIST_INCLUDE = {
  status: { select: { id: true, name: true } },
  executedBy: { select: { id: true, name: true, email: true } },
  testRunCase: {
    select: {
      id: true,
      repositoryCaseId: true,
      repositoryCase: { select: { id: true, name: true, source: true } },
      testRun: { select: { id: true, name: true } },
    },
  },
} as const satisfies TestRunResultsInclude;

// Automated-run results (testRunType JUNIT/TESTNG/XUNIT/NUNIT/MSTEST/MOCHA/
// CUCUMBER) live in JUnitTestResult — keyed by repositoryCaseId + testSuiteId,
// NOT testRunCaseId; the run is reachable only via testSuite.testRunId.
// `executedBy` for a JUnit row is the importer (createdBy) — CI results have
// no per-case executor. NOTE: neither JUnitTestResult nor JUnitTestSuite has
// isDeleted (Cascade deletes only) — never add a soft-delete filter here.
export const JUNIT_RESULT_LIST_INCLUDE = {
  status: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  repositoryCase: { select: { id: true, name: true, source: true } },
  testSuite: {
    select: {
      id: true,
      name: true,
      testRunId: true,
      testRun: { select: { id: true, name: true } },
    },
  },
} as const satisfies JUnitTestResultInclude;

export const JUNIT_RESULT_DETAIL_INCLUDE = {
  ...JUNIT_RESULT_LIST_INCLUDE,
  // Attachments on JUnitTestResult use the shared Attachments model (which
  // DOES have isDeleted). JUnitTestStep / JUnitAttachment are per-CASE rows
  // with no result FK, so they cannot be inlined per-result.
  attachments: {
    where: { isDeleted: false },
    select: { id: true, name: true, url: true },
  },
} as const satisfies JUnitTestResultInclude;

// EXEC-05 step-result shape — R2: relation field on TestRunStepResults is
// `stepStatus` NOT `status` (schema.zmodel:2437). Reintroducing `status` here
// produces TS2353 against TestRunStepResultsSelect.
export const STEP_RESULT_SELECT = {
  id: true,
  statusId: true,
  stepStatus: { select: { id: true, name: true } },
  notes: true, // Json? -> extractProseMirrorText
  evidence: true, // Json? -> as-is per D7-08
  executedAt: true,
  elapsed: true,
  step: {
    select: {
      id: true,
      order: true,
      step: true, // Json? -> stepText
      expectedResult: true, // Json? -> expectedResultText
    },
  },
  attachments: {
    where: { isDeleted: false },
    select: { id: true, name: true, url: true },
  },
  issues: {
    where: { isDeleted: false },
    select: {
      id: true,
      externalKey: true,
      title: true,
      externalStatus: true,
      integration: { select: { provider: true } },
    },
  },
} as const satisfies TestRunStepResultsSelect;

export const RUN_RESULT_DETAIL_INCLUDE = {
  status: { select: { id: true, name: true } },
  executedBy: { select: { id: true, name: true, email: true } },
  editedBy: { select: { id: true, name: true, email: true } },
  testRunCase: {
    select: {
      id: true,
      repositoryCaseId: true,
      repositoryCase: { select: { id: true, name: true, source: true } },
      testRun: { select: { id: true, name: true } },
    },
  },
  attachments: {
    where: { isDeleted: false },
    select: { id: true, name: true, url: true },
  },
  issues: {
    where: { isDeleted: false },
    select: {
      id: true,
      externalKey: true,
      title: true,
      externalStatus: true,
      integration: { select: { provider: true } },
    },
  },
  resultFieldValues: {
    include: {
      field: {
        select: {
          displayName: true,
          type: { select: { type: true } },
          fieldOptions: {
            select: { fieldOption: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
  stepResults: {
    where: { isDeleted: false },
    // R5 fallback: nested-relation orderBy (`step: { order: 'asc' }`) generates
    // the broken `TestRunStepResults$orderBy$0` alias under ZenStack v3. `stepId`
    // ordering approximates step order (steps are created sequentially) and the
    // `id` tiebreaker keeps it deterministic (BL-04 invariant from Phase 6).
    orderBy: [{ stepId: "asc" }, { id: "asc" }],
    select: STEP_RESULT_SELECT,
  },
} as const satisfies TestRunResultsInclude;

// ─────────────────────────────────────────────────────────────────────────────
// Status rollup (D7-04 statusCounts shape; R3 — total computed FROM groups)
//
// TWO rollup sources, keyed on TestRuns.testRunType:
//   REGULAR   → groupBy TestRunCases.statusId (manual execution state).
//   automated → groupBy JUnitTestResult.statusId via testSuite.testRunId.
//     Matches the web UI (lib/services/testRunSummary.ts getJUnitRunSummary +
//     /api/test-runs/summaries): COUNT(*) over result ROWS — attempts, NOT
//     unique cases — so a retried case counts once per imported row. Automated
//     imports create TestRunCases junction rows but never set their statusId,
//     which is why the TestRunCases groupBy reports automated runs as 100%
//     untested; the UI ignores TestRunCases entirely for these runs and so do
//     we. `untested` for an automated run counts only null-status result rows
//     (the UI has no untested bucket at all — its total is the row count).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors AUTOMATED_TEST_RUN_TYPES in testplanit/utils/testResultTypes.ts:
 * every TestRunType except REGULAR (JUNIT/TESTNG/XUNIT/NUNIT/MSTEST/MOCHA/
 * CUCUMBER) stores results in the JUnit suite tables.
 */
export function isAutomatedRunType(testRunType: string): boolean {
  return testRunType !== "REGULAR";
}

export interface StatusGroup {
  statusId: number | null;
  _count: { id: number };
}

export interface StatusRollup {
  statusCounts: Array<{ id: number; name: string; count: number }>;
  untested: number;
  total: number;
}

export function computeStatusRollup(
  groups: StatusGroup[],
  nameById: Map<number, string>,
): StatusRollup {
  const untested = groups.find((g) => g.statusId === null)?._count.id ?? 0;
  // R3: total summed from groups, NEVER a separate count call. Splitting these
  // two queries (rollup + count) lets them disagree on race; keep the source
  // of truth as the groupBy result.
  const total = groups.reduce((s, g) => s + g._count.id, 0);
  const statusCounts = groups
    .filter(
      (g): g is { statusId: number; _count: { id: number } } =>
        g.statusId !== null,
    )
    .map((g) => ({
      id: g.statusId,
      name: nameById.get(g.statusId) ?? "Unknown",
      count: g._count.id,
    }));
  return { statusCounts, untested, total };
}

/**
 * Two-call status-name resolution: groupBy on TestRunCases.statusId for the
 * run, then status.findMany for the non-null statusIds. Returns the raw groups
 * + a name-by-id Map so callers pass both into `computeStatusRollup`.
 *
 * R6 efficiency: when every grouped statusId is null (run with no executed
 * cases yet), skip the second call.
 */
export async function extractStatusNames(
  runId: number,
  env: EnvConfig,
): Promise<{ groups: StatusGroup[]; nameById: Map<number, string> }> {
  const groups = await zenstack<StatusGroup[]>(
    "testRunCases",
    "groupBy",
    {
      by: ["statusId"],
      // R1: TestRunCases has NO isDeleted; do NOT add `isDeleted: false`.
      where: { testRunId: runId },
      _count: { id: true },
    } satisfies TestRunCasesGroupByArgs,
    env,
  );
  const safeGroups = groups ?? [];
  const nameById = await resolveStatusNames(
    safeGroups.map((g) => g.statusId),
    env,
  );
  return { groups: safeGroups, nameById };
}

/**
 * Shared tail of every rollup: resolve names for the non-null statusIds.
 * R6 efficiency — skips the findMany entirely when there is nothing to
 * resolve (all-null groups, or an empty group set).
 */
export async function resolveStatusNames(
  statusIds: Array<number | null>,
  env: EnvConfig,
): Promise<Map<number, string>> {
  const ids = Array.from(
    new Set(statusIds.filter((id): id is number => id !== null)),
  );
  if (ids.length === 0) return new Map();
  const statuses = await zenstack<Array<{ id: number; name: string }>>(
    "status",
    "findMany",
    {
      where: { id: { in: ids } },
      select: { id: true, name: true },
    } satisfies StatusFindManyArgs,
    env,
  );
  return new Map<number, string>((statuses ?? []).map((s) => [s.id, s.name]));
}

/**
 * Automated-run twin of `extractStatusNames`: groupBy on
 * JUnitTestResult.statusId scoped to the run via testSuite.testRunId. Counts
 * result ROWS (attempts) to match the web UI's COUNT(*) rollup. NOTE:
 * JUnitTestResult has NO isDeleted (Cascade deletes only) — never add a
 * soft-delete filter here.
 */
export async function extractJunitStatusNames(
  runId: number,
  env: EnvConfig,
): Promise<{ groups: StatusGroup[]; nameById: Map<number, string> }> {
  const groups = await zenstack<StatusGroup[]>(
    "jUnitTestResult",
    "groupBy",
    {
      by: ["statusId"],
      where: { testSuite: { testRunId: runId } },
      _count: { id: true },
    } satisfies JUnitTestResultGroupByArgs,
    env,
  );
  const safeGroups = groups ?? [];
  const nameById = await resolveStatusNames(
    safeGroups.map((g) => g.statusId),
    env,
  );
  return { groups: safeGroups, nameById };
}

/**
 * Batched JUnit rollup for the runs LIST page: one JUnitTestSuite.findMany
 * (suite id → run id) + one JUnitTestResult.groupBy across every suite —
 * never a per-run call (D7-06 stays two calls per source, not N).
 * groupBy can only key on JUnitTestResult's own scalars and the run id lives
 * on the suite, so the suite lookup is what re-attaches groups to runs.
 * Returns per-run StatusGroups with per-status counts summed across suites.
 * Name resolution is left to the caller so both sources share ONE
 * status.findMany.
 */
export async function extractJunitStatusGroupsByRun(
  runIds: number[],
  env: EnvConfig,
): Promise<Map<number, StatusGroup[]>> {
  const byRun = new Map<number, StatusGroup[]>();
  if (runIds.length === 0) return byRun;
  const suites =
    (await zenstack<Array<{ id: number; testRunId: number }>>(
      "jUnitTestSuite",
      "findMany",
      {
        where: { testRunId: { in: runIds } },
        select: { id: true, testRunId: true },
      } satisfies JUnitTestSuiteFindManyArgs,
      env,
    )) ?? [];
  if (suites.length === 0) return byRun;
  const runBySuite = new Map<number, number>(
    suites.map((s) => [s.id, s.testRunId]),
  );
  const suiteGroups =
    (await zenstack<Array<StatusGroup & { testSuiteId: number }>>(
      "jUnitTestResult",
      "groupBy",
      {
        by: ["testSuiteId", "statusId"],
        where: { testSuiteId: { in: suites.map((s) => s.id) } },
        _count: { id: true },
      } satisfies JUnitTestResultGroupByArgs,
      env,
    )) ?? [];
  // Sum across suites: a run's Passed count is the total Passed rows over
  // ALL of its suites, so fold (suite,status) groups down to (run,status).
  const countByRunStatus = new Map<number, Map<number | null, number>>();
  for (const g of suiteGroups) {
    const runId = runBySuite.get(g.testSuiteId);
    if (runId === undefined) continue;
    const perStatus = countByRunStatus.get(runId) ?? new Map();
    perStatus.set(g.statusId, (perStatus.get(g.statusId) ?? 0) + g._count.id);
    countByRunStatus.set(runId, perStatus);
  }
  for (const [runId, perStatus] of countByRunStatus) {
    byRun.set(
      runId,
      Array.from(perStatus, ([statusId, count]) => ({
        statusId,
        _count: { id: count },
      })),
    );
  }
  return byRun;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — every output field enumerated explicitly (T-07-03 mitigation:
// never `...spread` raw rows; the include shape and the mapper output must
// stay in sync explicitly so a schema drift can't leak new columns).
// ─────────────────────────────────────────────────────────────────────────────

interface RawIssue {
  id: number;
  externalKey: string | null;
  title: string | null;
  externalStatus: string | null;
  integration: { provider: string } | null;
}

function mapIssue(raw: RawIssue) {
  return {
    id: raw.id,
    externalKey: raw.externalKey,
    title: raw.title,
    externalStatus: raw.externalStatus,
    externalSystem: raw.integration?.provider ?? null,
  };
}

interface RawAttachment {
  id: number;
  name: string;
  url: string;
}

function mapAttachment(raw: RawAttachment) {
  return { id: raw.id, fileName: raw.name, url: raw.url };
}

export interface RawRunRow {
  id: number;
  name: string;
  isCompleted: boolean;
  completedAt: string | Date | null;
  createdAt: string | Date;
  testRunType: string;
  project: { id: number; name: string };
  state: { id: number; name: string };
  // NOTE: schema relation is `createdBy` (NOT `creator` — RepositoryCases uses
  // `creator`, but TestRuns / Sessions use `createdBy`).
  createdBy: { id: string; name: string | null; email: string };
  configuration: { id: number; name: string } | null;
  milestone: { id: number; name: string } | null;
  tags: Array<{ id: number; name: string }>;
  issues: RawIssue[];
}

export function mapRunRow(raw: RawRunRow) {
  return {
    id: raw.id,
    name: raw.name,
    isCompleted: raw.isCompleted,
    completedAt: raw.completedAt ?? null,
    createdAt: raw.createdAt,
    testRunType: raw.testRunType, // surface enum verbatim (RESEARCH discretion 5)
    project: raw.project
      ? { id: raw.project.id, name: raw.project.name }
      : null,
    state: raw.state ? { id: raw.state.id, name: raw.state.name } : null,
    createdBy: raw.createdBy
      ? {
          id: raw.createdBy.id,
          name: raw.createdBy.name,
          email: raw.createdBy.email,
        }
      : null,
    configuration: raw.configuration
      ? { id: raw.configuration.id, name: raw.configuration.name }
      : null,
    milestone: raw.milestone
      ? { id: raw.milestone.id, name: raw.milestone.name }
      : null,
    tags: (raw.tags ?? []).map((t) => ({ id: t.id, name: t.name })),
    issues: (raw.issues ?? []).map(mapIssue),
  };
}

export interface RawRunCaseLatestResult {
  id: number;
  statusId: number | null;
  status: { id: number; name: string } | null;
  executedBy: { id: string; name: string | null; email: string } | null;
  executedAt: string | Date;
}

export interface RawRunCaseLatestJunit {
  id: number;
  executedAt: string | Date | null;
  status: { id: number; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
}

export interface RawRunDetailTestCase {
  id: number;
  order: number;
  isCompleted: boolean;
  repositoryCase: {
    id: number;
    name: string;
    source: string;
    // Optional: rows fetched without runDetailTestCaseInclude (older include
    // shapes in tests) read undefined and fall back to the TestRun half.
    junitResults?: RawRunCaseLatestJunit[];
  } | null;
  assignedTo: { id: string; name: string | null; email: string } | null;
  status: { id: number; name: string } | null;
  results: RawRunCaseLatestResult[];
}

export function mapRunDetailTestCase(raw: RawRunDetailTestCase) {
  const manual = raw.results?.[0] ?? null;
  const junit = raw.repositoryCase?.junitResults?.[0] ?? null;
  // Union: whichever executed later wins; `source` disambiguates so agents
  // know which table (and which results_get source param) the id refers to.
  // A null executedAt on the junit row loses to any manual result (manual
  // executedAt is @default(now()) — never null).
  const junitWins =
    junit !== null &&
    (manual === null ||
      (junit.executedAt !== null &&
        new Date(junit.executedAt).getTime() >=
          new Date(manual.executedAt).getTime()));
  const latestResult = junitWins
    ? {
        id: junit.id,
        source: "JUnit" as const,
        status: junit.status
          ? { id: junit.status.id, name: junit.status.name }
          : null,
        executedBy: junit.createdBy
          ? {
              id: junit.createdBy.id,
              name: junit.createdBy.name,
              email: junit.createdBy.email,
            }
          : null,
        executedAt: junit.executedAt,
      }
    : manual
      ? {
          id: manual.id,
          source: "TestRun" as const,
          status: manual.status
            ? { id: manual.status.id, name: manual.status.name }
            : null,
          executedBy: manual.executedBy
            ? {
                id: manual.executedBy.id,
                name: manual.executedBy.name,
                email: manual.executedBy.email,
              }
            : null,
          executedAt: manual.executedAt,
        }
      : null;
  return {
    id: raw.id,
    order: raw.order,
    isCompleted: raw.isCompleted,
    repositoryCase: raw.repositoryCase
      ? {
          id: raw.repositoryCase.id,
          name: raw.repositoryCase.name,
          source: raw.repositoryCase.source,
        }
      : null,
    assignedTo: raw.assignedTo
      ? {
          id: raw.assignedTo.id,
          name: raw.assignedTo.name,
          email: raw.assignedTo.email,
        }
      : null,
    // Junction status when set (REGULAR runs write it atomically with each
    // result); otherwise fall back to the latest result's status. Automated
    // runs NEVER set the junction status, so without the fallback every case
    // on a JUNIT/MOCHA run reads status:null despite having results.
    status: raw.status
      ? { id: raw.status.id, name: raw.status.name }
      : (latestResult?.status ?? null),
    latestResult,
  };
}

export interface RawRunResultRow {
  id: number;
  statusId: number;
  status: { id: number; name: string };
  executedBy: { id: string; name: string | null; email: string };
  executedAt: string | Date;
  attempt: number;
  testRunCase: {
    id: number;
    repositoryCaseId: number;
    repositoryCase: { id: number; name: string; source: string } | null;
    testRun: { id: number; name: string } | null;
  };
}

export function mapRunResultRow(raw: RawRunResultRow) {
  return {
    id: raw.id,
    // Discriminator for the manual/automated union: this id lives in
    // TestRunResults — pass source:"TestRun" (the default) to results_get.
    source: "TestRun" as const,
    attempt: raw.attempt,
    executedAt: raw.executedAt,
    status: raw.status ? { id: raw.status.id, name: raw.status.name } : null,
    executedBy: raw.executedBy
      ? {
          id: raw.executedBy.id,
          name: raw.executedBy.name,
          email: raw.executedBy.email,
        }
      : null,
    // Normalized top-level case/run identity — same position on both row
    // sources so agents don't need per-source traversal (JUnit rows have no
    // testRunCase to nest under).
    repositoryCase: raw.testRunCase?.repositoryCase
      ? {
          id: raw.testRunCase.repositoryCase.id,
          name: raw.testRunCase.repositoryCase.name,
          source: raw.testRunCase.repositoryCase.source,
        }
      : null,
    testRun: raw.testRunCase?.testRun
      ? {
          id: raw.testRunCase.testRun.id,
          name: raw.testRunCase.testRun.name,
        }
      : null,
    testRunCase: raw.testRunCase
      ? {
          id: raw.testRunCase.id,
          repositoryCaseId: raw.testRunCase.repositoryCaseId,
          repositoryCase: raw.testRunCase.repositoryCase
            ? {
                id: raw.testRunCase.repositoryCase.id,
                name: raw.testRunCase.repositoryCase.name,
                source: raw.testRunCase.repositoryCase.source,
              }
            : null,
          testRun: raw.testRunCase.testRun
            ? {
                id: raw.testRunCase.testRun.id,
                name: raw.testRunCase.testRun.name,
              }
            : null,
        }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JUnit (automated-run) result rows — the second half of the results union.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawJunitResultRow {
  id: number;
  type: string;
  message: string | null;
  time: number | null;
  executedAt: string | Date | null;
  status: { id: number; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  repositoryCase: { id: number; name: string; source: string } | null;
  testSuite: {
    id: number;
    name: string;
    testRunId: number;
    testRun: { id: number; name: string } | null;
  } | null;
}

export function mapJunitResultRow(raw: RawJunitResultRow) {
  return {
    id: raw.id,
    // This id lives in JUnitTestResult — pass source:"JUnit" to results_get.
    source: "JUnit" as const,
    junitType: raw.type,
    message: raw.message,
    time: raw.time,
    executedAt: raw.executedAt,
    status: raw.status ? { id: raw.status.id, name: raw.status.name } : null,
    executedBy: raw.createdBy
      ? {
          id: raw.createdBy.id,
          name: raw.createdBy.name,
          email: raw.createdBy.email,
        }
      : null,
    repositoryCase: raw.repositoryCase
      ? {
          id: raw.repositoryCase.id,
          name: raw.repositoryCase.name,
          source: raw.repositoryCase.source,
        }
      : null,
    testRun: raw.testSuite?.testRun
      ? { id: raw.testSuite.testRun.id, name: raw.testSuite.testRun.name }
      : null,
    suite: raw.testSuite
      ? { id: raw.testSuite.id, name: raw.testSuite.name }
      : null,
    // JUnit results have no TestRunCases junction row of their own.
    testRunCase: null,
  };
}

export interface RawJunitResultDetail extends RawJunitResultRow {
  content: string | null;
  systemOut: string | null;
  systemErr: string | null;
  assertions: number | null;
  file: string | null;
  line: number | null;
  createdAt: string | Date;
  attachments: RawAttachment[];
}

export function mapJunitResultDetail(raw: RawJunitResultDetail) {
  return {
    ...mapJunitResultRow(raw),
    content: raw.content,
    systemOut: raw.systemOut,
    systemErr: raw.systemErr,
    assertions: raw.assertions,
    file: raw.file,
    line: raw.line,
    createdAt: raw.createdAt,
    attachments: (raw.attachments ?? []).map(mapAttachment),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-source merge for results_list — TestRunResults ∪ JUnitTestResult.
//
// Each source is fetched pre-sorted by (executedAt desc, id desc) with its own
// keyset cursor, then k-way merged here. The compound cursor keeps BOTH
// per-source positions (`tr:<id>|ju:<id>`) so pagination stays stateless:
// rows fetched but not consumed this page are simply re-fetched next page via
// their source's (unadvanced) cursor — no dupes, no gaps.
// ─────────────────────────────────────────────────────────────────────────────

export type ResultSource = "TestRun" | "JUnit";

export interface ResultsCursor {
  tr?: number;
  ju?: number;
}

/**
 * Cursor forms accepted: a bare number (legacy — a TestRunResults id, from
 * before the union existed) or the compound string `tr:<id>`, `ju:<id>`,
 * `tr:<id>|ju:<id>`. Returns null for a malformed string so the caller can
 * reject it as an input error rather than silently restarting from page 1.
 */
export function parseResultsCursor(
  cursor: number | string | undefined,
): ResultsCursor | null {
  if (cursor === undefined) return {};
  if (typeof cursor === "number") return { tr: cursor };
  const out: ResultsCursor = {};
  for (const part of cursor.split("|")) {
    const m = /^(tr|ju):([1-9]\d*)$/.exec(part);
    if (!m) return null;
    if (m[1] === "tr") out.tr = Number(m[2]);
    else out.ju = Number(m[2]);
  }
  return out;
}

export function formatResultsCursor(cursor: ResultsCursor): string | null {
  const parts: string[] = [];
  if (cursor.tr !== undefined) parts.push(`tr:${cursor.tr}`);
  if (cursor.ju !== undefined) parts.push(`ju:${cursor.ju}`);
  return parts.length > 0 ? parts.join("|") : null;
}

interface MergeEntry {
  source: ResultSource;
  id: number;
  executedAt: string | Date | null;
}

/**
 * Comparator matching the per-source DB order: executedAt DESC with nulls
 * first (Postgres DESC default — ZenStack emits no NULLS LAST), then a fixed
 * cross-source rank (TestRun before JUnit — arbitrary but deterministic; the
 * DB can't order across tables anyway), then id DESC.
 */
function resultRowBefore(a: MergeEntry, b: MergeEntry): boolean {
  const at = a.executedAt === null ? Infinity : new Date(a.executedAt).getTime();
  const bt = b.executedAt === null ? Infinity : new Date(b.executedAt).getTime();
  if (at !== bt) return at > bt;
  if (a.source !== b.source) return a.source === "TestRun";
  return a.id > b.id;
}

export interface MergedResultsPage<TR extends MergeEntry, JU extends MergeEntry> {
  items: Array<TR | JU>;
  hasNextPage: boolean;
  nextCursor: string | null;
}

/**
 * Merge two pre-sorted (executedAt desc, id desc) source pages into one page
 * of `limit` rows. Both inputs must have been fetched with take=limit+1 so
 * `hasNextPage` is simply "more rows were fetched than fit" — leftovers get
 * re-fetched next page via the per-source cursor positions in `nextCursor`
 * (a source with no row consumed this page carries its incoming position
 * forward unchanged).
 */
export function mergeResultsPage<TR extends MergeEntry, JU extends MergeEntry>(
  trRows: TR[],
  juRows: JU[],
  limit: number,
  incoming: ResultsCursor,
): MergedResultsPage<TR, JU> {
  const items: Array<TR | JU> = [];
  let ti = 0;
  let ji = 0;
  const next: ResultsCursor = { ...incoming };
  while (items.length < limit && (ti < trRows.length || ji < juRows.length)) {
    const takeTr =
      ji >= juRows.length ||
      (ti < trRows.length && resultRowBefore(trRows[ti], juRows[ji]));
    if (takeTr) {
      next.tr = trRows[ti].id;
      items.push(trRows[ti]);
      ti++;
    } else {
      next.ju = juRows[ji].id;
      items.push(juRows[ji]);
      ji++;
    }
  }
  const hasNextPage = trRows.length + juRows.length > limit;
  return {
    items,
    hasNextPage,
    nextCursor: hasNextPage ? formatResultsCursor(next) : null,
  };
}

export interface RawStepResult {
  id: number;
  statusId: number;
  // R2: relation name is `stepStatus` (NOT `status`). Output uses `status` for
  // agent friendliness, but input source is raw.stepStatus.
  stepStatus: { id: number; name: string } | null;
  notes: unknown;
  evidence: unknown;
  executedAt: string | Date;
  elapsed: number | null;
  step: {
    id: number;
    order: number;
    step: unknown;
    expectedResult: unknown;
  } | null;
  attachments: RawAttachment[];
  issues: RawIssue[];
}

export function mapStepResult(raw: RawStepResult) {
  return {
    id: raw.id,
    status: raw.stepStatus
      ? { id: raw.stepStatus.id, name: raw.stepStatus.name }
      : null,
    stepId: raw.step?.id ?? null,
    stepOrder: raw.step?.order ?? null,
    stepText: extractProseMirrorText(raw.step?.step),
    expectedResultText: extractProseMirrorText(raw.step?.expectedResult),
    notes: extractProseMirrorText(raw.notes),
    evidence: raw.evidence, // D7-08 — surface as-is, no truncation
    executedAt: raw.executedAt,
    elapsed: raw.elapsed ?? null,
    attachments: (raw.attachments ?? []).map(mapAttachment),
    issues: (raw.issues ?? []).map(mapIssue),
  };
}

export interface RawRunResultDetail extends Omit<RawRunResultRow, "executedBy"> {
  executedBy: { id: string; name: string | null; email: string } | null;
  editedBy: { id: string; name: string | null; email: string } | null;
  editedAt: string | Date | null;
  elapsed: number | null;
  notes: unknown;
  evidence: unknown;
  resultFieldValues: Array<{
    value: unknown;
    field: {
      displayName: string | null;
      type: { type: string | null } | null;
      fieldOptions: Array<{
        fieldOption: { id: number; name: string } | null;
      }>;
    } | null;
  }>;
  stepResults: RawStepResult[];
  attachments: RawAttachment[];
  issues: RawIssue[];
}

export function mapRunResultDetail(raw: RawRunResultDetail) {
  return {
    id: raw.id,
    source: "TestRun" as const,
    attempt: raw.attempt,
    executedAt: raw.executedAt,
    editedAt: raw.editedAt,
    elapsed: raw.elapsed ?? null,
    notes: extractProseMirrorText(raw.notes),
    evidence: raw.evidence, // D7-08
    status: raw.status ? { id: raw.status.id, name: raw.status.name } : null,
    executedBy: raw.executedBy
      ? {
          id: raw.executedBy.id,
          name: raw.executedBy.name,
          email: raw.executedBy.email,
        }
      : null,
    editedBy: raw.editedBy
      ? {
          id: raw.editedBy.id,
          name: raw.editedBy.name,
          email: raw.editedBy.email,
        }
      : null,
    testRunCase: raw.testRunCase
      ? {
          id: raw.testRunCase.id,
          repositoryCaseId: raw.testRunCase.repositoryCaseId,
          repositoryCase: raw.testRunCase.repositoryCase
            ? {
                id: raw.testRunCase.repositoryCase.id,
                name: raw.testRunCase.repositoryCase.name,
                source: raw.testRunCase.repositoryCase.source,
              }
            : null,
          testRun: raw.testRunCase.testRun
            ? {
                id: raw.testRunCase.testRun.id,
                name: raw.testRunCase.testRun.name,
              }
            : null,
        }
      : null,
    // ResultFieldValues input shape matches CaseFieldValues input shape — both
    // surface `field.displayName / field.type.type / field.fieldOptions[].fieldOption`
    // (A3 verified in Phase 7 RESEARCH). We delegate to the Phase 6 helper to
    // keep the option-id resolution path identical.
    customFields: denormalizeCustomFields(raw.resultFieldValues as never),
    stepResults: (raw.stepResults ?? []).map(mapStepResult),
    attachments: (raw.attachments ?? []).map(mapAttachment),
    issues: (raw.issues ?? []).map(mapIssue),
  };
}
