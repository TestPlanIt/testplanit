import { DateFormatter } from "@/components/DateFormatter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiToken, User } from "~/zenstack/models";
import { ColumnDef } from "@/components/tables/tableFeatures";
import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface ExtendedApiToken extends ApiToken {
  user: Pick<User, "id" | "name" | "email" | "image">;
}

export const useColumns = (
  userPreferences: any,
  onRevoke: (token: ExtendedApiToken) => void,
  t: ReturnType<typeof useTranslations<"admin.apiTokens">>,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedApiToken>[] => {
  const dateFormat =
    userPreferences.user.preferences?.dateFormat || "MM_DD_YYYY_DASH";
  const timezone = userPreferences.user.preferences?.timezone || "Etc/UTC";

  return useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        size: 200,
        cell: ({ row }) => (
          <div className="font-medium">{row.original.name}</div>
        ),
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
        size: 130,
        cell: ({ row }) => (
          <code className="rounded bg-muted px-2 py-1 text-xs">
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
        size: 120,
        cell: ({ getValue }) => (
          <div className="text-sm whitespace-nowrap text-muted-foreground">
            <DateFormatter
              date={getValue() as Date | string}
              formatString={dateFormat}
              timezone={timezone}
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
        size: 120,
        cell: ({ row }) => (
          <div className="text-sm whitespace-nowrap text-muted-foreground">
            {row.original.lastUsedAt ? (
              <DateFormatter
                date={row.original.lastUsedAt}
                formatString={dateFormat}
                timezone={timezone}
              />
            ) : (
              <span className="text-muted-foreground/50">
                {tCommon("never")}
              </span>
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
        size: 130,
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
                formatString={dateFormat}
                timezone={timezone}
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
        size: 120,
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
            <div className="flex justify-end">
              <Button
                variant="destructive"
                onClick={() => onRevoke(token)}
                className="h-auto px-2 py-1"
                title={t("revokeToken")}
              >
                <Ban className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [dateFormat, timezone, onRevoke, t, tCommon]
  );
};
