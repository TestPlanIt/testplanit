import { sql } from "kysely";
import { getCaseLatestExecutedAt } from "~/lib/services/latestCaseResults";
import { isLinkageSuspect } from "~/lib/services/suspectLinkage";
import { optionPositionWeight } from "~/lib/schemas/riskPriorityWeights";
import {
  FLAKY_HISTORY_WINDOW,
  getCaseVerdictHistory,
} from "~/lib/services/triage/signatures";
import type { CaseRiskSignals, RiskDb } from "./types";

export const RISK_BATCH_SIZE = 500;
/** Verdicts sampled per case; matches the triage flaky window. */
export const RISK_HISTORY_WINDOW = FLAKY_HISTORY_WINDOW;

interface CaseIssueRow {
  case_id: number;
  is_requirement: boolean;
  priority: string | null;
  external_priority: string | null;
  integration_id: number | null;
  detached_at: Date | string | null;
  content_updated_at: Date | string | null;
  suspect_dismissed_at: Date | string | null;
}

interface CaseOptionRow {
  case_id: number;
  option_id: number;
}

/**
 * Mirrors the requirement display-priority lock predicate
 * (lib/services/requirementTree.ts REQUIREMENT_DISPLAY_PRIORITY_CASE): only a
 * tracker-linked, non-detached requirement shows the tracker's priority;
 * defects, native requirements and orphaned mirrors show the local one.
 */
function effectivePriority(row: CaseIssueRow): string | null {
  const synced =
    row.is_requirement && row.integration_id != null && row.detached_at == null;
  return synced
    ? (row.external_priority ?? row.priority)
    : (row.priority ?? row.external_priority);
}

/**
 * Batched signal collection for live cases of one project: four reads for
 * any number of cases (base rows + quarantine, automated verdict history,
 * latest manual-or-automated execution, issue links) plus the project's
 * chosen criticality field's values. Soft-deleted and archived cases drop
 * out here,
 * so callers can pass ids without pre-filtering.
 */
export interface RiskSignalOptions {
  /** The project's chosen criticality dropdown field, when configured. */
  criticalityFieldId?: number | null;
}

export async function getCaseRiskSignals(
  db: RiskDb,
  projectId: number,
  caseIds: number[],
  options: RiskSignalOptions = {}
): Promise<Map<number, CaseRiskSignals>> {
  const out = new Map<number, CaseRiskSignals>();
  if (caseIds.length === 0) return out;

  const cases = await db.repositoryCases.findMany({
    where: {
      id: { in: caseIds },
      projectId,
      isDeleted: false,
      isArchived: false,
    },
    select: {
      id: true,
      createdAt: true,
      quarantine: { select: { id: true } },
    },
  });
  if (cases.length === 0) return out;
  const liveIds = cases.map((repoCase) => repoCase.id);

  // The criticality field is an explicit per-project choice; its options
  // weight by their admin-set order (top first), never by name.
  const criticalityFieldId = options.criticalityFieldId ?? null;
  const optionWeights = new Map<number, { name: string; weight: number }>();
  if (criticalityFieldId != null) {
    const assignments = await db.caseFieldAssignment.findMany({
      where: {
        caseFieldId: criticalityFieldId,
        // A field the admin has since deleted or disabled stops counting;
        // the FK only clears on hard delete.
        caseField: { isDeleted: false, isEnabled: true },
        fieldOption: { isDeleted: false },
      },
      select: {
        fieldOption: { select: { id: true, name: true, order: true } },
      },
    });
    const ordered = assignments
      .map((assignment) => assignment.fieldOption)
      .sort((a, b) => a.order - b.order || a.id - b.id);
    ordered.forEach((option, position) => {
      optionWeights.set(option.id, {
        name: option.name,
        weight: optionPositionWeight(position, ordered.length),
      });
    });
  }

  const [verdicts, lastExecuted, issueRows, optionRows] = await Promise.all([
    getCaseVerdictHistory(db, liveIds, RISK_HISTORY_WINDOW),
    getCaseLatestExecutedAt(liveIds, db),
    sql<CaseIssueRow>`
      SELECT rci."caseId" AS case_id,
             i."isRequirement" AS is_requirement,
             i.priority,
             i."externalPriority" AS external_priority,
             i."integrationId" AS integration_id,
             i."requirementDetachedAt" AS detached_at,
             i."contentUpdatedAt" AS content_updated_at,
             rci."suspectDismissedAt" AS suspect_dismissed_at
      FROM "RepositoryCaseIssue" rci
      JOIN "Issue" i ON i.id = rci."issueId" AND i."isDeleted" = false
      WHERE rci."caseId" = ANY(${liveIds}::int[])
      ORDER BY rci."caseId" ASC, i.id ASC
    `.execute(db.$qb),
    criticalityFieldId != null && optionWeights.size > 0
      ? sql<CaseOptionRow>`
          SELECT cfv."testCaseId" AS case_id,
                 ((cfv.value #>> '{}'))::int AS option_id
          FROM "CaseFieldValues" cfv
          WHERE cfv."fieldId" = ${criticalityFieldId}
            AND (cfv.value #>> '{}') ~ '^[0-9]{1,9}$'
            AND cfv."testCaseId" = ANY(${liveIds}::int[])
        `.execute(db.$qb)
      : Promise.resolve({ rows: [] as CaseOptionRow[] }),
  ]);

  const issuesByCase = new Map<number, CaseIssueRow[]>();
  for (const row of issueRows.rows) {
    const list = issuesByCase.get(row.case_id);
    if (list) list.push(row);
    else issuesByCase.set(row.case_id, [row]);
  }
  const criticalityByCase = new Map<number, { name: string; weight: number }>();
  for (const row of optionRows.rows) {
    const option = optionWeights.get(Number(row.option_id));
    if (option) criticalityByCase.set(row.case_id, option);
  }

  for (const repoCase of cases) {
    const lastExecutedAt = lastExecuted.get(repoCase.id) ?? null;
    const requirementPriorities: (string | null)[] = [];
    const defectPriorities: (string | null)[] = [];
    let suspectLinkCount = 0;
    for (const row of issuesByCase.get(repoCase.id) ?? []) {
      if (row.is_requirement) {
        requirementPriorities.push(effectivePriority(row));
        if (
          isLinkageSuspect({
            lastExecutedAt,
            contentUpdatedAt: row.content_updated_at,
            suspectDismissedAt: row.suspect_dismissed_at,
          })
        ) {
          suspectLinkCount++;
        }
      } else {
        defectPriorities.push(effectivePriority(row));
      }
    }
    out.set(repoCase.id, {
      caseId: repoCase.id,
      verdicts: verdicts.get(repoCase.id) ?? [],
      lastExecutedAt,
      createdAt: repoCase.createdAt,
      requirementPriorities,
      suspectLinkCount,
      defectPriorities,
      caseCriticality: criticalityByCase.get(repoCase.id)?.name ?? null,
      caseCriticalityWeight: criticalityByCase.get(repoCase.id)?.weight ?? null,
      quarantined: repoCase.quarantine != null,
    });
  }
  return out;
}

/**
 * Cases of one run with a manual or automated result at/after `since`. The
 * per-run recompute scores only these, so a reporter streaming results for
 * half an hour costs each tick its burst, not the whole run — and a result
 * kept for a case that is not a run member (locked-composition imports)
 * still counts via the JUnit arm.
 */
export async function getRecentlyExecutedRunCaseIds(
  db: RiskDb,
  testRunId: number,
  since: Date
): Promise<number[]> {
  const result = await sql<{ case_id: number }>`
    SELECT DISTINCT r."repositoryCaseId" AS case_id
    FROM "JUnitTestResult" r
    JOIN "JUnitTestSuite" s ON s.id = r."testSuiteId"
    WHERE s."testRunId" = ${testRunId}
      AND COALESCE(r."executedAt", r."createdAt") >= ${since}
    UNION
    SELECT DISTINCT trc."repositoryCaseId" AS case_id
    FROM "TestRunResults" trr
    JOIN "TestRunCases" trc ON trc.id = trr."testRunCaseId"
    WHERE trr."testRunId" = ${testRunId}
      AND trr."isDeleted" = false
      AND trr."executedAt" >= ${since}
  `.execute(db.$qb);
  return result.rows.map((row) => Number(row.case_id));
}
