import { ColumnDef } from "@tanstack/react-table";
import { ApiToken, User } from "@prisma/client";
import { useTranslations } from "next-intl";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";

export interface ExtendedApiToken extends ApiToken {
  user: Pick<User, "id" | "name" | "email" | "image">;
}

export const getColumns = (
  session: any,
  onRevoke: (token: ExtendedApiToken) => void,
  t: ReturnType<typeof useTranslations<"admin.apiTokens">>,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedApiToken>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: tCommon("name"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    size: 200,
    cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
  },
  {
    id: "user",
    accessorKey: "userId",
    header: tCommon("access.user"),
    enableSorting: true,
    enableResizing: true,
    size: 200,
    cell: ({ row }) => <UserNameCell userId={row.original.userId} />,
  },
  {
    id: "tokenPrefix",
    accessorKey: "tokenPrefix",
    header: tCommon("fields.token"),
    enableSorting: false,
    enableResizing: true,
    size: 150,
    cell: ({ row }) => (
      <code className="bg-muted px-2 py-1 rounded text-xs">
        {row.original.tokenPrefix}
        {"••••••••"}
      </code>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: tCommon("fields.created"),
    enableSorting: true,
    enableResizing: true,
    size: 150,
    cell: ({ getValue }) => (
      <div className="whitespace-nowrap text-sm text-muted-foreground">
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
    id: "lastUsedAt",
    accessorKey: "lastUsedAt",
    header: t("columns.lastUsed"),
    enableSorting: true,
    enableResizing: true,
    size: 150,
    cell: ({ row }) => (
      <div className="whitespace-nowrap text-sm text-muted-foreground">
        {row.original.lastUsedAt ? (
          <DateFormatter
            date={row.original.lastUsedAt}
            formatString={
              session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
            }
            timezone={session.user.preferences?.timezone || "Etc/UTC"}
          />
        ) : (
          <span className="text-muted-foreground/50">{t("lastUsedNever")}</span>
        )}
      </div>
    ),
  },
  {
    id: "expiresAt",
    accessorKey: "expiresAt",
    header: t("columns.expires"),
    enableSorting: true,
    enableResizing: true,
    size: 150,
    cell: ({ row }) => {
      const expiresAt = row.original.expiresAt;
      if (!expiresAt) {
        return <Badge variant="outline">{t("noExpiry")}</Badge>;
      }
      const isExpired = new Date(expiresAt) < new Date();
      return (
        <Badge variant={isExpired ? "destructive" : "secondary"}>
          <DateFormatter
            date={expiresAt}
            formatString={
              session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
            }
            timezone={session.user.preferences?.timezone || "Etc/UTC"}
          />
        </Badge>
      );
    },
  },
  {
    id: "status",
    accessorKey: "isActive",
    header: tCommon("actions.status"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => {
      const isActive = row.original.isActive;
      const expiresAt = row.original.expiresAt;
      const isExpired = expiresAt && new Date(expiresAt) < new Date();

      if (!isActive) {
        return <Badge variant="destructive">{t("status.revoked")}</Badge>;
      }
      if (isExpired) {
        return <Badge variant="destructive">{t("status.expired")}</Badge>;
      }
      return <Badge variant="default">{tCommon("fields.isActive")}</Badge>;
    },
  },
  {
    id: "actions",
    header: tCommon("actions.actionsLabel"),
    enableResizing: false,
    enableSorting: false,
    enableHiding: false,
    size: 80,
    cell: ({ row }) => {
      const token = row.original;
      // Only show revoke button for active tokens
      if (!token.isActive) {
        return null;
      }
      return (
        <Button
          variant="destructive"
          onClick={() => onRevoke(token)}
          className="px-2 py-1 h-auto"
          title={t("revokeToken")}
        >
          <Ban className="h-4 w-4" />
        </Button>
      );
    },
  },
];
