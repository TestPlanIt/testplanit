import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
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
 * The result cell mirrors the PDF exporter's three-way logic
 * (`hooks/pdf/useExportRequirementTraceabilityPdf.ts`) so the two exports of
 * one dataset never disagree about what a blank cell means:
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
      <StatusDotDisplay
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
  rows?: Array<{ coverageStatus?: string }> | null
): ColumnDef<RequirementCoverageGapReportRow, any>[] {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCoverage = useTranslations("requirements.coverage");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const hasNotRunTier = useMemo(
    () => (rows ?? []).some((row) => row?.coverageStatus === "NOT_RUN"),
    [rows]
  );

  return useMemo(() => {
    const columnHelper = createColumnHelper<RequirementCoverageGapReportRow>();
    const columns: ColumnDef<RequirementCoverageGapReportRow, any>[] = [];

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

    return columns;
  }, [t, tCoverage, tCommon, dateFnsLocale, hasNotRunTier]);
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

export function useRequirementTraceabilityColumns(): ColumnDef<
  RequirementTraceabilityReportRow,
  any
>[] {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCoverage = useTranslations("requirements.coverage");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);

  return useMemo(() => {
    const columnHelper = createColumnHelper<RequirementTraceabilityReportRow>();
    const columns: ColumnDef<RequirementTraceabilityReportRow, any>[] = [];

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
            <TestCaseNameDisplay
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
  }, [t, tCoverage, dateFnsLocale]);
}
