import { ColumnDef } from "@tanstack/react-table";
import { User } from "@prisma/client";
import { useTranslations } from "next-intl";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { EmailCell } from "@/components/EmailDisplay";
import { AccessLevelDisplay } from "@/components/tables/AccessLevelDisplay";
import { UserProjectsDisplay } from "@/components/tables/UserProjectsDisplay";
import { GroupListDisplay } from "@/components/tables/GroupListDisplay";
import { DateFormatter } from "@/components/DateFormatter";
import { Switch } from "@/components/ui/switch";
import { EditUserModal } from "./EditUser";
import { DeleteUserModal } from "./DeleteUser";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { RoleNameCell } from "@/components/tables/RoleNameCell";
import { LastActiveDisplay } from "~/components/LastActiveDisplay";
export interface ExtendedUser extends User {
  createdBy: {
    name: string;
    id: string;
    image: string | null;
    email: string;
    emailVerified: Date | null;
    emailVerifToken: string | null;
    emailTokenExpires: Date | null;
    password: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  role: {
    name: string;
  };
  groups: {
    groupId: number;
  }[];
  projects: {
    projectId: number;
  }[];
}

export const getColumns = (
  session: any,
  handleToggle: (id: string, key: keyof ExtendedUser, value: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedUser>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: () => (
      <div className="bg-primary-foreground">{tCommon("name")}</div>
    ),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 500,
    cell: ({ row }) => (
      <div className="bg-primary-foreground">
        <UserNameCell userId={row.original.id} />
      </div>
    ),
  },
  {
    id: "email",
    accessorKey: "email",
    header: tCommon("fields.email"),
    enableSorting: true,
    enableResizing: true,
    size: 150,
    cell: ({ row }) => <EmailCell email={row.original.email} />,
  },
  {
    id: "emailVerified",
    accessorKey: "emailVerified",
    header: tCommon("fields.emailVerified"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ getValue }) => (
      <div className="whitespace-nowrap">
        <DateFormatter
          date={getValue() as Date | string}
          formatString={
            session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
          }
          timezone={session.user.preferences?.timezone || "Etc/UTC"}
        />
      </div>
    ),
  },
  {
    id: "isActive",
    accessorKey: "isActive",
    header: tCommon("fields.isActive"),
    enableSorting: true,
    enableResizing: true,
    size: 75,
    cell: ({ row }) => (
      <div className="text-center">
        <Switch
          checked={row.original.isActive}
          disabled={row.original.id === session.user.id}
          onCheckedChange={(checked) =>
            handleToggle(row.original.id, "isActive", checked)
          }
        />
      </div>
    ),
  },
  {
    id: "lastActiveAt",
    accessorKey: "lastActiveAt",
    header: tCommon("fields.lastActive"),
    enableSorting: true,
    enableResizing: true,
    size: 75,
    cell: ({ row }) => <LastActiveDisplay date={row.original.lastActiveAt} />,
  },
  {
    id: "access",
    accessorKey: "access",
    header: tCommon("fields.access"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => <AccessLevelDisplay accessLevel={row.original.access} />,
  },
  {
    id: "roleId",
    accessorKey: "roleId",
    header: tCommon("fields.role"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => <RoleNameCell roleId={row.original.roleId.toString()} />,
  },
  {
    id: "groups",
    accessorKey: "groups",
    header: tCommon("fields.groups"),
    enableSorting: false,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        <GroupListDisplay groups={row.original.groups} />
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
        <UserProjectsDisplay userId={row.original.id} />
      </div>
    ),
  },
  {
    id: "isApi",
    accessorKey: "isApi",
    header: tCommon("fields.apiAccess"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: false },
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        <Switch
          checked={row.original.isApi}
          disabled={row.original.access === "ADMIN"}
          onCheckedChange={(checked) =>
            handleToggle(row.original.id, "isApi", checked)
          }
        />
      </div>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: tCommon("fields.createdAt"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ getValue }) => (
      <div className="whitespace-nowrap">
        <DateFormatter
          date={getValue() as Date | string}
          formatString={
            session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
          }
          timezone={session.user.preferences?.timezone || "Etc/UTC"}
        />
      </div>
    ),
  },
  {
    id: "createdById",
    accessorKey: "createdById",
    header: tCommon("fields.createdBy"),
    enableSorting: true,
    enableResizing: true,
    meta: { isVisible: false },
    size: 150,
    cell: (info) =>
      info.row.original.createdBy?.id ? (
        <UserNameCell userId={info.row.original.createdBy.id} />
      ) : (
        "Self-Registration"
      ),
  },
  {
    id: "actions",
    header: tCommon("actions.actionsLabel"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    size: 120,
    meta: { isPinned: "right" },
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <EditUserModal key={`edit-${row.original.id}`} user={row.original} />
        {row.original.id !== session.user.id ? (
          <DeleteUserModal
            key={`delete-${row.original.id}`}
            user={row.original}
          />
        ) : (
          <Button
            variant="ghost"
            className="text-muted-foreground cursor-not-allowed"
            disabled
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        )}
      </div>
    ),
  },
];
