"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateRange } from "react-day-picker";
import { useForm, useWatch } from "react-hook-form";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { AuditAction } from "~/zenstack/models";
import { endOfDay, endOfWeek, format, startOfDay, startOfWeek } from "date-fns";
import { Download } from "lucide-react";
import type { Session } from "next-auth";
import {
  AuditLogUserOption,
  searchAuditLogUsers,
} from "~/app/actions/searchAuditLogUsers";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { getAuditLogActions } from "~/app/actions/getAuditLogActions";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";
import { formatAuditAction } from "~/lib/audit/auditActions";
import { groupAuditRows } from "~/lib/audit/groupAuditRows";
import { logDataExport } from "~/lib/services/auditClient";
import { AuditLogDetailModal } from "./AuditLogDetailModal";
import { buildAuditLogOrderBy, ExtendedAuditLog, useColumns } from "./columns";

// Rows fetched per scroll page. Audit rows are cheap (the heavy `changes` /
// `metadata` Json columns are excluded from the list select), and operationId
// grouping can collapse an entire page into one visible row, so a large batch
// keeps scrolling responsive without a burst of round trips.
const PAGE_SIZE = 1000;

// Options shown per page inside the filter pickers.
const FILTER_PAGE_SIZE = 25;

// The view opens on the current week. An unbounded read spans the whole audit
// table — the most expensive query the page can issue and rarely the one an
// admin wants first — so the range starts narrow and the picker widens it
// (up to "All time") on demand. Monday start matches the picker's "This week".
const DEFAULT_DATE_PRESET = "thisWeek";
const WEEK_STARTS_ON = 1;

function currentWeekRange(): DateRange {
  const now = new Date();
  return {
    from: startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON }),
    to: endOfWeek(now, { weekStartsOn: WEEK_STARTS_ON }),
  };
}

interface ProjectFilterOption {
  id: number;
  name: string;
}

export default function AuditLogsPage() {
  return <AuditLogsGuard />;
}

/**
 * Auth guard component that handles session loading and authorization.
 * Renders AuditLogsContent only after auth checks pass.
 */
function AuditLogsGuard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  // Show nothing while loading
  if (status === "loading") {
    return null;
  }

  // Redirect handled by useEffect, show nothing for non-admins
  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  // Only render content when we have a valid admin session
  return <AuditLogsContent session={session} />;
}

/**
 * Main audit logs content component.
 * Only rendered after auth checks pass, so session is guaranteed to be valid.
 */
function AuditLogsContent({ session }: { session: Session }) {
  const locale = useLocale();
  const t = useTranslations("admin.auditLogs");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tUserMenu = useTranslations("userMenu");

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "timestamp",
    direction: "desc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  // Every filter below is additive: an empty selection means "no filter", so
  // the picker placeholder reads "All …".
  const [actionFilter, setActionFilter] = useState<AuditAction[]>([]);
  const [entityTypeFilter, setEntityTypeFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<ProjectFilterOption[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<AuditLogUserOption[]>([]);
  const defaultDateRange = useMemo(() => currentWeekRange(), []);
  const dateForm = useForm<{ dateRange: DateRange | undefined }>({
    defaultValues: { dateRange: defaultDateRange },
  });
  const dateRange = useWatch({
    control: dateForm.control,
    name: "dateRange",
  });
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Build where clause
  const whereClause = useMemo(() => {
    const conditions: any[] = [];

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

    if (projectFilter.length > 0) {
      conditions.push({
        projectId: { in: projectFilter.map((project) => project.id) },
      });
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

    return conditions.length > 0 ? { AND: conditions } : {};
  }, [
    debouncedSearchString,
    actionFilter,
    entityTypeFilter,
    projectFilter,
    selectedUsers,
    dateRange,
  ]);

  // Total count for the filtered set — drives the "loaded of total" footer and
  // gates the export button.
  const { data: totalCount } = useClientQueries(schema).auditLog.useCount({
    where: whereClause,
  });

  // Fetch audit logs as an infinite, virtualized stream — the list only needs
  // the columns the table renders. Excludes the `changes` and `metadata` Json
  // columns, which can be large for CREATE / UPDATE events on entities with
  // rich payloads (e.g. test cases with Tiptap step content); both are fetched
  // on demand in AuditLogDetailModal via useFindUniqueAuditLog.
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

  // Cast via unknown: the live AuditLog columns include operationId/sourceTable
  // (added to the schema), but the not-yet-regenerated Prisma client types them
  // as never in the select payload, so a direct cast doesn't overlap. Memoized
  // so the grouping pass below only reruns when the page set actually changes.
  const rows = useMemo(
    () => (pages?.pages.flat() ?? []) as unknown as ExtendedAuditLog[],
    [pages]
  );

  // Collapse rows sharing an operationId into one expandable lead (COR-04). The
  // grouping rule lives entirely in the shared helper; here we only flatten each
  // group into a lead row carrying its children as expandable sub-rows.
  const groupedData = useMemo(
    () =>
      groupAuditRows(rows).map((group) =>
        group.children.length > 0
          ? { ...group.lead, auditChildren: group.children }
          : group.lead
      ),
    [rows]
  );

  // Get unique entity types for filter
  const { data: entityTypes } = useClientQueries(schema).auditLog.useFindMany({
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });

  // Distinct projects that appear in the audit log, for the project filter.
  // Sourced from the log itself (policy-enforced) so the dropdown never lists a
  // project with no audit rows and never leaks projects outside the viewer's reach.
  const { data: projectRows } = useClientQueries(schema).auditLog.useFindMany({
    where: { projectId: { not: null } },
    select: { projectId: true, project: { select: { name: true } } },
    distinct: ["projectId"],
    orderBy: { projectId: "asc" },
  });

  const projectOptions = useMemo<ProjectFilterOption[]>(() => {
    const options = (projectRows ?? [])
      .filter(
        (row): row is { projectId: number; project: { name: string } } =>
          row.projectId != null && !!row.project?.name
      )
      .map((row) => ({ id: row.projectId, name: row.project.name }));
    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [projectRows]);

  // Distinct actors in the audit log, paginated and searched server-side —
  // the table can hold far more users than a plain select can list.
  const fetchUserOptions = useCallback(
    (query: string, page: number, pageSize: number) =>
      searchAuditLogUsers(query, page, pageSize),
    []
  );

  // Distinct actions present in the log, fetched once when the picker first
  // opens and filtered/paged locally afterwards.
  const actionsPromiseRef = useRef<Promise<AuditAction[]> | null>(null);
  const fetchActionOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      actionsPromiseRef.current ??= getAuditLogActions();
      const actions = await actionsPromiseRef.current;
      // An empty list may be a failed fetch — let the next call retry.
      if (actions.length === 0) actionsPromiseRef.current = null;
      const q = query.trim().toLowerCase();
      const filtered = q
        ? actions.filter((action) =>
            formatAuditAction(action).toLowerCase().includes(q)
          )
        : actions;
      return {
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      };
    },
    []
  );

  // Entity-type / project options are already in memory, so their pickers
  // filter and page locally.
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

  const fetchProjectOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.trim().toLowerCase();
      const filtered = q
        ? projectOptions.filter((project) =>
            project.name.toLowerCase().includes(q)
          )
        : projectOptions;
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [projectOptions]
  );

  const handleViewDetails = useCallback((log: { id: string }) => {
    setSelectedLogId(log.id);
  }, []);

  // Fetch all logs for export (no pagination)
  const { refetch: refetchAllLogs } = useClientQueries(
    schema
  ).auditLog.useFindMany(
    {
      orderBy: buildAuditLogOrderBy(sortConfig),
      include: {
        project: {
          select: { name: true },
        },
      },
      where: whereClause,
    },
    {
      enabled: false, // Don't fetch automatically, only when exporting
    }
  );

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      // Fetch all filtered logs
      const { data: logs } = await refetchAllLogs();

      if (!logs || logs.length === 0) {
        setIsExporting(false);
        return;
      }

      // Define CSV headers
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

      // Convert logs to CSV rows
      const csvRows = logs.map((log: ExtendedAuditLog) => {
        const timestamp = log.timestamp
          ? format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")
          : "";

        // Extract ipAddress and userAgent from metadata if available
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

      // Create CSV content
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

      // Create and download file
      const blob = new Blob(["﻿" + csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.setAttribute("download", `audit-logs-export-${timestamp}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Log the export for audit trail
      await logDataExport({
        exportType: "CSV",
        entityType: "AuditLog",
        recordCount: logs.length,
        filters: {
          search: debouncedSearchString || undefined,
          action: actionFilter.length > 0 ? actionFilter : undefined,
          entityType:
            entityTypeFilter.length > 0 ? entityTypeFilter : undefined,
          project:
            projectFilter.length > 0
              ? projectFilter.map((project) => project.id)
              : undefined,
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
    debouncedSearchString,
    actionFilter,
    entityTypeFilter,
    projectFilter,
    selectedUsers,
    dateRange,
  ]);

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns = useColumns(
    userPreferences,
    handleViewDetails,
    t,
    tCommon,
    tUserMenu
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  // Toggle sort direction on the clicked column; the new orderBy restarts the
  // infinite query from the first page.
  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="audit-logs-page-title">
                {tGlobal("admin.menu.auditLogs")}
              </CardTitle>
              <HelpPopover helpKey="auditLogs" />
            </SectionHeader>
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={isExporting || !totalCount}
              aria-label={t("exportCsv")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <Download className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                {isExporting
                  ? tGlobal("repository.exportModal.exporting")
                  : t("exportCsv")}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Search */}
            <Filter
              key="audit-logs-filter"
              className="max-w-none"
              placeholder={t("filterPlaceholder")}
              initialSearchString={searchString}
              onSearchChange={setSearchString}
            />

            {/* Filters */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <Label className="sr-only">{t("timeRange")}</Label>
                <Form {...dateForm}>
                  <DateRangePickerField
                    control={dateForm.control}
                    name="dateRange"
                    defaultPreset={DEFAULT_DATE_PRESET}
                  />
                </Form>
              </div>

              <div>
                <Label className="sr-only">{t("filterAction")}</Label>
                <MultiAsyncCombobox<AuditAction>
                  value={actionFilter}
                  onValueChange={setActionFilter}
                  fetchOptions={fetchActionOptions}
                  getOptionValue={(action) => action}
                  getOptionLabel={formatAuditAction}
                  renderOption={(action) => (
                    <span className="truncate">
                      {formatAuditAction(action)}
                    </span>
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
                <Label className="sr-only">{tCommon("fields.project")}</Label>
                <MultiAsyncCombobox<ProjectFilterOption>
                  value={projectFilter}
                  onValueChange={setProjectFilter}
                  fetchOptions={fetchProjectOptions}
                  getOptionValue={(project) => project.id}
                  getOptionLabel={(project) => project.name}
                  renderOption={(project) => (
                    <span className="truncate">{project.name}</span>
                  )}
                  placeholder={t("allProjects")}
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
                      !isSystem && u.userName && u.userEmail
                        ? u.userEmail
                        : null;
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

            {/* Table toolbar: column control + result count */}
            <div className="flex items-center justify-between">
              <ColumnSelection
                key="audit-logs-column-selection"
                storageKey="admin-audit-logs"
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
          </div>

          {/* Data Table — virtualized, infinite scroll. The container sets an
              explicit height so the virtualizer's CSS-bounded scroll body has
              something to fill. */}
          <div className="mt-4 h-[calc(100vh-20rem)] min-h-[400px] w-full">
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
              hasMore={!!hasNextPage}
              isLoading={isLoading || isFetchingNextPage}
              onLoadMore={fetchNextPage}
              resetKey={`${debouncedSearchString}|${actionFilter.join(",")}|${entityTypeFilter.join(",")}|${projectFilter.map((p) => p.id).join(",")}|${selectedUsers.map((u) => u.userId).join(",")}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
              testIdPrefix="audit-logs-table"
              rowTestIdPrefix="audit-log-row"
            />
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal — fetches its own full record by id so the list query
          doesn't have to carry changes/metadata JSON for every row. */}
      <AuditLogDetailModal
        logId={selectedLogId}
        open={!!selectedLogId}
        onClose={() => setSelectedLogId(null)}
      />
    </main>
  );
}
