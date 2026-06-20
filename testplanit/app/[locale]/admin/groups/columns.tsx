import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Groups } from "~/zenstack/models";
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
  tGroups: ReturnType<typeof useTranslations<"admin.groups">>,
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
        cell: ({ row }) => {
          const isScimManaged = row.original.scimDisplayName !== null;
          return (
            <div className="flex items-center gap-1">
              <GroupNameCell groupId={row.original.id.toString()} />
              {isScimManaged && (
                <Badge
                  variant="secondary"
                  className="ml-1"
                  title={tGroups("scimManagedTooltip")}
                  data-testid="scim-managed-group-badge"
                >
                  {tGroups("scimManagedBadge")}
                </Badge>
              )}
            </div>
          );
        },
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
        id: "mappedAccess",
        accessorKey: "mappedAccess",
        accessorFn: (row) => row.mappedAccess,
        header: tGroups("mappedAccessColumnHeader"),
        enableSorting: false,
        enableResizing: true,
        size: 140,
        cell: ({ row }) => {
          const access = row.original.mappedAccess;
          if (!access) {
            return (
              <span className="text-muted-foreground text-sm">
                {tGroups("mappedAccessNone")}
              </span>
            );
          }
          return (
            <Badge variant="secondary" data-testid="mapped-access-badge">
              {access}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: t("actions.actionsLabel"),
        enableResizing: true,
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 80,
        cell: ({ row }) => {
          const isScimManaged = row.original.scimDisplayName !== null;
          const deleteButton = (
            <Button
              variant="destructive"
              className="px-2 py-1 h-auto"
              onClick={() => onDeleteGroup?.(row.original)}
              disabled={isScimManaged}
              aria-label={t("actions.delete")}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          );
          return (
            <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
              <Button
                variant="ghost"
                className="px-2 py-1 h-auto"
                onClick={() => onEditGroup?.(row.original)}
                aria-label={t("actions.edit")}
              >
                <SquarePen className="h-4 w-4" />
              </Button>
              {isScimManaged ? (
                <Tooltip>
                  {/* span wrapper: disabled buttons don't fire pointer events,
                     so the tooltip would never show without this. */}
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>{deleteButton}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{tGroups("scimManagedTooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                deleteButton
              )}
            </div>
          );
        },
      },
    ],
    [t, tGroups, onEditGroup, onDeleteGroup]
  );
