"use client";

import { UserNameCell } from "@/components/tables/UserNameCell";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { badgeVariants } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import type { UserWhereInput } from "~/zenstack/input";
import { UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback } from "react";
import { cn } from "~/utils";

interface UserListProps {
  /**
   * Scope of members to show, as a Users where-filter — e.g. `{ roleId }`,
   * `{ groups: { some: { groupId } } }`, `{ createdById }`. Scoping by relation
   * (instead of a list of ids in the URL) keeps the request small so it never
   * trips the server's max-header-size limit, and lets the popover search and
   * paginate server-side.
   */
  filter?: UserWhereInput;
  pageSize?: number;
  isLoading?: boolean;
}

type UserOption = {
  id: string;
  name: string;
  image: string | null;
};

const DEFAULT_PAGE_SIZE = 10;

const encodeQuery = (value: unknown) =>
  encodeURIComponent(JSON.stringify(value));

export const UserListDisplay: React.FC<UserListProps> = ({
  filter,
  pageSize = DEFAULT_PAGE_SIZE,
  isLoading = false,
}) => {
  const t = useTranslations("common");

  // Build a soft-delete-aware where clause. Callers' member includes are not
  // filtered by `isDeleted`, so the count is resolved here rather than trusted
  // from a prop — otherwise the badge would include soft-deleted users.
  const buildWhere = useCallback(
    (query: string): UserWhereInput => {
      const conditions: UserWhereInput[] = [{ isDeleted: false }];
      if (filter) {
        conditions.push(filter);
      }

      const trimmed = query.trim();
      if (trimmed.length > 0) {
        conditions.push({ name: { contains: trimmed, mode: "insensitive" } });
      }

      return conditions.length === 1 ? conditions[0] : { AND: conditions };
    },
    [filter]
  );

  // Accurate, soft-delete-excluding member count — drives the badge and the
  // empty-hide. One small scoped request, so it never 431s at any scale.
  const { data: memberCount, isLoading: countLoading } = useQuery({
    queryKey: ["user-list-display-count", filter],
    queryFn: async () => {
      const response = await fetch(
        `/api/model/user/count?q=${encodeQuery({ where: buildWhere("") })}`
      );
      if (!response.ok) {
        return 0;
      }
      const payload = await response.json();
      return typeof payload?.data === "number" ? payload.data : 0;
    },
    enabled: !!filter,
  });

  const fetchUsers = useCallback(
    async (query: string, page: number, size: number) => {
      const where = buildWhere(query);
      const params = {
        where,
        orderBy: { name: "asc" } as const,
        skip: page * size,
        take: size,
        select: { id: true, name: true, image: true },
      };

      const response = await fetch(
        `/api/model/user/findMany?q=${encodeQuery(params)}`
      );

      if (!response.ok) {
        console.error("Failed to load users", await response.text());
        return { results: [], total: 0 };
      }

      const payload = await response.json();
      const results = Array.isArray(payload?.data)
        ? (payload.data as UserOption[])
        : [];

      // Reuse the resolved member count when not searching; recompute per-search.
      let total = memberCount ?? results.length;
      if (query.trim().length > 0) {
        const countResponse = await fetch(
          `/api/model/user/count?q=${encodeQuery({ where })}`
        );
        if (countResponse.ok) {
          const countPayload = await countResponse.json();
          if (typeof countPayload?.data === "number") {
            total = countPayload.data;
          }
        }
      }

      return { results, total };
    },
    [buildWhere, memberCount]
  );

  if (isLoading || countLoading) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (!filter || !memberCount) {
    return null;
  }

  const triggerLabel = memberCount.toLocaleString();
  const searchPlaceholder = t("searchUsers");

  return (
    <AsyncCombobox<UserOption>
      value={null}
      onValueChange={() => {
        // Navigation handled by the rendered option link.
      }}
      fetchOptions={fetchUsers}
      renderOption={(user) => <UserNameCell userId={user.id} />}
      getOptionValue={(user) => user.id}
      placeholder={searchPlaceholder}
      triggerLabel={triggerLabel}
      renderTrigger={() => (
        <button
          type="button"
          aria-label={searchPlaceholder}
          className={cn(
            badgeVariants({ variant: "default" }),
            "gap-1 whitespace-nowrap text-xs"
          )}
        >
          <UserRoundIcon className="h-4 w-4" />
          <span>{triggerLabel}</span>
        </button>
      )}
      dropdownClassName="p-0 min-w-[360px] max-w-[560px]"
      pageSize={pageSize}
      showTotal
    />
  );
};
