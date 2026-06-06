import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import { Button } from "@/components/ui/button";
import { Groups } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { SquarePen, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { GroupNameCell } from "~/components/tables/GroupNameCell";

export interface ExtendedGroups extends Groups {
  assignedUsers: {
    userId: string;
  }[];
  projectPermissions: {
    projectId: number;
  }[];
}

export const useColumns = (
  t: ReturnType<typeof useTranslations<"common">>,
  onEditGroup?: (group: ExtendedGroups) => void,
  onDeleteGroup?: (group: ExtendedGroups) => void
): ColumnDef<ExtendedGroups>[] =>
  useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        accessorFn: (row) => row.name,
        header: t("fields.groupName"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        size: 500,
        meta: { isPinned: "left" },
        cell: ({ row }) => (
          <GroupNameCell groupId={row.original.id.toString()} />
        ),
      },
      {
        id: "users",
        accessorKey: "users",
        accessorFn: (row) => row.assignedUsers,
        header: t("fields.users"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
        cell: ({ row }) => (
          <div className="text-center">
            <UserListDisplay users={row.original.assignedUsers} />
          </div>
        ),
      },
      {
        id: "projects",
        accessorKey: "projects",
        accessorFn: (row) => row.projectPermissions,
        header: t("fields.projects"),
        enableSorting: false,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <ProjectListDisplay projects={row.original.projectPermissions} />
          </div>
        ),
      },
      {
        id: "actions",
        header: t("actions.actionsLabel"),
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
              onClick={() => onEditGroup?.(row.original)}
              aria-label={t("actions.edit")}
            >
              <SquarePen className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              className="px-2 py-1 h-auto"
              onClick={() => onDeleteGroup?.(row.original)}
              aria-label={t("actions.delete")}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>
        ),
      },
    ],
    [t, onEditGroup, onDeleteGroup]
  );
