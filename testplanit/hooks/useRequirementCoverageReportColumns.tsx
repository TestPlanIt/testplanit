import { ClipboardCheck, Sparkles } from "lucide-react";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import StatusDisplay from "@/components/StatusDisplay";
import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import { formatRequirementCellText } from "~/utils/issueDisplayText";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { getDateFnsLocale } from "~/utils/locales";

import type {
  RequirementCoverageChangeReportRow,
  RequirementCoverageGapReportRow,
  RequirementTraceabilityReportRow,
} from "~/utils/requirementCoverageReportUtils";

/**
 * Column sets for the two requirement report types (D-2's dedicated report
 * surface, COV-04). Built on `useIssueTestCoverageColumns.tsx`'s shape --
 * `createColumnHelper` inside a `useMemo`, headers through `useTranslations()`
 * -- but deliberately WITHOUT grouping: `issue-test-coverage`'s grouping
 * exists because its last two columns render only via `aggregatedCell`, and
 * a grouped branch that is not gated on grouping being active is a recorded
 * repo defect. Both requirement reports are flat, project-scoped tables with
 * no aggregated cells, so grouping is never wired here.
 *
 * Both hooks return `ColumnDef<...>[]` derived from the shapes
 * `utils/requirementCoverageReportUtils.ts` emits server-side
 * (`RequirementCoverageGapReportRow` / `RequirementTraceabilityReportRow`).
 * Only `import type` is used against that module, which itself imports
 * server-only `next-auth`/`next/server` symbols -- a type-only import is
 * erased at compile time and never bundles that runtime code, the same
 * convention `lib/services/requirementTraceabilityExport.ts` documents for
 * its own `import type` of `lib/services/requirementCoverage.ts`.
 */

const REQUIREMENT_COLUMN_SIZE = 280;
const PATH_COLUMN_SIZE = 320;

/**
 * The result cell's three-way logic — the CSV builder in
 * `utils/reportCsvUtils.ts` mirrors it, so the table and the export never
 * disagree about what a blank cell means:
 *   - `testCaseId == null` -> the coverage gap: the uncovered treatment,
 *     using the same dashed warning tokens as the tree's coverage cell
 *     (`CoverageChip`'s Uncovered badge, never a hardcoded amber).
 *   - a case with a `lastStatusName` -> that status, coloured by
 *     `lastStatusColor`.
 *   - a case with NO `lastStatusName` -> the not-run treatment, distinct
 *     from uncovered: this requirement DOES have a linked case, it just has
 *     no in-scope execution yet.
 */
function RequirementResultCell({
  row,
}: {
  row: RequirementTraceabilityReportRow;
}) {
  const t = useTranslations("reports.ui.requirementCoverage");

  if (row.testCaseId == null) {
    return (
      <Badge
        variant="outline"
        data-testid="requirement-report-uncovered"
        className={cn(
          "whitespace-nowrap border-dashed border-warning bg-warning/15 text-foreground"
        )}
      >
        {t("uncovered")}
      </Badge>
    );
  }

  if (row.lastStatusName) {
    return (
      <StatusDisplay
        name={row.lastStatusName}
        color={row.lastStatusColor ?? undefined}
      />
    );
  }

  return (
    <span
      className="text-muted-foreground italic text-sm"
      data-testid="requirement-report-not-run"
    >
      {t("notRun")}
    </span>
  );
}

export function useRequirementCoverageGapColumns(
  /**
   * The rows the table is about to render — read only to decide whether
   * the Coverage column exists. Without the never-ran tier every row is
   * UNCOVERED and a constant column is noise; the moment tier-2 rows are
   * present the column is what keeps the tiers distinguishable. Deriving
   * this from the DATA (not the toggle) means the shared static view
   * needs no extra config plumbing.
   */
  rows?: Array<{ coverageStatus?: string }> | null,
  /**
   * When provided, appends a per-row "Generate Test Cases" action that
   * seeds the AI generation wizard from the gap's requirement. Only the
   * in-app builder passes it (gated on Test Case Repository add/edit + an
   * active LLM connection); the shared/static viewer calls this hook with
   * no callback, so the action can never reach a share-link viewer.
   */
  onGenerateTestCases?: (row: RequirementCoverageGapReportRow) => void,
  /**
   * Cross-project variant: prepend the column naming the project each
   * requirement came from. Off for the project-scoped report, where every
   * row shares one project and the column would be a constant.
   */
  isCrossProject = false
): ColumnDef<RequirementCoverageGapReportRow, any>[] {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCoverage = useTranslations("requirements.coverage");
  const tCommon = useTranslations("common");
  const tRepo = useTranslations("repository");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const hasNotRunTier = useMemo(
    () => (rows ?? []).some((row) => row?.coverageStatus === "NOT_RUN"),
    [rows]
  );

  return useMemo(() => {
    const columnHelper = createColumnHelper<RequirementCoverageGapReportRow>();
    const columns: ColumnDef<RequirementCoverageGapReportRow, any>[] = [];

    if (isCrossProject) {
      // The REQUIREMENT's own project. On the traceability variant this
      // sits alongside a "project" column naming the covering case's
      // project -- two different questions, so two different columns.
      columns.push(
        columnHelper.accessor("requirementProjectId", {
          id: "requirementProject",
          enableHiding: false,
          enableGrouping: false,
          header: () => <span>{t("requirementProject")}</span>,
          cell: (info) => {
            const row = info.row.original;
            if (row.requirementProjectId == null) return null;
            return (
              <ProjectNameDisplay
                projectName={row.requirementProjectName ?? ""}
                projectId={row.requirementProjectId}
                showLink
                fitContainer
                className="text-xs text-muted-foreground"
              />
            );
          },
          enableSorting: true,
          size: 160,
          minSize: 120,
          maxSize: 260,
        })
      );
    }

    columns.push(
      columnHelper.accessor("requirementKey", {
        id: "requirement",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("requirement")}</span>,
        // The requirement the report is ABOUT was the one thing in these
        // tables you could not click through to, while every test case
        // beside it linked out. Uses the project-less permalink so both
        // column sets share one cell -- the gap report's hook takes no
        // projectId, and the resolver already owns that lookup.
        cell: (info) => (
          <Link
            href={`/requirement/${info.row.original.requirementId}`}
            className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
            data-testid={`requirement-report-link-${info.row.original.requirementId}`}
          >
            {/* The tree's own icon convention (IssueTypeIcon over
                issueTypeName/iconUrl), so a requirement looks the same
                here as on the requirements page. */}
            <IssueTypeIcon
              fallbackIcon={ClipboardCheck}
              issueTypeName={info.row.original.requirementIssueTypeName}
              iconUrl={info.row.original.requirementIssueTypeIconUrl}
              className="h-4 w-4 shrink-0"
            />
            <span className="min-w-0 truncate">
              {formatRequirementCellText(info.row.original)}
            </span>
          </Link>
        ),
        enableSorting: true,
        size: REQUIREMENT_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    columns.push(
      // The ancestors-only display path — blank for a top-level
      // requirement. The full path (which repeats the requirement's own
      // text as its last segment) stays on the row as the server's
      // ordering key, but rendering it here made this column read as a
      // copy of the Requirement column in a mostly-flat project.
      columnHelper.accessor("requirementParentPath", {
        id: "requirementPath",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("path")}</span>,
        cell: (info) => (
          <div className="min-w-0 truncate text-sm text-muted-foreground">
            {info.getValue()}
          </div>
        ),
        enableSorting: true,
        size: PATH_COLUMN_SIZE,
        minSize: 200,
        maxSize: 600,
      })
    );

    // The coverage-debt columns (operator direction 2026-08-30): the
    // context that turns a gap list into an ACTION list — how important
    // the requirement is, whether it is even still open, which debt tier
    // it sits in, and how long the debt has existed.
    columns.push(
      columnHelper.accessor("requirementPriority", {
        id: "priority",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{tCommon("fields.priority")}</span>,
        // The SAME display components the requirements tree's own
        // Priority/Status columns render (operator direction 2026-08-30)
        // — never a second, drifting text treatment.
        cell: (info) => (
          <div className="whitespace-nowrap">
            <IssuePriorityDisplay
              priority={info.row.original.requirementPriority ?? null}
            />
          </div>
        ),
        enableSorting: true,
        size: 120,
        minSize: 90,
        maxSize: 200,
      })
    );

    columns.push(
      columnHelper.accessor("requirementStatus", {
        id: "status",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{tCommon("actions.status")}</span>,
        cell: (info) => (
          <IssueStatusDisplay
            status={info.row.original.requirementStatus ?? null}
            className="capitalize"
          />
        ),
        enableSorting: true,
        size: 130,
        minSize: 100,
        maxSize: 220,
      })
    );

    if (hasNotRunTier) {
      columns.push(
        columnHelper.accessor("coverageStatus", {
          id: "coverage",
          enableHiding: false,
          enableGrouping: false,
          header: () => <span>{tCoverage("title")}</span>,
          cell: (info) => (
            <RequirementCoverageStateCell
              status={info.row.original.coverageStatus}
            />
          ),
          enableSorting: true,
          size: 130,
          minSize: 110,
          maxSize: 200,
        })
      );
    }

    if (hasNotRunTier) {
      // Same conditional life as Coverage above: a TRUE gap has zero
      // linked cases by definition, so without the never-ran tier this
      // column is a constant 0. With the tier present it carries the
      // never-run requirements' real link counts.
      columns.push(
        columnHelper.accessor("linkedCases", {
          id: "linkedCases",
          enableHiding: false,
          enableGrouping: false,
          header: () => <span>{t("linkedCases")}</span>,
          cell: (info) => (
            <span className="text-sm tabular-nums">{info.getValue() ?? 0}</span>
          ),
          enableSorting: true,
          size: 110,
          minSize: 90,
          maxSize: 160,
        })
      );
    }

    columns.push(
      columnHelper.accessor("requirementCreatedAt", {
        id: "uncoveredSince",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("uncoveredSince")}</span>,
        cell: (info) => {
          const value = info.getValue();
          if (!value) return null;
          const date = new Date(value);
          return isNaN(date.getTime()) ? null : (
            <span className="text-sm">
              {format(date, "PP", { locale: dateFnsLocale })}
            </span>
          );
        },
        enableSorting: true,
        size: 150,
        minSize: 120,
        maxSize: 220,
      })
    );

    if (onGenerateTestCases) {
      columns.push(
        columnHelper.display({
          id: "actions",
          enableHiding: false,
          enableGrouping: false,
          enableSorting: false,
          enableResizing: false,
          meta: { isPinned: "right" },
          // Sized so the label survives the header's drag handle + padding
          // (60px truncated "Actions" to "A…").
          header: () => <span>{tCommon("actions.actionsLabel")}</span>,
          cell: (info) => (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={tRepo("generateTestCases.buttonText")}
                  data-testid={`requirement-gap-generate-${info.row.original.requirementId}`}
                  onClick={() => onGenerateTestCases(info.row.original)}
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {tRepo("generateTestCases.buttonText")}
              </TooltipContent>
            </Tooltip>
          ),
          size: 100,
          minSize: 80,
          maxSize: 140,
        })
      );
    }

    return columns;
  }, [
    t,
    tCoverage,
    tCommon,
    tRepo,
    dateFnsLocale,
    hasNotRunTier,
    onGenerateTestCases,
    isCrossProject,
  ]);
}

/**
 * The requirement's CLASSIFIED coverage state (the rollup's four-way
 * ladder), repeated on every one of its rows — requirement-level context
 * beside the per-case Result column, so a shared report can answer "is
 * Enrolments covered?" without the reader re-deriving it from the case
 * rows. Reuses the requirements tree's own state vocabulary
 * (`requirements.coverage.*`) and the report's existing treatments: the
 * uncovered badge matches `RequirementResultCell`'s gap branch, not-run
 * matches its muted branch.
 */
function RequirementCoverageStateCell({
  status,
}: {
  status: RequirementTraceabilityReportRow["coverageStatus"];
}) {
  const t = useTranslations("requirements.coverage");

  if (status === "UNCOVERED") {
    return (
      <Badge
        variant="outline"
        data-testid="requirement-report-coverage-uncovered"
        className={cn(
          "whitespace-nowrap border-dashed border-warning bg-warning/15 text-foreground"
        )}
      >
        {t("uncovered")}
      </Badge>
    );
  }
  if (status === "FAILED") {
    return (
      <Badge
        variant="outline"
        data-testid="requirement-report-coverage-failed"
        className="whitespace-nowrap border-destructive/40 bg-destructive/10 text-foreground"
      >
        {t("statusFailed")}
      </Badge>
    );
  }
  if (status === "PASSED") {
    return (
      <Badge
        variant="outline"
        data-testid="requirement-report-coverage-passed"
        className="whitespace-nowrap border-success/40 bg-success/10 text-foreground"
      >
        {t("statusPassed")}
      </Badge>
    );
  }
  return (
    <span
      className="text-muted-foreground italic text-sm"
      data-testid="requirement-report-coverage-not-run"
    >
      {t("statusNotRun")}
    </span>
  );
}

export function useRequirementTraceabilityColumns(
  /**
   * Cross-project variant: prepend the column naming the project each
   * requirement came from. Distinct from the existing "project" column,
   * which names the covering CASE's project.
   */
  isCrossProject = false
): ColumnDef<RequirementTraceabilityReportRow, any>[] {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCoverage = useTranslations("requirements.coverage");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);

  return useMemo(() => {
    const columnHelper = createColumnHelper<RequirementTraceabilityReportRow>();
    const columns: ColumnDef<RequirementTraceabilityReportRow, any>[] = [];

    if (isCrossProject) {
      // The REQUIREMENT's own project. On the traceability variant this
      // sits alongside a "project" column naming the covering case's
      // project -- two different questions, so two different columns.
      columns.push(
        columnHelper.accessor("requirementProjectId", {
          id: "requirementProject",
          enableHiding: false,
          enableGrouping: false,
          header: () => <span>{t("requirementProject")}</span>,
          cell: (info) => {
            const row = info.row.original;
            if (row.requirementProjectId == null) return null;
            return (
              <ProjectNameDisplay
                projectName={row.requirementProjectName ?? ""}
                projectId={row.requirementProjectId}
                showLink
                fitContainer
                className="text-xs text-muted-foreground"
              />
            );
          },
          enableSorting: true,
          size: 160,
          minSize: 120,
          maxSize: 260,
        })
      );
    }

    columns.push(
      columnHelper.accessor("requirementKey", {
        id: "requirement",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("requirement")}</span>,
        // The requirement the report is ABOUT was the one thing in these
        // tables you could not click through to, while every test case
        // beside it linked out. Uses the project-less permalink so both
        // column sets share one cell -- the gap report's hook takes no
        // projectId, and the resolver already owns that lookup.
        cell: (info) => (
          <Link
            href={`/requirement/${info.row.original.requirementId}`}
            className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
            data-testid={`requirement-report-link-${info.row.original.requirementId}`}
          >
            {/* The tree's own icon convention (IssueTypeIcon over
                issueTypeName/iconUrl), so a requirement looks the same
                here as on the requirements page. */}
            <IssueTypeIcon
              fallbackIcon={ClipboardCheck}
              issueTypeName={info.row.original.requirementIssueTypeName}
              iconUrl={info.row.original.requirementIssueTypeIconUrl}
              className="h-4 w-4 shrink-0"
            />
            <span className="min-w-0 truncate">
              {formatRequirementCellText(info.row.original)}
            </span>
          </Link>
        ),
        enableSorting: true,
        size: REQUIREMENT_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    columns.push(
      // Ancestors-only display path — see the gap hook's identical column.
      columnHelper.accessor("requirementParentPath", {
        id: "requirementPath",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("path")}</span>,
        cell: (info) => (
          <div className="min-w-0 truncate text-sm text-muted-foreground">
            {info.getValue()}
          </div>
        ),
        enableSorting: true,
        size: PATH_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    // Same requirement context the gaps report shows, in the same order and
    // through the same display components -- and the columns behind the
    // Priority and Status filters.
    columns.push(
      columnHelper.accessor("requirementPriority", {
        id: "priority",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{tCommon("fields.priority")}</span>,
        cell: (info) => (
          <div className="whitespace-nowrap">
            <IssuePriorityDisplay
              priority={info.row.original.requirementPriority ?? null}
            />
          </div>
        ),
        enableSorting: true,
        size: 120,
        minSize: 90,
        maxSize: 200,
      })
    );

    columns.push(
      columnHelper.accessor("requirementStatus", {
        id: "status",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{tCommon("actions.status")}</span>,
        cell: (info) => (
          <IssueStatusDisplay
            status={info.row.original.requirementStatus ?? null}
            className="capitalize"
          />
        ),
        enableSorting: true,
        size: 130,
        minSize: 100,
        maxSize: 220,
      })
    );
    columns.push(
      columnHelper.accessor("coverageStatus", {
        id: "coverage",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{tCoverage("title")}</span>,
        cell: (info) => (
          <RequirementCoverageStateCell
            status={info.row.original.coverageStatus}
          />
        ),
        enableSorting: true,
        size: 140,
        minSize: 110,
        maxSize: 220,
      })
    );

    columns.push(
      columnHelper.accessor("testCaseId", {
        id: "testCaseId",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("testCase")}</span>,
        cell: (info) => {
          const row = info.row.original;
          if (row.testCaseId == null) return null;
          return (
            <CaseDisplay
              testCase={{
                id: row.testCaseId,
                name: row.testCaseName ?? "",
                // Without these the shared component renders every case
                // as a manual, parameterless one.
                automated: row.testCaseAutomated,
                source: row.testCaseSource ?? undefined,
                hasParameters: row.testCaseHasParameters,
              }}
              projectId={row.caseProjectId ?? undefined}
              size="small"
              // Ellipsize instead of letting a long case name wrap and get
              // clipped by the fixed row height (className lands on the
              // component's own min-w-0 name span).
              className="truncate"
            />
          );
        },
        enableSorting: true,
        size: 260,
        minSize: 180,
        maxSize: 500,
      })
    );

    columns.push(
      columnHelper.accessor("lastStatusName", {
        id: "result",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("result")}</span>,
        cell: (info) => <RequirementResultCell row={info.row.original} />,
        enableSorting: true,
        size: 160,
        minSize: 120,
        maxSize: 260,
      })
    );

    columns.push(
      columnHelper.accessor("lastExecutedAt", {
        id: "executedAt",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("executedAt")}</span>,
        cell: (info) => {
          const value = info.getValue();
          if (!value) return null;
          const date = new Date(value);
          return isNaN(date.getTime()) ? null : (
            <span className="text-sm">
              {format(date, "PPp", { locale: dateFnsLocale })}
            </span>
          );
        },
        enableSorting: true,
        size: 180,
        minSize: 140,
        maxSize: 260,
      })
    );

    // Every covering case names its project, the report's own included —
    // a blank cell is reserved for the gap row (no case at all), so a
    // reader never has to infer "blank means local" (operator direction
    // 2026-08-29, superseding the earlier cross-project-only cell).
    columns.push(
      columnHelper.accessor("caseProjectId", {
        id: "project",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("project")}</span>,
        cell: (info) => {
          const row = info.row.original;
          if (row.caseProjectId == null) return null;
          return (
            <ProjectNameDisplay
              projectName={row.caseProjectName ?? ""}
              projectId={row.caseProjectId}
              showLink
              fitContainer
              className="text-xs text-muted-foreground"
            />
          );
        },
        enableSorting: true,
        size: 160,
        minSize: 120,
        maxSize: 260,
      })
    );

    return columns;
  }, [t, tCoverage, tCommon, dateFnsLocale, isCrossProject]);
}

/**
 * The change-kind cell of the coverage-changes report. Added/removed and
 * a moved coverage state are the consequential kinds and get the
 * report's badge treatment; the two quieter kinds (links, results) and
 * "unchanged" render muted, so a reader scanning the column lands on
 * what matters.
 */
function RequirementChangeKindCell({
  kind,
}: {
  kind: RequirementCoverageChangeReportRow["changeKind"];
}) {
  const t = useTranslations("reports.ui.requirementCoverage");

  switch (kind) {
    case "ADDED":
      return (
        <Badge
          variant="outline"
          data-testid="requirement-change-added"
          className="whitespace-nowrap border-success/40 bg-success/10 text-foreground"
        >
          {t("changeAdded")}
        </Badge>
      );
    case "REMOVED":
      return (
        <Badge
          variant="outline"
          data-testid="requirement-change-removed"
          className="whitespace-nowrap border-dashed border-destructive/40 bg-destructive/10 text-foreground"
        >
          {t("changeRemoved")}
        </Badge>
      );
    case "COVERAGE_CHANGED":
      return (
        <Badge
          variant="outline"
          data-testid="requirement-change-coverage"
          className="whitespace-nowrap border-warning bg-warning/15 text-foreground"
        >
          {t("changeCoverage")}
        </Badge>
      );
    case "LINKS_CHANGED":
      return (
        <span className="text-sm" data-testid="requirement-change-links">
          {t("changeLinks")}
        </span>
      );
    case "RESULTS_CHANGED":
      return (
        <span className="text-sm" data-testid="requirement-change-results">
          {t("changeResults")}
        </span>
      );
    default:
      return (
        <span
          className="text-muted-foreground italic text-sm"
          data-testid="requirement-change-unchanged"
        >
          {t("changeUnchanged")}
        </span>
      );
  }
}

/** A coverage state on one side of the diff; a dash for the side the
 * requirement is absent from (added → no "before", removed → no "after"). */
function RequirementCoverageSideCell({
  status,
}: {
  status: RequirementCoverageChangeReportRow["previousCoverageStatus"];
}) {
  if (status === null || status === undefined) {
    return <span className="text-muted-foreground">{"—"}</span>;
  }
  return <RequirementCoverageStateCell status={status} />;
}

function countCell(value: number | null | undefined): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">{"—"}</span>;
  }
  return <span className="text-sm tabular-nums">{value}</span>;
}

export function useRequirementCoverageChangeColumns(): ColumnDef<
  RequirementCoverageChangeReportRow,
  any
>[] {
  const t = useTranslations("reports.ui.requirementCoverage");

  return useMemo(() => {
    const columnHelper =
      createColumnHelper<RequirementCoverageChangeReportRow>();
    const columns: ColumnDef<RequirementCoverageChangeReportRow, any>[] = [];

    columns.push(
      columnHelper.accessor("requirementKey", {
        id: "requirement",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("requirement")}</span>,
        cell: (info) => (
          <Link
            href={`/requirement/${info.row.original.requirementId}`}
            className="flex min-w-0 items-center gap-1.5 font-medium hover:underline"
            data-testid={`requirement-report-link-${info.row.original.requirementId}`}
          >
            <IssueTypeIcon
              fallbackIcon={ClipboardCheck}
              issueTypeName={info.row.original.requirementIssueTypeName}
              iconUrl={info.row.original.requirementIssueTypeIconUrl}
              className="h-4 w-4 shrink-0"
            />
            <span className="min-w-0 truncate">
              {formatRequirementCellText(info.row.original)}
            </span>
          </Link>
        ),
        enableSorting: true,
        size: REQUIREMENT_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    columns.push(
      columnHelper.accessor("requirementParentPath", {
        id: "requirementPath",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("path")}</span>,
        cell: (info) => (
          <div className="min-w-0 truncate text-sm text-muted-foreground">
            {info.getValue()}
          </div>
        ),
        enableSorting: true,
        size: PATH_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    columns.push(
      columnHelper.accessor("changeKind", {
        id: "change",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("change")}</span>,
        cell: (info) => (
          <RequirementChangeKindCell kind={info.row.original.changeKind} />
        ),
        enableSorting: true,
        size: 160,
        minSize: 120,
        maxSize: 240,
      })
    );

    columns.push(
      columnHelper.accessor("previousCoverageStatus", {
        id: "previousCoverage",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("coverageBefore")}</span>,
        cell: (info) => (
          <RequirementCoverageSideCell
            status={info.row.original.previousCoverageStatus}
          />
        ),
        enableSorting: true,
        size: 150,
        minSize: 110,
        maxSize: 220,
      })
    );

    columns.push(
      columnHelper.accessor("currentCoverageStatus", {
        id: "currentCoverage",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("coverageAfter")}</span>,
        cell: (info) => (
          <RequirementCoverageSideCell
            status={info.row.original.currentCoverageStatus}
          />
        ),
        enableSorting: true,
        size: 150,
        minSize: 110,
        maxSize: 220,
      })
    );

    columns.push(
      columnHelper.accessor("previousLinkedCaseCount", {
        id: "previousLinkedCases",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("linkedCasesBefore")}</span>,
        cell: (info) => countCell(info.getValue()),
        enableSorting: true,
        size: 120,
        minSize: 90,
        maxSize: 180,
      })
    );

    columns.push(
      columnHelper.accessor("currentLinkedCaseCount", {
        id: "currentLinkedCases",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("linkedCasesAfter")}</span>,
        cell: (info) => countCell(info.getValue()),
        enableSorting: true,
        size: 120,
        minSize: 90,
        maxSize: 180,
      })
    );

    columns.push(
      columnHelper.accessor("casesAdded", {
        id: "casesAdded",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("casesAdded")}</span>,
        cell: (info) => countCell(info.getValue()),
        enableSorting: true,
        size: 120,
        minSize: 90,
        maxSize: 180,
      })
    );

    columns.push(
      columnHelper.accessor("casesRemoved", {
        id: "casesRemoved",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("casesRemoved")}</span>,
        cell: (info) => countCell(info.getValue()),
        enableSorting: true,
        size: 130,
        minSize: 90,
        maxSize: 180,
      })
    );

    columns.push(
      columnHelper.accessor("resultsChanged", {
        id: "resultsChanged",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("resultsChanged")}</span>,
        cell: (info) => countCell(info.getValue()),
        enableSorting: true,
        size: 140,
        minSize: 100,
        maxSize: 200,
      })
    );

    return columns;
  }, [t]);
}
