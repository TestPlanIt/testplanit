"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { UserRoundCog, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";

interface GroupNameCellProps {
  groupId: string;
}

export function GroupNameCell({ groupId }: GroupNameCellProps) {
  const t = useTranslations("common.labels");
  const tGroups = useTranslations("admin.groups");
  const groupIdNum = parseInt(groupId, 10);

  const {
    data: group,
    isLoading,
    error,
  } = useClientQueries(schema).groups.useFindUnique(
    {
      where: { id: !isNaN(groupIdNum) ? groupIdNum : undefined },
      select: { name: true, scimDisplayName: true },
    },
    {
      // Only fetch if groupId is a valid number
      enabled: !isNaN(groupIdNum),
      // Optional: staleTime, cacheTime for performance
    }
  );

  if (isLoading) {
    return <Skeleton className="h-4 w-20" />;
  }

  if (error || !group) {
    // Log error for debugging?
    // console.error(`Error fetching group ${groupId}:`, error);
    return (
      <span className="text-muted-foreground italic">{t("unknownGroup")}</span>
    );
  }

  const isScimManaged = group.scimDisplayName !== null;

  return (
    <span className="flex items-center">
      {isScimManaged ? (
        <UserRoundCog
          className="mr-1 h-4 w-4"
          aria-label={tGroups("scimManagedTooltip")}
          data-testid="scim-managed-group-icon"
        >
          <title>{tGroups("scimManagedTooltip")}</title>
        </UserRoundCog>
      ) : (
        <UsersRound className="mr-1 h-4 w-4" />
      )}
      {group.name}
    </span>
  );
}
