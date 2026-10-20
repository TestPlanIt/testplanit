"use client";

import { ColumnDef } from "@/components/tables/tableFeatures";
import { ClassificationOption } from "@/components/triage/badges";
import { SignaturesListDisplay } from "@/components/triage/SignaturesListDisplay";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GripVertical, SquarePen, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ClassificationRow } from "./types";

export const useColumns = (
  tCommon: ReturnType<typeof useTranslations<"common">>,
  tAdmin: ReturnType<typeof useTranslations<"admin.rootCauses">>,
  onEdit: (row: ClassificationRow) => void,
  onDelete: (row: ClassificationRow) => void
): ColumnDef<ClassificationRow>[] =>
  useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: false,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 260,
        cell: ({ row }) => (
          <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
            <GripVertical
              className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground"
              aria-hidden
            />
            <ClassificationOption
              classification={row.original}
              className="min-w-0"
            />
          </div>
        ),
      },
      {
        id: "description",
        accessorKey: "description",
        header: tCommon("fields.description"),
        enableSorting: false,
        enableResizing: true,
        size: 620,
        cell: ({ row }) =>
          row.original.description ? (
            <span
              className="block truncate text-muted-foreground"
              title={row.original.description}
            >
              {row.original.description}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "signatures",
        accessorFn: (row) => row._count.signatures,
        header: tAdmin("columns.signatures"),
        enableSorting: false,
        enableResizing: true,
        size: 120,
        cell: ({ row }) => (
          <div className="flex justify-center">
            {row.original._count.signatures > 0 ? (
              <SignaturesListDisplay
                filter={{ classificationId: row.original.id }}
                count={row.original._count.signatures}
              />
            ) : (
              <span className="text-muted-foreground">{"0"}</span>
            )}
          </div>
        ),
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 100,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={tCommon("actions.edit")}
                  onClick={() => onEdit(row.original)}
                  data-testid="failure-classification-edit"
                >
                  <SquarePen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tCommon("actions.edit")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={tCommon("actions.delete")}
                  onClick={() => onDelete(row.original)}
                  data-testid="failure-classification-delete"
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{tCommon("actions.delete")}</TooltipContent>
            </Tooltip>
          </div>
        ),
      },
    ],
    [tCommon, tAdmin, onEdit, onDelete]
  );
