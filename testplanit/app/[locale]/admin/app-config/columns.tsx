"use client";

import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { EditAppConfigModal } from "./EditAppConfig";
import { DeleteAppConfigModal } from "./DeleteAppConfig";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppConfigRow } from "./types";

export function getColumns(
  t: ReturnType<typeof useTranslations<"common">>
): ColumnDef<AppConfigRow, unknown>[] {
  const formatValue = (value: any): string => {
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2)
        .replace(/[{]/g, "{\n  ")
        .replace(/[}]/g, "\n}")
        .replace(/,/g, ",\n  ");
    }
    return String(value);
  };

  return [
    {
      id: "key",
      accessorKey: "key",
      header: () => <div>{t("fields.key")}</div>,
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 220,
      cell: ({ row }) => {
        const key = row.original.key;
        const translatedKey = t(`fields.configKeys.${key}` as any);
        return <div>{translatedKey}</div>;
      },
    },
    {
      id: "value",
      accessorKey: "value",
      header: t("fields.value"),
      enableSorting: true,
      enableResizing: true,
      size: 500,
      cell: ({ row }) => {
        const value = row.original.value;
        const displayValue = formatValue(value);
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="font-mono truncate">
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </div>
              </TooltipTrigger>
              <TooltipContent className="w-auto max-w-[500px]">
                <div className="font-mono whitespace-break-spaces">
                  {displayValue}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    },
    {
      id: "actions",
      header: t("actions.actionsLabel"),
      enableResizing: true,
      enableSorting: false,
      enableHiding: false,
      size: 120,
      meta: { isPinned: "right" },
      cell: ({ row }) => (
        <div className="whitespace-nowrap flex justify-center gap-1">
          <EditAppConfigModal config={row.original} />
          <DeleteAppConfigModal config={row.original} />
        </div>
      ),
    },
  ];
}
