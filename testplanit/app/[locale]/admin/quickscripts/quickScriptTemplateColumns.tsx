import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CaseExportTemplate } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { DeleteQuickScriptTemplateModal } from "./DeleteQuickScriptTemplate";
import { EditQuickScriptTemplateModal } from "./EditQuickScriptTemplate";

export const getColumns = (
  t: ReturnType<typeof useTranslations<"admin.exportTemplates">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  handleToggleEnabled: (id: number, isEnabled: boolean) => void,
  handleToggleDefault: (id: number, isDefault: boolean) => void
): ColumnDef<CaseExportTemplate>[] => {
  return [
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
          <EditQuickScriptTemplateModal
            key={`edit-${row.original.id}`}
            template={row.original}
          />
          {row.original.isDefault ? (
            <Button
              variant="ghost"
              className="px-2 py-1 h-auto text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          ) : (
            <DeleteQuickScriptTemplateModal
              key={`delete-${row.original.id}`}
              template={row.original}
            />
          )}
        </div>
      ),
    },
  ];
};
