import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ColumnDef,
  createColumnHelper,
} from "@/components/tables/tableFeatures";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  ROOT_DIRECTORY,
  type CodePinCoverageRow,
} from "~/utils/codePinCoverageShared";

export function useCodePinCoverageColumns(
  projectId?: number | string,
  dimensions?: string[],
  isCrossProject?: boolean
): ColumnDef<CodePinCoverageRow, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const tCoverage = useTranslations("reports.ui.codePinCoverage");
  const columnHelper = createColumnHelper<CodePinCoverageRow>();

  return useMemo(() => {
    const columns: ColumnDef<CodePinCoverageRow, any>[] = [];

    if (dimensions?.includes("project") || (isCrossProject && !projectId)) {
      columns.push(
        columnHelper.accessor((row) => row.project?.name ?? "", {
          id: "project",
          header: () => <span>{tCommon("fields.project")}</span>,
          cell: (info) => (
            <span className="font-medium">
              {info.row.original.project?.name || tCommon("labels.unknown")}
            </span>
          ),
          enableSorting: true,
          size: 180,
          minSize: 120,
          maxSize: 400,
        }) as ColumnDef<CodePinCoverageRow, any>
      );
    }

    columns.push(
      columnHelper.accessor((row) => row.repository.name, {
        id: "repository",
        header: () => <span>{tCommon("pageTitles.repository")}</span>,
        cell: (info) => (
          <CodeRepositoryName
            name={info.row.original.repository.name}
            provider={info.row.original.repository.provider}
            branch={info.row.original.repository.branch}
          />
        ),
        enableSorting: true,
        size: 280,
        minSize: 180,
        maxSize: 480,
      }) as ColumnDef<CodePinCoverageRow, any>
    );

    columns.push(
      columnHelper.accessor("directory", {
        id: "directory",
        header: () => <span>{tCoverage("directory")}</span>,
        cell: (info) => (
          <code className="text-xs">
            {info.getValue() === ROOT_DIRECTORY
              ? tCoverage("rootDirectory")
              : info.getValue()}
          </code>
        ),
        enableSorting: true,
        size: 240,
        minSize: 140,
        maxSize: 500,
      }) as ColumnDef<CodePinCoverageRow, any>
    );

    columns.push(
      columnHelper.accessor("pinCount", {
        id: "pinCount",
        header: () => <span>{t("repository.codePins.title")}</span>,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tabular-nums">{row.pinCount}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <div className="text-xs">
                  {tCoverage("kindBreakdown", {
                    file: row.kindCounts.FILE,
                    range: row.kindCounts.RANGE,
                    symbol: row.kindCounts.SYMBOL,
                    glob: row.kindCounts.GLOB,
                  })}
                </div>
                <div className="text-xs">
                  {tCoverage("sourceBreakdown", {
                    manual: row.sourceCounts.MANUAL,
                    ai: row.sourceCounts.AI,
                    annotation: row.sourceCounts.ANNOTATION,
                    mapfile: row.sourceCounts.MAPFILE,
                    issue: row.sourceCounts.ISSUE,
                  })}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        },
        enableSorting: true,
        size: 170,
        minSize: 140,
        maxSize: 240,
      }) as ColumnDef<CodePinCoverageRow, any>
    );

    const countColumn = (
      id: "caseCount" | "stalePinCount" | "uncoveredAnalysisCount",
      header: string
    ) =>
      columnHelper.accessor(id, {
        id,
        header: () => <span>{header}</span>,
        cell: (info) => (
          <span className="tabular-nums">{String(info.getValue() ?? 0)}</span>
        ),
        enableSorting: true,
        size: 210,
        minSize: 160,
        maxSize: 280,
      }) as ColumnDef<CodePinCoverageRow, any>;
    columns.push(
      countColumn("caseCount", tCoverage("casesWithPins")),
      countColumn("stalePinCount", tCoverage("stalePins"))
    );

    columns.push(
      columnHelper.accessor("uncoveredFileCount", {
        id: "uncoveredFileCount",
        header: () => <span>{tCoverage("uncoveredFiles")}</span>,
        cell: (info) => {
          const row = info.row.original;
          if (row.uncoveredFileCount === 0) {
            return <span className="tabular-nums">{"0"}</span>;
          }
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tabular-nums">{row.uncoveredFileCount}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <ul className="space-y-0.5 text-xs">
                  {row.sampleUncoveredFiles.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          );
        },
        enableSorting: true,
        size: 250,
        minSize: 190,
        maxSize: 320,
      }) as ColumnDef<CodePinCoverageRow, any>
    );

    columns.push(
      countColumn(
        "uncoveredAnalysisCount",
        t("reports.ui.impactAnalysis.stats.analyses")
      )
    );

    return columns;
  }, [
    projectId,
    dimensions,
    isCrossProject,
    t,
    tCommon,
    tCoverage,
    columnHelper,
  ]);
}
