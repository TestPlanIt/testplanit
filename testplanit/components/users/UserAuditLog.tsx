"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { DataTable } from "@/components/tables/DataTable";
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
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { useForm, useWatch } from "react-hook-form";
import { AuditLogDetailModal } from "~/app/[locale]/admin/audit-logs/AuditLogDetailModal";
import {
  buildAuditLogOrderBy,
  ExtendedAuditLog,
  useColumns,
} from "~/app/[locale]/admin/audit-logs/columns";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { groupAuditRows } from "~/lib/audit/groupAuditRows";

// Rows fetched per scroll page — matches the admin audit-log surface: audit
// rows are cheap (heavy Json columns excluded) and operationId grouping can
// collapse a whole page into one visible row, so batch large.
const PAGE_SIZE = 1000;

interface UserAuditLogProps {
  userId: string;
}

export function UserAuditLog({ userId }: UserAuditLogProps) {
  const { data: session } = useSession();
  const locale = useLocale();
  const t = useTranslations("admin.auditLogs");
  const tCommon = useTranslations("common");
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
  const [projectFilter, setProjectFilter] = useState<string>("all");
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

    if (projectFilter !== "all") {
      conditions.push({ projectId: parseInt(projectFilter, 10) });
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
  }, [
    userId,
    debouncedSearchString,
    actionFilter,
    typeFilter,
    projectFilter,
    dateRange,
  ]);

  const baseArgs = {
    where: whereClause,
    orderBy: buildAuditLogOrderBy(sortConfig),
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
      operationId: true,
      sourceTable: true,
    },
    take: PAGE_SIZE,
  };

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useClientQueries(schema).auditLog.useInfiniteFindMany(baseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return {
        ...baseArgs,
        skip: allPages.flat().length,
      };
    },
    refetchOnWindowFocus: false,
  });

  // Cast via unknown: the not-yet-regenerated Prisma client types
  // operationId/sourceTable as never in the select payload (the columns exist in
  // the schema), so a direct cast doesn't overlap. Memoized so the grouping pass
  // below only reruns when the page set actually changes.
  const rows = useMemo(
    () => (pages?.pages.flat() ?? []) as unknown as ExtendedAuditLog[],
    [pages]
  );

  // Collapse rows sharing an operationId into one expandable lead (COR-04) via
  // the shared helper; flatten each group into a lead carrying its children.
  const groupedData = useMemo(
    () =>
      groupAuditRows(rows).map((group) =>
        group.children.length > 0
          ? { ...group.lead, auditChildren: group.children }
          : group.lead
      ),
    [rows]
  );

  const { data: totalCount } = useClientQueries(schema).auditLog.useCount({
    where: whereClause,
  });

  // Filter options come from the distinct values this user has actually
  // generated, so each dropdown lists only relevant actions/types.
  const { data: actionRows } = useClientQueries(schema).auditLog.useFindMany({
    where: { userId },
    select: { action: true },
    distinct: ["action"],
    orderBy: { action: "asc" },
  });
  const { data: typeRows } = useClientQueries(schema).auditLog.useFindMany({
    where: { userId },
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });
  const { data: projectRows } = useClientQueries(schema).auditLog.useFindMany({
    where: { userId, projectId: { not: null } },
    select: { projectId: true, project: { select: { name: true } } },
    distinct: ["projectId"],
    orderBy: { projectId: "asc" },
  });

  const projectOptions = useMemo(() => {
    const options = (projectRows ?? [])
      .filter(
        (row): row is { projectId: number; project: { name: string } } =>
          row.projectId != null && !!row.project?.name
      )
      .map((row) => ({ id: row.projectId, name: row.project.name }));
    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [projectRows]);

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
  const allColumns = useColumns(userPreferences, handleViewDetails, t, tCommon);
  const columns = useMemo(
    () => allColumns.filter((c) => c.id !== "userEmail"),
    [allColumns]
  );

  const hasFilter =
    !!debouncedSearchString ||
    actionFilter !== "all" ||
    typeFilter !== "all" ||
    projectFilter !== "all" ||
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

        <div className="w-[170px]">
          <Label className="sr-only">{tCommon("fields.project")}</Label>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("allProjects")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allProjects")}</SelectItem>
              {projectOptions.map((project) => (
                <SelectItem key={project.id} value={project.id.toString()}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Data Table — virtualized, infinite scroll. */}
      <div className="h-96">
        <DataTable
          virtualized
          columns={columns as any}
          data={groupedData as any}
          getSubRows={(row) => row.auditChildren}
          subRowsLabel={t("relatedChanges")}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          flexColumnId="entityName"
          columnSizingStorageKey="user-audit-log"
          hasMore={!!hasNextPage}
          isLoading={isLoading || isFetchingNextPage}
          onLoadMore={fetchNextPage}
          emptyMessage={
            hasFilter ? tProfile("noMatchingEntries") : tProfile("noEntries")
          }
          resetKey={`${debouncedSearchString}|${actionFilter}|${typeFilter}|${projectFilter}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
          testIdPrefix="user-audit-log-table"
          rowTestIdPrefix="user-audit-log-row"
        />
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground text-end">
          {tProfile("showing", {
            loaded: rows.length.toLocaleString(locale),
            total: (totalCount ?? rows.length).toLocaleString(locale),
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
