/**
 * Context materializer for the Automation Candidates report.
 *
 * Walks every manual (non-automated, non-deleted, non-archived) test case in
 * a project and assembles the LLM-facing payload: per-case identity, step
 * count, custom field values keyed by their display name (so the LLM sees
 * "Priority: High" not "field_42: 3"), and provider-agnostic metadata from
 * any linked external issues.
 *
 * Important non-goals — these are the lessons from the abandoned first
 * attempt at this report:
 *   1. NOT Jira-specific. Linked-issue metadata is read straight off the
 *      `Issue` rows that are already in our DB (mirrored at link time);
 *      we don't refetch from the tracker on every generate, and we don't
 *      special-case any provider.
 *   2. Custom fields are passed as `{displayName: value}` — the LLM is
 *      responsible for noticing a field literally named "Priority" /
 *      "Risk" / "Severity" / whatever, not us. There's no per-field
 *      handling here.
 */

import { baseDb } from "~/lib/db";

/**
 * Strategies for picking which manual cases get sent to the LLM when the
 * project has more than the per-generation cap. Aligned with mainstream
 * automation-priority guidance:
 *
 * - `most_executed`: regression-frequency proxy — cases run many times
 *    manually are the best ROI targets for automation. Default.
 * - `flakiest_first`: cases whose pass/fail results flip the most. Flaky
 *    manual tests waste tester time and are prime candidates to be
 *    rewritten as deterministic automation. Approximated here as the
 *    absolute distance of the case's success rate from 50/50, weighted
 *    by total executions (cases with one run can't be "flaky").
 * - `longest_first`: cases with the highest manual-execution estimate.
 *    Automation directly recovers the longest tail of tester time.
 * - `oldest_first`: stability proxy — long-lived manual cases that haven't
 *    churned are likely mature enough to automate without rework.
 * - `random`: unbiased reference sample; useful as a baseline or when the
 *    user wants the LLM ranking to dominate the choice.
 * - `newest_first`: useful when the team is actively building and wants
 *    to triage what just landed.
 */
export type CaseSelectionStrategy =
  | "most_executed"
  | "flakiest_first"
  | "longest_first"
  | "oldest_first"
  | "random"
  | "newest_first";

export const DEFAULT_SELECTION_STRATEGY: CaseSelectionStrategy =
  "most_executed";

export const SELECTION_STRATEGIES: ReadonlyArray<CaseSelectionStrategy> = [
  "most_executed",
  "flakiest_first",
  "longest_first",
  "oldest_first",
  "random",
  "newest_first",
] as const;

/** One row of the materialized context, ready to JSON.stringify for the LLM. */
export interface AutomationCandidatesCase {
  id: number;
  name: string;
  className: string | null;
  stepCount: number;
  /** How many times this case has been executed across all test runs.
   *  Sent to the LLM as a signal of regression frequency. */
  executionCount: number;
  /** Best available manual-execution duration, in seconds. Prefers
   *  `RepositoryCases.forecastManual` (calculated from real tester
   *  execution times — more accurate over time) and falls back to
   *  `RepositoryCases.estimate` (the author's original estimate, often
   *  stale) when the case hasn't been executed yet. `null` when both
   *  are unset. Powers the `longest_first` strategy and signals to the
   *  LLM that automating long-running manual tests recovers
   *  proportionally more tester time. */
  estimateSeconds: number | null;
  /** Approximate flakiness in [0, 1]: closer to 1 = more pass/fail
   *  flipping. `null` when the case has no executions or only one
   *  outcome (can't be flaky without varying outcomes). Powers the
   *  `flakiest_first` strategy. */
  flakinessScore: number | null;
  /** ISO timestamp of when this case was created. Powers the
   *  `oldest_first` / `newest_first` strategies AND signals case age
   *  to the LLM. */
  createdAtIso: string;
  /** displayName -> value (Json, whatever the field is). Empty object if
   *  the case has no custom field values. Field display names are taken
   *  from the active CaseFields row; values may be any JSON shape. */
  customFields: Record<string, unknown>;
  /** Empty array if the case has no linked external issues. Each entry is
   *  provider-agnostic; the LLM gets to weight whatever metadata is
   *  populated. `externalData` carries the raw tracker payload (labels,
   *  components, etc.) — included verbatim so we never lose signal that
   *  a specific tracker happens to expose. */
  linkedIssues: Array<{
    externalKey: string | null;
    title: string;
    description: string | null;
    status: string | null;
    externalStatus: string | null;
    priority: string | null;
    issueType: string | null;
    externalData: unknown;
  }>;
}

export interface AutomationCandidatesContext {
  projectId: number;
  projectName: string;
  /** The cases selected for this generation, after applying the strategy
   *  + cap (length is at most `maxCases`). */
  cases: AutomationCandidatesCase[];
  /** Total manual cases in the project before selection — used by the UI
   *  to show "Ranked X of Y manual cases". */
  totalManualCases: number;
  /** True when more manual cases exist than were sent to the LLM. */
  truncated: boolean;
  /** Which strategy picked the sent cases, surfaced in the snapshot
   *  output so viewers see how the input was chosen. */
  selectionStrategy: CaseSelectionStrategy;
}

/**
 * Materialize the input for the Automation Candidates LLM call.
 *
 * Pipeline:
 *   1. Query all manual cases in the project (automated=false, not
 *      deleted, not archived) with the metadata needed for both the
 *      LLM prompt and the selection strategy.
 *   2. Apply the chosen selection strategy + cap to pick which cases
 *      get sent to the LLM. Snapshot output records `selectionStrategy`
 *      so viewers can see how the input was chosen — selection is
 *      itself a ranking step that precedes the LLM ranking.
 *   3. Return the selected cases shaped for prompt serialization plus
 *      the totals/truncation metadata.
 *
 * Returns an empty `cases` array if the project has no manual cases left
 * to automate; the caller should short-circuit and skip the LLM call in
 * that case rather than send an empty prompt.
 */
export async function buildAutomationCandidatesContext(
  projectId: number,
  options: {
    maxCases: number;
    strategy?: CaseSelectionStrategy;
  } = { maxCases: 25 }
): Promise<AutomationCandidatesContext> {
  const strategy = options.strategy ?? DEFAULT_SELECTION_STRATEGY;
  const project = await baseDb.projects.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    throw new Error(
      `buildAutomationCandidatesContext: project ${projectId} not found`
    );
  }

  const rows = await baseDb.repositoryCases.findMany({
    where: {
      projectId,
      automated: false,
      isDeleted: false,
      isArchived: false,
      // Skip drafts. A case whose workflow state is `NOT_STARTED` hasn't
      // been validated yet — automating an unfinished spec is wasted
      // effort. We rank only cases that are actively maintained
      // (IN_PROGRESS) or already DONE.
      state: { workflowType: { in: ["IN_PROGRESS", "DONE"] } },
    },
    select: {
      id: true,
      name: true,
      className: true,
      source: true,
      hasParameters: true,
      automated: true,
      createdAt: true,
      estimate: true,
      forecastManual: true,
      steps: {
        where: { isDeleted: false },
        select: { id: true },
      },
      // Count of test-run executions — drives the `most_executed`
      // selection strategy AND is sent to the LLM as a regression-
      // frequency signal so the model can weight it in the ranking
      // even when a different selection strategy is used.
      _count: { select: { testRuns: true } },
      caseFieldValues: {
        select: {
          value: true,
          field: {
            select: {
              displayName: true,
              systemName: true,
              isDeleted: true,
              isEnabled: true,
              type: { select: { type: true } },
              // Pull the field's full allowed-option set so we can resolve
              // Dropdown / Multi-Select / Checkbox values (stored as option
              // IDs) to their display names. The raw stored value is a
              // FieldOption id — surfacing "Priority: 146" to the LLM is
              // meaningless; we want "Priority: High".
              fieldOptions: {
                where: {
                  fieldOption: { isDeleted: false, isEnabled: true },
                },
                select: {
                  fieldOption: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
      caseIssues: {
        where: { issue: { isDeleted: false } },
        select: {
          issue: {
            select: {
              externalKey: true,
              title: true,
              description: true,
              status: true,
              externalStatus: true,
              priority: true,
              issueTypeName: true,
              externalData: true,
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  // Flakiness proxy: across every TestRunCases row for this project's
  // manual cases, sum passed/failed iterations and compute
  // min(pass,fail) / max(pass,fail) — a value approaching 1 means the
  // case oscillates between passing and failing across runs (the
  // textbook flaky-test signature). Aggregated server-side as one
  // groupBy so we don't fan out per-case.
  const caseIdList = rows.map((r) => r.id);
  const flakeAggregates =
    caseIdList.length === 0
      ? []
      : await baseDb.testRunCases.groupBy({
          by: ["repositoryCaseId"],
          where: {
            repositoryCaseId: { in: caseIdList },
            isDeleted: false,
          },
          _sum: {
            passedIterations: true,
            failedIterations: true,
          },
        });
  const flakinessByCaseId = new Map<number, number | null>();
  for (const agg of flakeAggregates) {
    const pass = agg._sum.passedIterations ?? 0;
    const fail = agg._sum.failedIterations ?? 0;
    const max = Math.max(pass, fail);
    const min = Math.min(pass, fail);
    flakinessByCaseId.set(
      agg.repositoryCaseId,
      // Flat 0 when only one outcome exists; null when nothing's run.
      max === 0 ? null : min / max
    );
  }

  const allCases: Array<AutomationCandidatesCase & { createdAt: Date }> =
    rows.map((row) => {
      const customFields: Record<string, unknown> = {};
      for (const cfv of row.caseFieldValues) {
        // Skip disabled / deleted fields — they're noise and may carry stale
        // values the admin has explicitly removed from the case template.
        if (cfv.field.isDeleted || !cfv.field.isEnabled) continue;
        if (cfv.value == null) continue;
        const key = cfv.field.displayName || cfv.field.systemName;
        customFields[key] = resolveFieldValue(cfv.value, cfv.field);
      }

      return {
        id: row.id,
        name: row.name,
        className: row.className,
        stepCount: row.steps.length,
        executionCount: row._count.testRuns,
        // forecastManual is tester-derived and refines automatically as
        // runs accumulate; prefer it over the original `estimate`, which
        // is often stale after months in production.
        estimateSeconds: row.forecastManual ?? row.estimate ?? null,
        flakinessScore: flakinessByCaseId.get(row.id) ?? null,
        createdAtIso: row.createdAt.toISOString(),
        customFields,
        linkedIssues: row.caseIssues.map(({ issue: iss }) => ({
          externalKey: iss.externalKey,
          title: iss.title,
          description: iss.description,
          status: iss.status,
          externalStatus: iss.externalStatus,
          priority: iss.priority,
          issueType: iss.issueTypeName,
          externalData: iss.externalData,
        })),
        createdAt: row.createdAt,
      };
    });

  const totalManualCases = allCases.length;
  const ordered = orderCasesByStrategy(allCases, strategy);
  const selected = ordered
    .slice(0, options.maxCases)
    .map(({ createdAt: _createdAt, ...rest }) => rest);

  return {
    projectId: project.id,
    projectName: project.name,
    cases: selected,
    totalManualCases,
    truncated: totalManualCases > selected.length,
    selectionStrategy: strategy,
  };
}

/**
 * Apply a `CaseSelectionStrategy` to the full set of manual cases.
 *
 * Industry-aligned defaults — see the `CaseSelectionStrategy` doc — and
 * pure functions over the materialized rows so this is trivially unit-
 * testable. `random` uses a per-call shuffle (Fisher–Yates) — no seed,
 * so two generations on the same input yield different samples; the
 * "snapshot" guarantee comes from persisting the chosen ids in the
 * snapshot output, not from determinism here.
 */
function orderCasesByStrategy<
  T extends {
    id: number;
    createdAt: Date;
    executionCount: number;
    estimateSeconds: number | null;
    flakinessScore: number | null;
  },
>(cases: ReadonlyArray<T>, strategy: CaseSelectionStrategy): T[] {
  switch (strategy) {
    case "most_executed":
      return [...cases].sort(
        (a, b) =>
          b.executionCount - a.executionCount ||
          // Tie-break on id desc so the order is deterministic within
          // an execution-count bucket.
          b.id - a.id
      );
    case "flakiest_first":
      return [...cases].sort((a, b) => {
        // Nulls (no executions, or only one outcome) sort to the end —
        // a case we can't measure flakiness for isn't a flakiest pick.
        const aScore = a.flakinessScore ?? -1;
        const bScore = b.flakinessScore ?? -1;
        if (aScore !== bScore) return bScore - aScore;
        // Within an equal flakiness bucket, prefer more-executed cases:
        // the LLM has more signal to reason about.
        if (a.executionCount !== b.executionCount)
          return b.executionCount - a.executionCount;
        return b.id - a.id;
      });
    case "longest_first":
      return [...cases].sort((a, b) => {
        // Nulls (no estimate set) sort to the end — automating an
        // unestimated case has no measurable time savings to claim.
        const aEst = a.estimateSeconds ?? -1;
        const bEst = b.estimateSeconds ?? -1;
        if (aEst !== bEst) return bEst - aEst;
        return b.id - a.id;
      });
    case "oldest_first":
      return [...cases].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
      );
    case "newest_first":
      return [...cases].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id
      );
    case "random": {
      const arr = [...cases];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      }
      return arr;
    }
  }
}

/**
 * Serialize the materialized context into the newline-delimited-JSON shape
 * the prompt expects (one row per case). Kept separate from the materializer
 * so callers can also feed the typed object into validation/preview/tests
 * without going through string parsing.
 */
export function serializeContextForPrompt(
  context: AutomationCandidatesContext
): string {
  return context.cases.map((c) => JSON.stringify(c)).join("\n");
}

interface FieldMeta {
  type: { type: string } | null;
  fieldOptions: Array<{ fieldOption: { id: number; name: string } }>;
}

/**
 * For option-backed field types (Dropdown / Multi-Select / Checkbox) the
 * stored value is a FieldOption id (or an array of ids). Resolve to the
 * option's display name so the LLM sees "Priority: High" instead of
 * "Priority: 146". For other types (Text String, Text Long, Number,
 * Integer, Date, Link, Steps) the stored value is the literal value
 * already and passes through unchanged.
 *
 * Resilient to value/options shape drift: if a stored id is not in the
 * field's allowed-option set (e.g. an option was deleted after the value
 * was written), falls back to the raw value so the LLM still sees
 * *something* representative rather than dropping the field.
 */
export function resolveFieldValue(value: unknown, field: FieldMeta): unknown {
  const typeName = field.type?.type;
  const isOptionType =
    typeName === "Dropdown" ||
    typeName === "Multi-Select" ||
    typeName === "Checkbox";
  if (!isOptionType) return value;
  if (field.fieldOptions.length === 0) return value;

  const optionNameById = new Map<number, string>();
  for (const assignment of field.fieldOptions) {
    optionNameById.set(assignment.fieldOption.id, assignment.fieldOption.name);
  }

  const resolveOne = (raw: unknown): unknown => {
    if (typeof raw === "number") {
      return optionNameById.get(raw) ?? raw;
    }
    // Some values arrive as numeric strings ("146"); coerce before lookup.
    if (typeof raw === "string" && /^\d+$/.test(raw)) {
      return optionNameById.get(Number(raw)) ?? raw;
    }
    return raw;
  };

  if (Array.isArray(value)) {
    return value.map(resolveOne);
  }
  return resolveOne(value);
}
