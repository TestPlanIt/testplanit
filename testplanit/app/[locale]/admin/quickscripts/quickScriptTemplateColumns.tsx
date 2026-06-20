import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { CaseExportTemplate } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import { Edit, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export const useColumns = (
  t: ReturnType<typeof useTranslations<"admin.exportTemplates">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  handleToggleEnabled: (id: number, isEnabled: boolean) => void,
  handleToggleDefault: (id: number, isDefault: boolean) => void,
  onEditTemplate?: (template: CaseExportTemplate) => void,
  onDeleteTemplate?: (template: CaseExportTemplate) => void
): ColumnDef<CaseExportTemplate>[] => {
  return useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 300,
        cell: ({ row }) => row.original.name,
      },
      {
        id: "category",
        accessorKey: "category",
        header: t("fields.category"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => row.original.category,
      },
      {
        id: "fileExtension",
        accessorKey: "fileExtension",
        header: t("fields.fileExtension"),
        enableSorting: true,
        enableResizing: true,
        size: 120,
        cell: ({ row }) => (
          <code className="text-sm">{row.original.fileExtension}</code>
        ),
      },
      {
        id: "language",
        accessorKey: "language",
        header: tCommon("fields.locale"),
        enableSorting: true,
        enableResizing: true,
        size: 120,
        cell: ({ row }) => row.original.language,
      },
      {
        id: "isEnabled",
        accessorKey: "isEnabled",
        header: tCommon("fields.enabled"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              aria-label={tCommon("fields.enabled")}
              checked={row.original.isEnabled}
              onCheckedChange={(checked) =>
                handleToggleEnabled(row.original.id, checked)
              }
              disabled={row.original.isDefault}
            />
          </div>
        ),
      },
      {
        id: "isDefault",
        accessorKey: "isDefault",
        header: tCommon("fields.default"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              aria-label={tCommon("fields.default")}
              checked={row.original.isDefault}
              disabled={row.original.isDefault}
              onCheckedChange={(checked) =>
                handleToggleDefault(row.original.id, checked)
              }
            />
          </div>
        ),
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableResizing: true,
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 80,
        cell: ({ row }) => (
          <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
            <Button
              variant="outline"
              className="px-2 py-1 h-auto"
              data-testid="edit-export-template-button"
              onClick={() => onEditTemplate?.(row.original)}
              aria-label={tCommon("actions.edit")}
            >
              <Edit className="h-5 w-5" />
            </Button>
            {row.original.isDefault ? (
              <Button
                variant="ghost"
                className="px-2 py-1 h-auto text-muted-foreground cursor-not-allowed"
                disabled
                aria-label={tCommon("actions.delete")}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="px-2 py-1 h-auto"
                data-testid="delete-export-template-button"
                onClick={() => onDeleteTemplate?.(row.original)}
                aria-label={tCommon("actions.delete")}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [
      t,
      tCommon,
      handleToggleEnabled,
      handleToggleDefault,
      onEditTemplate,
      onDeleteTemplate,
    ]
  );
};
