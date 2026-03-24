import React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { ColumnDef } from "@tanstack/react-table";
import { RepositoryCaseSource } from "@prisma/client";
import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ConfidenceBucket,
  scoreToConfidence,
} from "~/lib/utils/similarity";

export interface DuplicateCandidateRow {
  id: number;
  name: string;
  projectId: number;
  caseAId: number;
  caseAName: string;
  caseASource: string;
  caseAAutomated: boolean;
  caseBId: number;
  caseBName: string;
  caseBSource: string;
  caseBAutomated: boolean;
  score: number;
  matchedFields: string[];
  status: string;
}

function ConfidenceBadge({
  score,
  tPriority,
}: {
  score: number;
  tPriority: ReturnType<typeof useTranslations<"common.priority">>;
}) {
  const confidence: ConfidenceBucket | null = scoreToConfidence(score);
  if (!confidence) return null;

  if (confidence === "HIGH") {
    return <Badge variant="destructive">{tPriority("high")}</Badge>;
  }
  if (confidence === "MEDIUM") {
    return <Badge variant="default">{tPriority("medium")}</Badge>;
  }
  return <Badge variant="secondary">{tPriority("low")}</Badge>;
}

export const getColumns = (
  t: ReturnType<typeof useTranslations<"repository.duplicates">>,
  tPriority: ReturnType<typeof useTranslations<"common.priority">>,
  onCheckboxClick?: (rowIndex: number, event: React.MouseEvent) => void,
  onSelectAllClick?: (event: React.MouseEvent) => void
): ColumnDef<DuplicateCandidateRow>[] => [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => {
          if (!onSelectAllClick) table.toggleAllPageRowsSelected(!!value);
        }}
        onClick={(e) => onSelectAllClick?.(e)}
        aria-label={t("selectAll")}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => {
          if (!onCheckboxClick) row.toggleSelected(!!value);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onCheckboxClick?.(row.index, e);
        }}
        aria-label={t("selectRow")}
      />
    ),
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    size: 40,
    maxSize: 40,
    minSize: 40,
    meta: { isPinned: "left" },
  },
  {
    id: "confidence",
    accessorKey: "score",
    header: t("columnConfidence"),
    enableSorting: true,
    enableResizing: true,
    size: 120,
    cell: ({ row }) => (
      <ConfidenceBadge score={row.original.score} tPriority={tPriority} />
    ),
  },
  {
    id: "caseA",
    accessorKey: "caseAName",
    header: t("columnCaseA"),
    enableSorting: true,
    enableResizing: true,
    size: 300,
    maxSize: 800,
    cell: ({ row, column }) => (
      <div
        className="overflow-hidden min-w-0 [&_*]:min-w-0 [&_span]:truncate [&_span]:whitespace-nowrap [&_span]:overflow-hidden [&_span]:block"
        style={{ maxWidth: column.getSize() }}
      >
        <CaseDisplay
          id={row.original.caseAId}
          name={row.original.caseAName}
          source={row.original.caseASource as RepositoryCaseSource}
          automated={row.original.caseAAutomated}
          maxLines={1}
        />
      </div>
    ),
  },
  {
    id: "caseB",
    accessorKey: "caseBName",
    header: t("columnCaseB"),
    enableSorting: true,
    enableResizing: true,
    size: 300,
    maxSize: 800,
    cell: ({ row, column }) => (
      <div
        className="overflow-hidden min-w-0 [&_*]:min-w-0 [&_span]:truncate [&_span]:whitespace-nowrap [&_span]:overflow-hidden [&_span]:block"
        style={{ maxWidth: column.getSize() }}
      >
        <CaseDisplay
          id={row.original.caseBId}
          name={row.original.caseBName}
          source={row.original.caseBSource as RepositoryCaseSource}
          automated={row.original.caseBAutomated}
          maxLines={1}
        />
      </div>
    ),
  },
  {
    id: "matchedFields",
    accessorKey: "matchedFields",
    header: t("columnMatchedFields"),
    enableSorting: true,
    enableResizing: true,
    size: 200,
    cell: ({ row }) => row.original.matchedFields.join(", "),
  },
  {
    id: "score",
    accessorKey: "score",
    header: t("columnScore"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <span className="text-right block">
        {(row.original.score * 100).toFixed(2)}
        {"%"}
      </span>
    ),
  },
  {
    id: "actions",
    header: t("compareButton"),
    enableSorting: false,
    enableResizing: true,
    enableHiding: false,
    size: 100,
    maxSize: 120,
    cell: () => (
      <span className="shrink-0 flex items-center gap-1">
        <ArrowRightLeft className="h-4 w-4" />
        <span className="text-xs">{t("compareButton")}</span>
      </span>
    ),
  },
];
