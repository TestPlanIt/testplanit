"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ColumnDef } from "@tanstack/react-table";
import { Edit, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppConfigRow } from "./types";

/**
 * Title-case a snake_case config key ("record_key_enabled" -> "Record Key
 * Enabled"). Used as a fallback when a key has no `common.fields.configKeys.*`
 * translation, so a new config key never shows its raw i18n path in the UI.
 */
function humanizeConfigKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getColumns(
  t: ReturnType<typeof useTranslations<"common">>,
  onEditConfig?: (config: AppConfigRow) => void,
  onDeleteConfig?: (config: AppConfigRow) => void
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
      size: 220,
      cell: ({ row }) => {
        const key = row.original.key;
        const translatedKey = t(`fields.configKeys.${key}` as any);
        // A missing translation makes next-intl echo the raw key path; fall back
        // to a humanized label so an untranslated config key never leaks its
        // i18n path into the UI.
        const label = translatedKey.includes("configKeys.")
          ? humanizeConfigKey(key)
          : translatedKey;
        return <div>{label}</div>;
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
        );
      },
    },
    {
      id: "actions",
      header: t("actions.actionsLabel"),
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      size: 96,
      minSize: 96,
      cell: ({ row }) => (
        <div className="whitespace-nowrap flex justify-center gap-1">
          <Button
            variant="ghost"
            className="px-2 py-1 h-auto"
            data-testid="edit-config-button"
            aria-label={t("actions.edit")}
            onClick={() => onEditConfig?.(row.original)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            className="px-2 py-1 h-auto"
            data-testid="delete-config"
            aria-label={t("actions.delete")}
            onClick={() => onDeleteConfig?.(row.original)}
          >
            <Trash className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];
}
