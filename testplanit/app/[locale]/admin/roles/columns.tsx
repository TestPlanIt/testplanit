import { ColumnDef } from "@tanstack/react-table";
import { Roles } from "@prisma/client";
import { Switch } from "@/components/ui/switch";
import { EditRoleModal } from "./EditRoles";
import { DeleteRoleModal } from "./DeleteRoles";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { RoleNameCell } from "~/components/tables/RoleNameCell";
import { UserListDisplay } from "~/components/tables/UserListDisplay";

export interface ExtendedRoles extends Roles {
  users: {
    name: string;
    id: string;
    image: string;
  }[];
}

export const getColumns = (
  session: any,
  handleToggleDefault: (id: number, isDefault: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedRoles>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: tCommon("name"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 500,
    cell: ({ row }) => <RoleNameCell roleId={row.original.id.toString()} />,
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
    id: "assignedUsers",
    header: tCommon("fields.users"),
    enableSorting: false,
    enableResizing: true,
    size: 75,
    cell: ({ row }) => {
      const users = row.original.users;
      const mappedUsers = users
        ? users.map((user) => ({ userId: user.id }))
        : [];
      return <UserListDisplay users={mappedUsers} />;
    },
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
        <EditRoleModal key={`edit-${row.original.id}`} role={row.original} />
        {row.original.isDefault ? (
          <Button
            variant="ghost"
            className="text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        ) : (
          <DeleteRoleModal
            key={`delete-${row.original.id}`}
            role={row.original}
          />
        )}
      </div>
    ),
  },
];
