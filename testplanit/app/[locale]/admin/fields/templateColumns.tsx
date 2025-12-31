import { ColumnDef } from "@tanstack/react-table";
import { Templates } from "@prisma/client";
import { Switch } from "@/components/ui/switch";
import { EditTemplateModal } from "./EditTemplate";
import { DeleteTemplateModal } from "./DeleteTemplate";
import { CaseFieldListDisplay } from "@/components/tables/CaseFieldListDisplay";
import { ResultFieldListDisplay } from "@/components/tables/ResultFieldListDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export interface ExtendedTemplates extends Templates {
  projects: {
    projectId: number;
    name: string;
  }[];
  caseFields: {
    caseFieldId: number;
    name: string;
  }[];
  resultFields: {
    resultFieldId: number;
    name: string;
  }[];
}

export const getColumns = (
  tCommon: ReturnType<typeof useTranslations<"common">>,
  session: any,
  handleToggleEnabled: (id: number, isEnabled: boolean) => void,
  handleToggleDefault: (id: number, isDefault: boolean) => void
): ColumnDef<ExtendedTemplates>[] => {
  return [
    {
      id: "templateName",
      accessorKey: "templateName",
      header: tCommon("name"),
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 500,
      cell: ({ row }) => row.original.templateName,
    },
    {
      id: "caseFields",
      accessorKey: "caseFields",
      header: tCommon("fields.caseFields"),
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <CaseFieldListDisplay caseFields={row.original.caseFields} />
        </div>
      ),
    },
    {
      id: "resultFields",
      accessorKey: "resultFields",
      header: tCommon("fields.resultFields"),
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <ResultFieldListDisplay resultFields={row.original.resultFields} />
        </div>
      ),
    },
    {
      id: "projects",
      accessorKey: "projects",
      header: tCommon("fields.projects"),
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <ProjectListDisplay projects={row.original.projects} />
        </div>
      ),
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
          <EditTemplateModal
            key={`edit-${row.original.id}`}
            template={row.original as any}
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
            <DeleteTemplateModal
              key={`delete-${row.original.id}`}
              template={row.original}
            />
          )}
        </div>
      ),
    },
  ];
};
