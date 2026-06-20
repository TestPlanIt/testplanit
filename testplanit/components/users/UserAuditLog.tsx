"use client";

import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuditAction } from "~/zenstack/models";
import type { VisibilityState } from "@tanstack/react-table";
import { endOfDay, startOfDay } from "date-fns";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { useForm, useWatch } from "react-hook-form";
import { AuditLogDetailModal } from "~/app/[locale]/admin/audit-logs/AuditLogDetailModal";
import {
  ExtendedAuditLog,
  useColumns,
} from "~/app/[locale]/admin/audit-logs/columns";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import {
  useCountAuditLog,
  useFindManyAuditLog,
  useInfiniteFindManyAuditLog,
} from "~/lib/hooks";

const PAGE_SIZE = 50;

interface UserAuditLogProps {
  userId: string;
}

export function UserAuditLog({ userId }: UserAuditLogProps) {
  const { data: session } = useSession();
  const t = useTranslations("admin.auditLogs");
  const tCommon = useTranslations("common");
  const tUserMenu = useTranslations("userMenu");
  const tProfile = useTranslations("users.profile.auditLog");

  const [detailId, setDetailId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "timestamp", direction: "desc" });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const dateForm = useForm<{ dateRange: DateRange | undefined }>({
    defaultValues: { dateRange: undefined },
  });
  const dateRange = useWatch({ control: dateForm.control, name: "dateRange" });

  // Always hard-scoped to this user; the admin-style user filter is omitted.
  const whereClause = useMemo(() => {
    const conditions: any[] = [{ userId }];

    if (debouncedSearchString) {
      conditions.push({
        OR: [
          {
            entityName: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          {
            entityType: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          {
            entityId: { contains: debouncedSearchString, mode: "insensitive" },
          },
        ],
      });
    }

    if (actionFilter !== "all") {
      conditions.push({ action: actionFilter });
    }

    if (typeFilter !== "all") {
      conditions.push({ entityType: typeFilter });
    }

    if (dateRange?.from) {
      conditions.push({
        timestamp: {
          gte: startOfDay(dateRange.from),
          lte: endOfDay(dateRange.to ?? dateRange.from),
        },
      });
    }

    return { AND: conditions };
  }, [userId, debouncedSearchString, actionFilter, typeFilter, dateRange]);

  const baseArgs = {
    where: whereClause,
    orderBy: { [sortConfig.column]: sortConfig.direction },
    select: {
      id: true,
      timestamp: true,
      action: true,
      entityType: true,
      entityId: true,
      entityName: true,
      userId: true,
      userEmail: true,
      userName: true,
      projectId: true,
      project: { select: { name: true } },
    },
    take: PAGE_SIZE,
  };

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteFindManyAuditLog(baseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return {
        ...baseArgs,
        skip: allPages.flat().length,
      };
    },
    refetchOnWindowFocus: false,
  });

  const rows = (pages?.pages.flat() ?? []) as ExtendedAuditLog[];

  const { data: totalCount } = useCountAuditLog({ where: whereClause });

  // Filter options come from the distinct values this user has actually
  // generated, so each dropdown lists only relevant actions/types.
  const { data: actionRows } = useFindManyAuditLog({
    where: { userId },
    select: { action: true },
    distinct: ["action"],
    orderBy: { action: "asc" },
  });
  const { data: typeRows } = useFindManyAuditLog({
    where: { userId },
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });

  const handleViewDetails = useCallback((log: { id: string }) => {
    setDetailId(log.id);
  }, []);

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  // Reuse the admin audit-log columns, but drop the user column — every row
  // belongs to the same user here.
  const allColumns = useColumns(
    userPreferences,
    handleViewDetails,
    t,
    tCommon,
    tUserMenu
  );
  const columns = useMemo(
    () => allColumns.filter((c) => c.id !== "userEmail"),
    [allColumns]
  );

  const hasFilter =
    !!debouncedSearchString ||
    actionFilter !== "all" ||
    typeFilter !== "all" ||
    !!dateRange?.from;

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[260px] flex-1">
          <Filter
            key="user-audit-log-filter"
            placeholder={t("filterPlaceholder")}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
          />
        </div>

        <div className="w-[240px]">
          <Label className="sr-only">{t("timeRange")}</Label>
          <Form {...dateForm}>
            <DateRangePickerField control={dateForm.control} name="dateRange" />
          </Form>
        </div>

        <div className="w-[170px]">
          <Label className="sr-only">{t("filterAction")}</Label>
          <Select
            value={actionFilter}
            onValueChange={(value) =>
              setActionFilter(value as AuditAction | "all")
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("allActions")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allActions")}</SelectItem>
              {actionRows?.map((row) => (
                <SelectItem key={row.action} value={row.action}>
                  {row.action.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[170px]">
          <Label className="sr-only">{t("filterEntityType")}</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("allEntityTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allEntityTypes")}</SelectItem>
              {typeRows?.map((row) => (
                <SelectItem key={row.entityType} value={row.entityType}>
                  {row.entityType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Data Table — virtualized, infinite scroll. */}
      <div className="h-96">
        <VirtualizedDataTable
          columns={columns as any}
          data={rows as any}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          flexColumnId="entityName"
          hasMore={!!hasNextPage}
          isLoading={isLoading || isFetchingNextPage}
          onLoadMore={fetchNextPage}
          emptyMessage={
            hasFilter ? tProfile("noMatchingEntries") : tProfile("noEntries")
          }
          resetKey={`${debouncedSearchString}|${actionFilter}|${typeFilter}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
          testIdPrefix="user-audit-log-table"
          rowTestIdPrefix="user-audit-log-row"
        />
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          {tProfile("showing", {
            loaded: rows.length.toLocaleString(),
            total: (totalCount ?? rows.length).toLocaleString(),
          })}
        </p>
      )}

      <AuditLogDetailModal
        logId={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
