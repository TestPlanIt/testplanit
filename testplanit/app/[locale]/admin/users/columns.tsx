import { DateFormatter } from "@/components/DateFormatter";
import { EmailCell } from "@/components/EmailDisplay";
import { AccessLevelDisplay } from "@/components/tables/AccessLevelDisplay";
import { GroupListDisplay } from "@/components/tables/GroupListDisplay";
import { RoleNameCell } from "@/components/tables/RoleNameCell";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { UserProjectsDisplay } from "@/components/tables/UserProjectsDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { User } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { LastActiveDisplay } from "~/components/LastActiveDisplay";
import { SCIM_SYSTEM_USER_EMAIL } from "~/lib/scim/constants";
export interface ExtendedUser extends User {
  createdBy: {
    name: string;
    id: string;
    image: string | null;
    email: string;
    emailVerified: Date | null;
    emailVerifToken: string | null;
    emailTokenExpires: Date | null;
    password: string | null;
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

export const useColumns = (
  userPreferences: any,
  handleToggle: (id: string, key: keyof ExtendedUser, value: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  tAdmin: ReturnType<typeof useTranslations<"admin.users">>,
  onEditUser?: (user: ExtendedUser) => void,
  onDeleteUser?: (user: ExtendedUser) => void,
  onForceChangePassword?: (user: ExtendedUser) => void,
  onRevokePassword?: (user: ExtendedUser) => void
): ColumnDef<ExtendedUser>[] => {
  const dateFormat =
    userPreferences.user.preferences?.dateFormat || "MM_DD_YYYY_DASH";
  const timezone = userPreferences.user.preferences?.timezone || "Etc/UTC";
  const currentUserId = userPreferences.user.id;

  return useMemo(
    () => [
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
        cell: ({ row }) => {
          const isScimProvisioner =
            row.original.email === SCIM_SYSTEM_USER_EMAIL;
          const isScimManaged =
            !isScimProvisioner && row.original.scimGivenName !== null;
          return (
            <div className="bg-primary-foreground flex items-center gap-1">
              <UserNameCell userId={row.original.id} />
              {isScimProvisioner && (
                <Badge
                  variant="secondary"
                  className="ml-1"
                  title={tAdmin("scimManagedTooltip")}
                  data-testid="scim-provisioner-badge"
                >
                  {tAdmin("scimProvisionerBadge")}
                </Badge>
              )}
              {isScimManaged && (
                <Badge
                  variant="secondary"
                  className="ml-1"
                  title={tAdmin("scimManagedTooltip")}
                  data-testid="scim-managed-user-badge"
                >
                  {tAdmin("scimManagedBadge")}
                </Badge>
              )}
            </div>
          );
        },
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
              formatString={dateFormat}
              timezone={timezone}
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
        cell: ({ row }) => {
          const isScimManaged =
            row.original.email === SCIM_SYSTEM_USER_EMAIL ||
            row.original.scimGivenName !== null;
          return (
            <div className="text-center">
              <Switch
                data-testid={`user-active-toggle-${row.original.id}`}
                aria-label={tCommon("aria.toggleActive")}
                checked={row.original.isActive}
                disabled={row.original.id === currentUserId || isScimManaged}
                title={isScimManaged ? tAdmin("scimManagedTooltip") : undefined}
                onCheckedChange={(checked) =>
                  handleToggle(row.original.id, "isActive", checked)
                }
              />
            </div>
          );
        },
      },
      {
        id: "lastActiveAt",
        accessorKey: "lastActiveAt",
        header: tCommon("fields.lastActive"),
        enableSorting: true,
        enableResizing: true,
        size: 75,
        cell: ({ row }) => (
          <LastActiveDisplay date={row.original.lastActiveAt} />
        ),
      },
      {
        id: "access",
        accessorKey: "access",
        header: tCommon("fields.access"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <AccessLevelDisplay accessLevel={row.original.access} />
        ),
      },
      {
        id: "roleId",
        accessorKey: "roleId",
        header: tCommon("fields.role"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <RoleNameCell roleId={row.original.roleId.toString()} />
        ),
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
        id: "scimGivenName",
        accessorKey: "scimGivenName",
        header: tAdmin("scimColumnHeader"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: true,
        size: 90,
        cell: ({ row }) => {
          const isScimProvisioner =
            row.original.email === SCIM_SYSTEM_USER_EMAIL;
          const isScimManaged =
            isScimProvisioner || row.original.scimGivenName !== null;
          if (!isScimManaged) {
            return (
              <span className="text-muted-foreground text-center block">
                {"—"}
              </span>
            );
          }
          return (
            <div className="text-center">
              <Badge
                variant="secondary"
                title={tAdmin("scimManagedTooltip")}
                data-testid={`scim-column-badge-${row.original.id}`}
              >
                {tAdmin("scimColumnYes")}
              </Badge>
            </div>
          );
        },
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
              formatString={dateFormat}
              timezone={timezone}
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
        size: 60,
        meta: { isPinned: "right" },
        cell: ({ row }) => {
          const isScimProvisioner =
            row.original.email === SCIM_SYSTEM_USER_EMAIL;
          const isScimManaged =
            isScimProvisioner || row.original.scimGivenName !== null;
          return (
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 h-auto"
                    aria-label={tCommon("actions.actionsLabel")}
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={isScimProvisioner}
                    title={
                      isScimProvisioner
                        ? tAdmin("scimManagedTooltip")
                        : undefined
                    }
                    onClick={() => onEditUser?.(row.original)}
                  >
                    {tCommon("actions.edit")}
                  </DropdownMenuItem>
                  {row.original.authMethod !== "SSO" &&
                    row.original.id !== currentUserId &&
                    !isScimManaged && (
                      <>
                        <DropdownMenuItem
                          onClick={() => onForceChangePassword?.(row.original)}
                        >
                          {tAdmin("forcePasswordChange")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onRevokePassword?.(row.original)}
                        >
                          {tAdmin("revokePassword")}
                        </DropdownMenuItem>
                      </>
                    )}
                  <DropdownMenuSeparator />
                  {row.original.id !== currentUserId && !isScimManaged ? (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDeleteUser?.(row.original)}
                    >
                      {tCommon("actions.delete")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [
      dateFormat,
      timezone,
      currentUserId,
      handleToggle,
      tCommon,
      tAdmin,
      onEditUser,
      onDeleteUser,
      onForceChangePassword,
      onRevokePassword,
    ]
  );
};
