import DynamicIcon from "@/components/DynamicIcon";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FieldIcon, MilestoneTypes } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { SquarePen, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { IconName } from "~/types/globals";

export interface ExtendedMilestoneTypes extends MilestoneTypes {
  projects: {
    projectId: number;
  }[];
  icon?: FieldIcon | null;
}

export const useColumns = (
  handleToggleDefault: (id: number, isDefault: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  onEditMilestoneType?: (milestoneType: ExtendedMilestoneTypes) => void,
  onDeleteMilestoneType?: (milestoneType: ExtendedMilestoneTypes) => void
): ColumnDef<ExtendedMilestoneTypes>[] =>
  useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 500,
        cell: ({ row }) => (
          <div className="flex space-x-2 items-center">
            <div>
              {row.original.icon?.name && (
                <DynamicIcon name={row.original.icon.name as IconName} />
              )}
            </div>
            <div>{row.original.name}</div>
          </div>
        ),
      },
      {
        id: "projects",
        accessorKey: "projects",
        header: tCommon("fields.projects"),
        enableResizing: true,
        enableSorting: false,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <ProjectListDisplay projects={row.original.projects} />
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
              variant="ghost"
              className="px-2 py-1 h-auto"
              onClick={() => onEditMilestoneType?.(row.original)}
              aria-label={tCommon("actions.edit")}
            >
              <SquarePen className="h-5 w-5" />
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
                onClick={() => onDeleteMilestoneType?.(row.original)}
                aria-label={tCommon("actions.delete")}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [tCommon, handleToggleDefault, onEditMilestoneType, onDeleteMilestoneType]
  );
