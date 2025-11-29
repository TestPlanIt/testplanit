"use client";

import { useFindUniqueGroups } from "~/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";

interface GroupNameCellProps {
  groupId: string;
}

export function GroupNameCell({ groupId }: GroupNameCellProps) {
  const t = useTranslations("common.labels");
  const groupIdNum = parseInt(groupId, 10);

  const {
    data: group,
    isLoading,
    error,
  } = useFindUniqueGroups(
    {
      where: { id: !isNaN(groupIdNum) ? groupIdNum : undefined },
      select: { name: true },
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

  return (
    <span className="flex items-center">
      <UsersRound className="mr-1 h-4 w-4" />
      {group.name}
    </span>
  );
}
