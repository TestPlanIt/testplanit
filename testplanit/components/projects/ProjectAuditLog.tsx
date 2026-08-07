"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { AuditAction } from "~/zenstack/models";
import type { VisibilityState } from "@tanstack/react-table";
import { endOfDay, format, startOfDay } from "date-fns";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { useForm, useWatch } from "react-hook-form";
import { AuditLogDetailModal } from "~/app/[locale]/admin/audit-logs/AuditLogDetailModal";
import {
  ExtendedAuditLog,
  useColumns,
} from "~/app/[locale]/admin/audit-logs/columns";
import type { AuditLogUserOption } from "~/lib/services/auditLog/searchAuditLogUsers";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { AUDIT_ACTIONS, formatAuditAction } from "~/lib/audit/auditActions";
import { groupAuditRows } from "~/lib/audit/groupAuditRows";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";
import { logDataExport } from "~/lib/services/auditClient";

// Rows fetched per scroll page — matches the admin audit-log surface: audit
// rows are cheap (heavy Json columns excluded) and operationId grouping can
// collapse a whole page into one visible row, so batch large.
const PAGE_SIZE = 1000;

// Options shown per page inside the filter pickers.
const FILTER_PAGE_SIZE = 25;

interface ProjectAuditLogProps {
  projectId: number;
  /**
   * Reports the CSV-export handler and its enabled/busy state up to the page so
   * the Export button can live in the card header (matching the admin audit-log
   * layout) while the export logic stays with the filter state here.
   */
  onExportStateChange?: (state: {
    canExport: boolean;
    isExporting: boolean;
    exportCsv: () => void;
  }) => void;
}

export function ProjectAuditLog({
  projectId,
  onExportStateChange,
}: ProjectAuditLogProps) {
  const { data: session } = useSession();
  const locale = useLocale();
  const t = useTranslations("admin.auditLogs");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "timestamp", direction: "desc" });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  // Every filter below is additive: an empty selection means "no filter", so
  // the picker placeholder reads "All …".
  const [actionFilter, setActionFilter] = useState<AuditAction[]>([]);
  const [entityTypeFilter, setEntityTypeFilter] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<AuditLogUserOption[]>([]);
  const dateForm = useForm<{ dateRange: DateRange | undefined }>({
    defaultValues: { dateRange: undefined },
  });
  const dateRange = useWatch({ control: dateForm.control, name: "dateRange" });
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [isExporting, setIsExporting] = useState(false);

  // Always hard-scoped to this project; the audit log denormalizes projectId
  // on every project-tagged event.
  const whereClause = useMemo(() => {
    const conditions: any[] = [{ projectId }];

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
            userEmail: { contains: debouncedSearchString, mode: "insensitive" },
          },
          {
            userName: { contains: debouncedSearchString, mode: "insensitive" },
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

    if (actionFilter.length > 0) {
      conditions.push({ action: { in: actionFilter } });
    }

    if (entityTypeFilter.length > 0) {
      conditions.push({ entityType: { in: entityTypeFilter } });
    }

    if (selectedUsers.length > 0) {
      conditions.push({
        userId: { in: selectedUsers.map((user) => user.userId) },
      });
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
    projectId,
    debouncedSearchString,
    actionFilter,
    entityTypeFilter,
    selectedUsers,
    dateRange,
  ]);

  const { data: totalCount } = useClientQueries(schema).auditLog.useCount({
    where: whereClause,
  });

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
      project: { select: { name: true, key: true } },
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

  // Entity types present in this project's audit log, so the filter lists only
  // relevant types.
  const { data: entityTypes } = useClientQueries(schema).auditLog.useFindMany({
    where: { projectId },
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });

  // A plain request rather than a Server Action: Next runs Server Actions one
  // at a time per client, so a slow actor search would stall every other action
  // this page issues until a reload.
  const fetchUserOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        pageSize: String(pageSize),
      });
      const response = await fetch(
        `/api/projects/${projectId}/audit-log-users?${params}`
      );
      if (!response.ok) {
        throw new Error(`Failed to load audit log users (${response.status})`);
      }
      return (await response.json()) as {
        results: AuditLogUserOption[];
        total: number;
      };
    },
    [projectId]
  );

  // Action / entity-type options are already in memory, so their pickers filter
  // and page locally.
  const fetchActionOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? AUDIT_ACTIONS.filter((action) =>
            formatAuditAction(action).toLowerCase().includes(q)
          )
        : AUDIT_ACTIONS;
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    []
  );

  const entityTypeOptions = useMemo(
    () => (entityTypes ?? []).map((et) => et.entityType),
    [entityTypes]
  );

  const fetchEntityTypeOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? entityTypeOptions.filter((entityType) =>
            entityType.toLowerCase().includes(q)
          )
        : entityTypeOptions;
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [entityTypeOptions]
  );

  const handleViewDetails = useCallback((log: { id: string }) => {
    setSelectedLogId(log.id);
  }, []);

  // Fetch all filtered logs for export (no pagination).
  const { refetch: refetchAllLogs } = useClientQueries(
    schema
  ).auditLog.useFindMany(
    {
      orderBy: { [sortConfig.column]: sortConfig.direction },
      include: { project: { select: { name: true } } },
      where: whereClause,
    },
    { enabled: false }
  );

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      const { data: logs } = await refetchAllLogs();

      if (!logs || logs.length === 0) {
        setIsExporting(false);
        return;
      }

      const headers = [
        t("columns.timestamp"),
        t("filterAction"),
        t("filterEntityType"),
        t("columns.entityId"),
        t("columns.entityName"),
        tGlobal("common.access.user"),
        tGlobal("common.fields.email"),
        tGlobal("common.fields.project"),
        t("columns.ipAddress"),
        t("columns.userAgent"),
        t("metadata"),
      ];

      const csvRows = logs.map((log: ExtendedAuditLog) => {
        const timestamp = log.timestamp
          ? format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")
          : "";

        const metadata = log.metadata as Record<string, unknown> | null;
        const ipAddress = (metadata?.ipAddress as string) || "";
        const userAgent = (metadata?.userAgent as string) || "";

        return [
          timestamp,
          log.action,
          log.entityType,
          log.entityId || "",
          log.entityName || "",
          log.userId === SYSTEM_ACTOR_ID
            ? t("systemActor")
            : log.userName || log.userId || "",
          log.userEmail || "",
          log.project?.name || "",
          ipAddress,
          userAgent,
          log.metadata ? JSON.stringify(log.metadata) : "",
        ];
      });

      const escapeCsvValue = (value: string) => {
        if (
          value.includes(",") ||
          value.includes('"') ||
          value.includes("\n")
        ) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };

      const csvContent = [
        headers.map(escapeCsvValue).join(","),
        ...csvRows.map((row) =>
          row.map((cell) => escapeCsvValue(String(cell))).join(",")
        ),
      ].join("\n");

      const blob = new Blob(["﻿" + csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      const exportedAt = new Date().toISOString().replace(/[:.]/g, "-");
      link.setAttribute("download", `audit-logs-export-${exportedAt}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      await logDataExport({
        exportType: "CSV",
        entityType: "AuditLog",
        recordCount: logs.length,
        projectId,
        filters: {
          projectId,
          search: debouncedSearchString || undefined,
          action: actionFilter.length > 0 ? actionFilter : undefined,
          entityType:
            entityTypeFilter.length > 0 ? entityTypeFilter : undefined,
          user:
            selectedUsers.length > 0
              ? selectedUsers.map((user) => user.userId)
              : undefined,
          dateFrom: dateRange?.from?.toISOString(),
          dateTo: dateRange?.to?.toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to export audit logs:", error);
    } finally {
      setIsExporting(false);
    }
  }, [
    refetchAllLogs,
    t,
    tGlobal,
    projectId,
    debouncedSearchString,
    actionFilter,
    entityTypeFilter,
    selectedUsers,
    dateRange,
  ]);

  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  // Reuse the admin audit-log columns, but drop the project column — every row
  // belongs to the same project here.
  const allColumns = useColumns(userPreferences, handleViewDetails, t, tCommon);
  const columns = useMemo(
    () => allColumns.filter((c) => c.id !== "project"),
    [allColumns]
  );

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  // Surface the export handler + its state to the page so the Export button can
  // render in the card header alongside the title (matching the admin layout).
  useEffect(() => {
    onExportStateChange?.({
      canExport: (totalCount ?? 0) > 0,
      isExporting,
      exportCsv: handleExportCsv,
    });
  }, [onExportStateChange, totalCount, isExporting, handleExportCsv]);

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <Filter
        key="project-audit-logs-filter"
        className="max-w-none"
        placeholder={t("filterPlaceholder")}
        initialSearchString={searchString}
        onSearchChange={setSearchString}
      />

      {/* Filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <Label className="sr-only">{t("timeRange")}</Label>
          <Form {...dateForm}>
            <DateRangePickerField control={dateForm.control} name="dateRange" />
          </Form>
        </div>

        <div data-testid="project-audit-log-action-filter">
          <Label className="sr-only">{t("filterAction")}</Label>
          <MultiAsyncCombobox<AuditAction>
            value={actionFilter}
            onValueChange={setActionFilter}
            fetchOptions={fetchActionOptions}
            getOptionValue={(action) => action}
            getOptionLabel={formatAuditAction}
            renderOption={(action) => (
              <span className="truncate">{formatAuditAction(action)}</span>
            )}
            placeholder={t("allActions")}
            pageSize={FILTER_PAGE_SIZE}
          />
        </div>

        <div>
          <Label className="sr-only">{t("filterEntityType")}</Label>
          <MultiAsyncCombobox<string>
            value={entityTypeFilter}
            onValueChange={setEntityTypeFilter}
            fetchOptions={fetchEntityTypeOptions}
            getOptionValue={(entityType) => entityType}
            getOptionLabel={(entityType) => entityType}
            renderOption={(entityType) => (
              <span className="truncate">{entityType}</span>
            )}
            placeholder={t("allEntityTypes")}
            pageSize={FILTER_PAGE_SIZE}
          />
        </div>

        <div>
          <Label className="sr-only">{tCommon("access.user")}</Label>
          <MultiAsyncCombobox<AuditLogUserOption>
            value={selectedUsers}
            onValueChange={setSelectedUsers}
            fetchOptions={fetchUserOptions}
            getOptionValue={(u) => u.userId}
            getOptionLabel={(u) =>
              u.userId === SYSTEM_ACTOR_ID
                ? t("systemActor")
                : u.userName || u.userEmail || u.userId
            }
            placeholder={t("allUsers")}
            pageSize={FILTER_PAGE_SIZE}
            renderOption={(u) => {
              const isSystem = u.userId === SYSTEM_ACTOR_ID;
              const primary = isSystem
                ? t("systemActor")
                : u.userName || u.userEmail || u.userId;
              const secondary =
                !isSystem && u.userName && u.userEmail ? u.userEmail : null;
              return (
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {primary}
                  </span>
                  {secondary && (
                    <span className="truncate text-xs text-muted-foreground">
                      {secondary}
                    </span>
                  )}
                </div>
              );
            }}
          />
        </div>
      </div>

      {/* Controls Row */}
      <div className="flex justify-between items-center">
        <ColumnSelection
          key="project-audit-logs-column-selection"
          storageKey="project-audit-logs"
          columns={columns}
          onVisibilityChange={setColumnVisibility}
        />

        {rows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("showing", {
              loaded: rows.length.toLocaleString(locale),
              total: (totalCount ?? rows.length).toLocaleString(locale),
            })}
          </p>
        )}
      </div>

      {/* Data Table — virtualized, infinite scroll. The table sits inside the
          gap-4 column, so its own top margin is dropped to avoid doubling the
          space above it (matches the admin audit-log toolbar→table gap). */}
      <div className="h-[calc(100vh-22rem)] min-h-[400px] w-full">
        <VirtualizedDataTable
          columns={columns as any}
          data={groupedData as any}
          getSubRows={(row) => row.auditChildren}
          subRowsLabel={t("relatedChanges")}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          flexColumnId="entityName"
          columnSizingStorageKey="project-audit-log"
          hasMore={!!hasNextPage}
          isLoading={isLoading || isFetchingNextPage}
          onLoadMore={fetchNextPage}
          resetKey={`${debouncedSearchString}|${actionFilter.join(",")}|${entityTypeFilter.join(",")}|${selectedUsers.map((u) => u.userId).join(",")}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
          testIdPrefix="project-audit-logs-table"
          rowTestIdPrefix="project-audit-log-row"
        />
      </div>

      <AuditLogDetailModal
        logId={selectedLogId}
        open={!!selectedLogId}
        onClose={() => setSelectedLogId(null)}
      />
    </div>
  );
}
