import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Roles } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import { SquarePen, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { RoleNameCell } from "~/components/tables/RoleNameCell";
import { UserListDisplay } from "~/components/tables/UserListDisplay";

export interface ExtendedRoles extends Roles {
  users: {
    name: string;
    id: string;
    image: string;
  }[];
}

export const useColumns = (
  handleToggleDefault: (id: number, isDefault: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  onEditRole?: (role: ExtendedRoles) => void,
  onDeleteRole?: (role: ExtendedRoles) => void
): ColumnDef<ExtendedRoles>[] =>
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
        id: "assignedUsers",
        header: tCommon("fields.users"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
        cell: ({ row }) => (
          <UserListDisplay filter={{ roleId: row.original.id }} />
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
          <div className="bg-primary-foreground whitespace-nowrap flex justify-end gap-1">
            <Button
              variant="ghost"
              className="px-2 py-1 h-auto"
              onClick={() => onEditRole?.(row.original)}
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
                <Trash className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="px-2 py-1 h-auto"
                onClick={() => onDeleteRole?.(row.original)}
                aria-label={tCommon("actions.delete")}
              >
                <Trash className="h-5 w-5" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [tCommon, handleToggleDefault, onEditRole, onDeleteRole]
  );
