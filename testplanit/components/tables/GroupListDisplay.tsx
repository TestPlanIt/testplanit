"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { badgeVariants } from "@/components/ui/badge";
import type { Groups } from "~/zenstack/models";
import { UserRoundCog, UsersRound, UsersRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback } from "react";
import { cn } from "~/utils";

interface GroupListProps {
  groups: { groupId: number }[];
  usePopover?: boolean;
}

const isScim = (group: Groups) => group.scimDisplayName !== null;

export const GroupListDisplay: React.FC<GroupListProps> = ({
  groups,
  usePopover = true,
}) => {
  const tGroups = useTranslations("admin.groups");
  const tCommon = useTranslations("common");

  const { data: allGroups } = useClientQueries(schema).groups.useFindMany({
    orderBy: { name: "asc" },
    where: {
      AND: [
        {
          id: {
            in: groups.map((group) => group.groupId),
          },
        },
        {
          isDeleted: false,
        },
      ],
    },
  });

  // Local (client-side) option source — the scoped groups are already loaded, so
  // the popover just filters/paginates them without further round-trips.
  const fetchGroups = useCallback(
    (query: string, page: number, size: number) => {
      const trimmed = query.trim().toLowerCase();
      const filtered = trimmed
        ? (allGroups ?? []).filter((group) =>
            group.name.toLowerCase().includes(trimmed)
          )
        : (allGroups ?? []);
      return Promise.resolve({
        results: filtered.slice(page * size, page * size + size),
        total: filtered.length,
      });
    },
    [allGroups]
  );

  if (!allGroups || allGroups.length === 0) {
    return null;
  }

  // Inline grid mode (e.g. user profile) — matches the Projects list layout.
  if (!usePopover) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {allGroups.map((group: Groups) => (
          <div
            key={group.id}
            className="flex items-center gap-2 text-sm"
            title={isScim(group) ? tGroups("scimManagedTooltip") : undefined}
          >
            {isScim(group) ? (
              <UserRoundCog className="h-4 w-4 shrink-0" />
            ) : (
              <UsersRound className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{group.name}</span>
          </div>
        ))}
      </div>
    );
  }

  const triggerLabel = allGroups.length.toLocaleString();

  return (
    <AsyncCombobox<Groups>
      value={null}
      onValueChange={() => {
        // Read-only list; groups have no detail page.
      }}
      fetchOptions={fetchGroups}
      renderOption={(group) => (
        <div
          className="flex min-w-0 items-center gap-2"
          title={isScim(group) ? tGroups("scimManagedTooltip") : undefined}
        >
          {isScim(group) ? (
            <UserRoundCog className="h-4 w-4 shrink-0" />
          ) : (
            <UsersRound className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{group.name}</span>
        </div>
      )}
      getOptionValue={(group) => group.id}
      placeholder={tCommon("searchGroups")}
      triggerLabel={triggerLabel}
      renderTrigger={() => (
        <button
          type="button"
          aria-label={tCommon("searchGroups")}
          className={cn(
            badgeVariants({ variant: "default" }),
            "gap-1 whitespace-nowrap text-xs"
          )}
        >
          <UsersRoundIcon className="h-4 w-4" />
          <span>{triggerLabel}</span>
        </button>
      )}
      dropdownClassName="p-0 min-w-[320px] max-w-[520px]"
      pageSize={10}
      showTotal
    />
  );
};
