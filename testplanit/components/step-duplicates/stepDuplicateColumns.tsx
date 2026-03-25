import React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";

export interface StepDuplicateRow {
  id: number;
  name: string;
  stepCount: number;
  fingerprint: string;
  matchedStepsPreview: string;
  casesCount: number;
  caseNames: string[];
  status: string;
}

export const getColumns = (
  t: ReturnType<typeof useTranslations<"sharedSteps.stepDuplicates">>,
  onCheckboxClick?: (rowIndex: number, event: React.MouseEvent) => void,
  onSelectAllClick?: (event: React.MouseEvent) => void
): ColumnDef<StepDuplicateRow>[] => [
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
        aria-label="Select all"
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
        aria-label="Select row"
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
    id: "stepCount",
    accessorKey: "stepCount",
    header: t("columns.stepCount"),
    enableSorting: true,
    enableResizing: true,
    size: 80,
    cell: ({ row }) => (
      <span className="text-right block font-medium">
        {row.original.stepCount}
      </span>
    ),
  },
  {
    id: "matchedStepsPreview",
    accessorKey: "matchedStepsPreview",
    header: t("columns.matchedSteps"),
    enableSorting: false,
    enableResizing: true,
    minSize: 200,
    size: 600,
    maxSize: 1200,
    cell: ({ row, column }) => (
      <span
        className="text-muted-foreground text-sm truncate block"
        style={{ maxWidth: column.getSize() }}
      >
        {row.original.matchedStepsPreview}
      </span>
    ),
  },
  {
    id: "casesCount",
    accessorKey: "casesCount",
    header: t("columns.casesCount"),
    enableSorting: true,
    enableResizing: true,
    size: 80,
    cell: ({ row }) => (
      <Badge variant="secondary">{row.original.casesCount}</Badge>
    ),
  },
  {
    id: "actions",
    header: t("columns.actions"),
    enableSorting: false,
    enableResizing: true,
    enableHiding: false,
    size: 100,
    maxSize: 120,
    cell: () => <div />,
  },
];
