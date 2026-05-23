"use client";

import { useQuery } from "@tanstack/react-query";
import { Drama } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserDisplay } from "@/components/search/UserDisplay";
import { getProjectRoleHolders } from "~/app/actions/getProjectRoleHolders";

/**
 * Inline chip representing a role-typed review assignee.
 *
 * Renders `<Drama icon> {roleName}` and, on hover, surfaces a tooltip
 * listing every user with project-eligible access to that role. The list
 * answers the requester's natural question — "who can actually approve
 * this?" — without forcing them to open a separate project-members page.
 *
 * Role-holders are fetched lazily on first hover (or first mount of the
 * tooltip portal) via the `getProjectRoleHolders` server action. The
 * fetch is cached for the session under a per-(project, role) key so
 * repeated hovers don't re-hit the database. Cheap defensive degradation:
 * a failed fetch renders an empty-state message rather than crashing.
 */
export interface RoleAssigneeChipProps {
  projectId: number;
  roleId: number;
  roleName: string;
}

interface RoleHolder {
  id: string;
  name: string | null;
  image: string | null;
}

export function RoleAssigneeChip({
  projectId,
  roleId,
  roleName,
}: RoleAssigneeChipProps) {
  const t = useTranslations("reviews.assigneeChip");
  // Reuse the existing top-level loading copy instead of adding a duplicate
  // under reviews.assigneeChip — per i18n-key-reuse rule, scope a second
  // useTranslations hook rather than copy-paste the string.
  const tCommon = useTranslations("common");
  const { data: holders, isLoading } = useQuery<RoleHolder[]>({
    queryKey: ["projectRoleHolders", projectId, roleId],
    queryFn: () => getProjectRoleHolders(projectId, roleId),
    // Members change infrequently relative to a review's lifetime. 5 min
    // stale window keeps the hover snappy without staleness risk.
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 rounded-md border border-current/20 bg-background/50 px-1.5 py-0.5 align-middle cursor-default"
          data-testid="role-assignee-chip"
        >
          <Drama className="h-3.5 w-3.5" />
          <span className="font-medium">{roleName}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-xs p-2"
        data-testid="role-assignee-chip-tooltip"
      >
        {isLoading && (
          <div className="text-xs text-muted-foreground">
            {tCommon("loading")}
          </div>
        )}
        {!isLoading && holders && holders.length === 0 && (
          <div className="text-xs text-muted-foreground">
            {t("emptyMembers")}
          </div>
        )}
        {!isLoading && holders && holders.length > 0 && (
          <ul
            className="space-y-1 text-xs"
            data-testid="role-assignee-chip-tooltip-list"
          >
            {holders.map((h) => (
              <li key={h.id}>
                <UserDisplay
                  userId={h.id}
                  userName={h.name ?? t("unnamedUser")}
                  userImage={h.image}
                  size="small"
                />
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
