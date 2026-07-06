"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
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
import { endOfDay, format, startOfDay } from "date-fns";
import { Download, Users } from "lucide-react";
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
import type { AuditLogUserOption } from "~/app/actions/searchAuditLogUsers";
import { searchProjectAuditLogUsers } from "~/app/actions/searchProjectAuditLogUsers";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { groupAuditRows } from "~/lib/audit/groupAuditRows";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";
import { logDataExport } from "~/lib/services/auditClient";

// Rows fetched per scroll page — matches the admin audit-log surface: audit
// rows are cheap (heavy Json columns excluded) and operationId grouping can
// collapse a whole page into one visible row, so batch large.
const PAGE_SIZE = 1000;

interface ProjectAuditLogProps {
  projectId: number;
}

export function ProjectAuditLog({ projectId }: ProjectAuditLogProps) {
  const { data: session } = useSession();
  const t = useTranslations("admin.auditLogs");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tUserMenu = useTranslations("userMenu");

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "timestamp", direction: "desc" });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [selectedUser, setSelectedUser] = useState<AuditLogUserOption | null>(
    null
  );
  const userFilter = selectedUser?.userId ?? "all";
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

    if (actionFilter !== "all") {
      conditions.push({ action: actionFilter });
    }

    if (entityTypeFilter !== "all") {
      conditions.push({ entityType: entityTypeFilter });
    }

    if (userFilter !== "all") {
      conditions.push({ userId: userFilter });
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
    userFilter,
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

  // Entity types present in this project's audit log, so the filter lists only
  // relevant types.
  const { data: entityTypes } = useClientQueries(schema).auditLog.useFindMany({
    where: { projectId },
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });

  const fetchUserOptions = useCallback(
    (query: string, page: number, pageSize: number) =>
      searchProjectAuditLogUsers(projectId, query, page, pageSize),
    [projectId]
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
          log.userName || tGlobal("userMenu.themes.system"),
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
          action: actionFilter !== "all" ? actionFilter : undefined,
          entityType: entityTypeFilter !== "all" ? entityTypeFilter : undefined,
          user: userFilter !== "all" ? userFilter : undefined,
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
    userFilter,
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
  const allColumns = useColumns(
    userPreferences,
    handleViewDetails,
    t,
    tCommon,
    tUserMenu
  );
  const columns = useMemo(
    () => allColumns.filter((c) => c.id !== "project"),
    [allColumns]
  );

  const auditActions: AuditAction[] = [
    "CREATE",
    "UPDATE",
    "DELETE",
    "BULK_CREATE",
    "BULK_UPDATE",
    "BULK_DELETE",
    "DATA_EXPORTED",
  ];

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search + Export Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[350px] flex-1">
          <Filter
            key="project-audit-logs-filter"
            placeholder={t("filterPlaceholder")}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
          />
        </div>

        <Button
          variant="outline"
          onClick={handleExportCsv}
          disabled={isExporting || !totalCount}
        >
          <Download className="h-4 w-4" />
          {isExporting
            ? tGlobal("repository.exportModal.exporting")
            : t("exportCsv")}
        </Button>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-[260px]">
          <Label className="sr-only">{t("timeRange")}</Label>
          <Form {...dateForm}>
            <DateRangePickerField control={dateForm.control} name="dateRange" />
          </Form>
        </div>

        <div className="w-[180px]">
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
              {auditActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[180px]">
          <Label className="sr-only">{t("filterEntityType")}</Label>
          <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder={t("allEntityTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allEntityTypes")}</SelectItem>
              {entityTypes?.map((et) => (
                <SelectItem key={et.entityType} value={et.entityType}>
                  {et.entityType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[260px]">
          <Label className="sr-only">{tCommon("access.user")}</Label>
          <AsyncCombobox<AuditLogUserOption>
            className="w-full"
            value={selectedUser}
            onValueChange={setSelectedUser}
            fetchOptions={fetchUserOptions}
            getOptionValue={(u) => u.userId}
            placeholder={tCommon("searchUsers")}
            showTotal
            showUnassigned
            unassignedLabel={t("allUsers")}
            unassignedIcon={<Users className="mr-2 h-4 w-4" />}
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
              loaded: rows.length.toLocaleString(),
              total: (totalCount ?? rows.length).toLocaleString(),
            })}
          </p>
        )}
      </div>

      {/* Data Table — virtualized, infinite scroll. */}
      <div className="mt-4 h-[calc(100vh-22rem)] min-h-[400px] w-full">
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
          resetKey={`${debouncedSearchString}|${actionFilter}|${entityTypeFilter}|${userFilter}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
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
