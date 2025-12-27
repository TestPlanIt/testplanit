import { ColumnDef } from "@tanstack/react-table";
import { MilestoneTypes, FieldIcon } from "@prisma/client";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { Switch } from "@/components/ui/switch";
import { EditMilestoneTypeModal } from "./EditMilestoneTypes";
import { DeleteMilestoneTypeModal } from "./DeleteMilestoneTypes";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export interface ExtendedMilestoneTypes extends MilestoneTypes {
  projects: {
    projectId: number;
  }[];
  icon?: FieldIcon | null;
}

export const getColumns = (
  session: any,
  handleToggleDefault: (id: number, isDefault: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedMilestoneTypes>[] => [
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
    size: 120,
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <EditMilestoneTypeModal
          key={`edit-${row.original.id}`}
          milestoneType={row.original}
        />
        {row.original.isDefault ? (
          <Button
            variant="ghost"
            className="text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        ) : (
          <DeleteMilestoneTypeModal
            key={`delete-${row.original.id}`}
            milestoneType={row.original}
          />
        )}
      </div>
    ),
  },
];
