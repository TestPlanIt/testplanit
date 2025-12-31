import { ColumnDef } from "@tanstack/react-table";
import { ExtendedWorkflows } from "~/types/Workflows";
import { EditWorkflowsModal } from "./EditWorkflow";
import { DeleteWorkflowsModal } from "./DeleteWorkflow";
import { Switch } from "@/components/ui/switch";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { WorkflowScope } from "@prisma/client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Trash2, GripVertical } from "lucide-react";

// Helper function to check if a workflow is the last of its type in its scope
const isLastWorkflowOfType = (
  workflow: ExtendedWorkflows,
  allWorkflows: ExtendedWorkflows[]
): boolean => {
  const sameTypeAndScope = allWorkflows.filter(
    (w) =>
      w.scope === workflow.scope &&
      w.workflowType === workflow.workflowType &&
      !w.isDeleted
  );
  return sameTypeAndScope.length === 1;
};

export const getColumns = (
  workflows: ExtendedWorkflows[],
  t: ReturnType<typeof useTranslations<"common">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  handleToggleEnabled: (id: number, isEnabled: boolean) => void,
  handleToggleDefault: (
    id: number,
    isDefault: boolean,
    scope: WorkflowScope
  ) => void
): ColumnDef<ExtendedWorkflows>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: tCommon("fields.state"),
    enableSorting: false,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 500,
    cell: ({ row }) => (
      <div className="relative flex items-center gap-1 group/row">
        <GripVertical className="absolute -left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity cursor-grab" />
        <DynamicIcon
          name={row.original.icon.name as IconName}
          color={row.original.color.value}
        />
        <span>{row.original.name}</span>
      </div>
    ),
  },
  {
    id: "workflowType",
    accessorKey: "workflowType",
    header: tCommon("fields.type"),
    enableSorting: false,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        {t(`types.${row.original.workflowType}` as any)}
      </div>
    ),
  },
  {
    id: "isDefault",
    accessorKey: "isDefault",
    header: tCommon("fields.default"),
    enableSorting: false,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        <Switch
          checked={row.original.isDefault}
          disabled={row.original.isDefault}
          onCheckedChange={(checked) =>
            handleToggleDefault(row.original.id, checked, row.original.scope)
          }
        />
      </div>
    ),
  },
  {
    id: "isEnabled",
    accessorKey: "isEnabled",
    header: tCommon("fields.enabled"),
    enableSorting: false,
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
    id: "projects",
    accessorKey: "projects",
    header: tCommon("fields.projects"),
    enableSorting: false,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        <ProjectListDisplay
          projects={row.original.projects.map((p) => ({
            projectId: p.projectId,
            name: p.project.name,
          }))}
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
    cell: ({ row }) => {
      const workflow = row.original;
      const canDelete =
        !isLastWorkflowOfType(workflow, workflows) && !workflow.isDefault;
      return (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          <EditWorkflowsModal workflows={workflow} allWorkflows={workflows} />
          {canDelete ? (
            <DeleteWorkflowsModal workflows={workflow} />
          ) : (
            <Button
              variant="ghost"
              className="px-2 py-1 h-auto text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}
        </div>
      );
    },
  },
];
