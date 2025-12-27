import { ColumnDef } from "@tanstack/react-table";
import { Groups } from "@prisma/client";
import { EditGroupModal } from "./EditGroup";
import { DeleteGroupModal } from "./DeleteGroup";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import { useTranslations } from "next-intl";
import { GroupNameCell } from "~/components/tables/GroupNameCell";

export interface ExtendedGroups extends Groups {
  assignedUsers: {
    userId: string;
  }[];
}

export const getColumns = (
  t: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedGroups>[] => [
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
    cell: ({ row }) => <GroupNameCell groupId={row.original.id.toString()} />,
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
    id: "actions",
    header: t("actions.actionsLabel"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    meta: { isPinned: "right" },
    size: 120,
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <EditGroupModal key={`edit-${row.original.id}`} group={row.original} />
        <DeleteGroupModal
          key={`delete-${row.original.id}`}
          group={row.original}
        />
      </div>
    ),
  },
];
