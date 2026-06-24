import type {
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

// EXEC-02 / EXEC-03 inline test-case shape (latest result via take:1 nested include)
export const RUN_DETAIL_TESTCASE_INCLUDE = {
  repositoryCase: { select: { id: true, name: true, source: true } },
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
// ─────────────────────────────────────────────────────────────────────────────

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
  const statusIds = safeGroups
    .map((g) => g.statusId)
    .filter((id): id is number => id !== null);
  if (statusIds.length === 0) {
    return { groups: safeGroups, nameById: new Map() };
  }
  const statuses = await zenstack<Array<{ id: number; name: string }>>(
    "status",
    "findMany",
    {
      where: { id: { in: statusIds } },
      select: { id: true, name: true },
    } satisfies StatusFindManyArgs,
    env,
  );
  const nameById = new Map<number, string>(
    (statuses ?? []).map((s) => [s.id, s.name]),
  );
  return { groups: safeGroups, nameById };
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

export interface RawRunDetailTestCase {
  id: number;
  order: number;
  isCompleted: boolean;
  repositoryCase: { id: number; name: string; source: string } | null;
  assignedTo: { id: string; name: string | null; email: string } | null;
  status: { id: number; name: string } | null;
  results: RawRunCaseLatestResult[];
}

export function mapRunDetailTestCase(raw: RawRunDetailTestCase) {
  const latest = raw.results?.[0] ?? null;
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
    status: raw.status ? { id: raw.status.id, name: raw.status.name } : null,
    latestResult: latest
      ? {
          id: latest.id,
          status: latest.status
            ? { id: latest.status.id, name: latest.status.name }
            : null,
          executedBy: latest.executedBy
            ? {
                id: latest.executedBy.id,
                name: latest.executedBy.name,
                email: latest.executedBy.email,
              }
            : null,
          executedAt: latest.executedAt,
        }
      : null,
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
