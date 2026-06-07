import { DateFormatter } from "@/components/DateFormatter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import { ScimToken, User } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { Ban, CheckCircle2, Clock, UserMinus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { RevokeScimTokenButton } from "./RevokeScimTokenButton";
import { TestScimButton } from "./TestScimButton";

export interface ExtendedScimToken extends ScimToken {
  createdBy: Pick<User, "id" | "name" | "email" | "image"> | null;
  revokedBy: Pick<User, "id" | "name" | "email"> | null;
}

export const useColumns = (
  userPreferences: any,
  onRevoke: (token: ExtendedScimToken) => void,
  t: ReturnType<typeof useTranslations<"admin.scim">>,
  tApiTokens: ReturnType<typeof useTranslations<"admin.apiTokens">>,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedScimToken>[] => {
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
        id: "idpName",
        accessorKey: "idpName",
        header: t("columns.idp"),
        enableSorting: true,
        enableResizing: true,
        size: 140,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.idpName}</Badge>
        ),
      },
      {
        id: "status",
        accessorKey: "isActive",
        header: tCommon("actions.status"),
        enableSorting: true,
        enableResizing: true,
        size: 130,
        cell: ({ row }) => {
          const { isActive, expiresAt, revokedAt } = row.original;
          if (revokedAt) {
            return (
              <Badge variant="destructive">
                <Ban className="size-3 mr-1" aria-hidden="true" />
                {tApiTokens("status.revoked")}
              </Badge>
            );
          }
          if (expiresAt && new Date(expiresAt) < new Date()) {
            return (
              <Badge variant="outline">
                <Clock className="size-3 mr-1" aria-hidden="true" />
                {t("status.expired")}
              </Badge>
            );
          }
          if (!isActive) {
            return (
              <Badge variant="secondary">
                <UserMinus className="size-3 mr-1" aria-hidden="true" />
                {t("status.deactivated")}
              </Badge>
            );
          }
          return (
            <Badge variant="default">
              <CheckCircle2 className="size-3 mr-1" aria-hidden="true" />
              {t("status.active")}
            </Badge>
          );
        },
      },
      {
        id: "lastUsedAt",
        accessorKey: "lastUsedAt",
        header: tApiTokens("columns.lastUsed"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-sm text-muted-foreground">
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
        id: "lastUsedIp",
        accessorKey: "lastUsedIp",
        header: t("columns.lastIp"),
        enableSorting: false,
        enableResizing: true,
        size: 140,
        cell: ({ row }) => {
          const ip = row.original.lastUsedIp;
          if (!ip) {
            return (
              <span className="text-muted-foreground/50 text-sm">
                {tCommon("never")}
              </span>
            );
          }
          return (
            <code className="bg-muted px-2 py-1 rounded text-xs">{ip}</code>
          );
        },
      },
      {
        id: "lastSyncAt",
        accessorKey: "lastSyncAt",
        header: t("columns.lastSync"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-sm text-muted-foreground">
            {row.original.lastSyncAt ? (
              <DateFormatter
                date={row.original.lastSyncAt}
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
        header: tApiTokens("columns.expires"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => {
          const expiresAt = row.original.expiresAt;
          if (!expiresAt) {
            return <Badge variant="outline">{tCommon("never")}</Badge>;
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
        id: "createdBy",
        accessorKey: "createdById",
        header: tCommon("access.user"),
        enableSorting: true,
        enableResizing: true,
        size: 200,
        cell: ({ row }) => <UserNameCell userId={row.original.createdById} />,
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableResizing: true,
        enableSorting: false,
        enableHiding: false,
        size: 80,
        meta: { isPinned: "right" },
        cell: ({ row }) => {
          const token = row.original;
          if (token.revokedAt || !token.isActive) {
            return null;
          }
          return (
            <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
              <TestScimButton tokenId={token.id} />
              <RevokeScimTokenButton
                tokenId={token.id}
                onRevoke={() => onRevoke(token)}
              />
            </div>
          );
        },
      },
    ],
    [dateFormat, timezone, onRevoke, t, tApiTokens, tCommon]
  );
};
