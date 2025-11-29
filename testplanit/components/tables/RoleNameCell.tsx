"use client";

import { useFindUniqueRoles } from "~/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";
import { RoleNameDisplay } from "~/components/RoleNameDisplay";

interface RoleNameCellProps {
  roleId: string | null; // Can be numeric string or potentially null/"NONE"
}

export function RoleNameCell({ roleId }: RoleNameCellProps) {
  const t = useTranslations("common.labels");
  const roleIdNum = roleId ? parseInt(roleId, 10) : NaN;
  const isValidRoleId = !isNaN(roleIdNum);

  const {
    data: role,
    isLoading,
    error,
  } = useFindUniqueRoles(
    {
      where: { id: isValidRoleId ? roleIdNum : undefined },
      select: { id: true, name: true },
    },
    {
      // Only fetch if roleId is a valid number string
      enabled: isValidRoleId,
      // Optional: staleTime, cacheTime for performance
    }
  );

  if (!isValidRoleId) {
    // Handle cases like explicit "NONE" or null if needed, though typically caught by parent
    // For now, just return null or a placeholder if the ID isn't valid
    return null; // Or perhaps a different placeholder?
  }

  if (isLoading) {
    return <Skeleton className="h-4 w-20" />;
  }

  if (error || !role) {
    return (
      <span className="text-muted-foreground italic">{t("unknownRole")}</span>
    );
  }

  return <RoleNameDisplay role={role} />;
}
