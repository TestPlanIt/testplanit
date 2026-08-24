import { Badge } from "@/components/ui/badge";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { cn } from "~/utils";
import { formatRequirementCellText } from "~/utils/issueDisplayText";
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

export function useRequirementCoverageGapColumns(): ColumnDef<
  RequirementCoverageGapReportRow,
  any
>[] {
  const t = useTranslations("reports.ui.requirementCoverage");

  return useMemo(() => {
    const columnHelper = createColumnHelper<RequirementCoverageGapReportRow>();
    const columns: ColumnDef<RequirementCoverageGapReportRow, any>[] = [];

    columns.push(
      columnHelper.accessor("requirementKey", {
        id: "requirement",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("requirement")}</span>,
        cell: (info) => (
          <span className="font-medium">
            {formatRequirementCellText(info.row.original)}
          </span>
        ),
        enableSorting: true,
        size: REQUIREMENT_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    columns.push(
      columnHelper.accessor("requirementPath", {
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

    return columns;
  }, [t]);
}

export function useRequirementTraceabilityColumns(
  projectId?: number | string
): ColumnDef<RequirementTraceabilityReportRow, any>[] {
  const t = useTranslations("reports.ui.requirementCoverage");
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
        cell: (info) => (
          <span className="font-medium">
            {formatRequirementCellText(info.row.original)}
          </span>
        ),
        enableSorting: true,
        size: REQUIREMENT_COLUMN_SIZE,
        minSize: 200,
        maxSize: 500,
      })
    );

    columns.push(
      columnHelper.accessor("requirementPath", {
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
              testCase={{ id: row.testCaseId, name: row.testCaseName ?? "" }}
              projectId={row.caseProjectId ?? undefined}
              size="small"
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

    // Cross-project cell: only rendered when the covering case lives in a
    // DIFFERENT project than the report's own `projectId`, matching what
    // 26-09's RequirementCoveragePanel does for the identical inherited-case
    // situation -- a case that lives in the same project as the requirement
    // never shows a badge.
    columns.push(
      columnHelper.accessor("caseProjectId", {
        id: "project",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("project")}</span>,
        cell: (info) => {
          const row = info.row.original;
          if (row.caseProjectId == null) return null;
          const crossProject =
            projectId != null &&
            !isNaN(Number(projectId)) &&
            row.caseProjectId !== Number(projectId);
          if (!crossProject) return null;
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
  }, [t, projectId, dateFnsLocale]);
}
