"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DateRange } from "react-day-picker";
import { useForm, useWatch } from "react-hook-form";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { endOfDay, format, startOfDay } from "date-fns";
import { Download, ShieldCheck, Users } from "lucide-react";
import type { Session } from "next-auth";
import {
  AuditLogUserOption,
  searchAuditLogUsers,
} from "~/app/actions/searchAuditLogUsers";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";
import {
  useCountAuditLog,
  useFindManyAuditLog,
  useInfiniteFindManyAuditLog,
} from "~/lib/hooks";
import { groupAuditRows } from "~/lib/audit/groupAuditRows";
import { logDataExport } from "~/lib/services/auditClient";
import { AuditLogDetailModal } from "./AuditLogDetailModal";
import { buildAuditLogOrderBy, ExtendedAuditLog, useColumns } from "./columns";

const PAGE_SIZE = 50;

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
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [selectedUser, setSelectedUser] = useState<AuditLogUserOption | null>(
    null
  );
  const userFilter = selectedUser?.userId ?? "all";
  const dateForm = useForm<{ dateRange: DateRange | undefined }>({
    defaultValues: { dateRange: undefined },
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

    if (actionFilter !== "all") {
      conditions.push({ action: actionFilter });
    }

    if (entityTypeFilter !== "all") {
      conditions.push({ entityType: entityTypeFilter });
    }

    if (projectFilter !== "all") {
      conditions.push({ projectId: parseInt(projectFilter, 10) });
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

    return conditions.length > 0 ? { AND: conditions } : {};
  }, [
    debouncedSearchString,
    actionFilter,
    entityTypeFilter,
    projectFilter,
    userFilter,
    dateRange,
  ]);

  // Total count for the filtered set — drives the "loaded of total" footer and
  // gates the export button.
  const { data: totalCount } = useCountAuditLog({ where: whereClause });

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
  const { data: entityTypes } = useFindManyAuditLog({
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });

  // Distinct projects that appear in the audit log, for the project filter.
  // Sourced from the log itself (policy-enforced) so the dropdown never lists a
  // project with no audit rows and never leaks projects outside the viewer's reach.
  const { data: projectRows } = useFindManyAuditLog({
    where: { projectId: { not: null } },
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

  // Distinct actors in the audit log, paginated and searched server-side —
  // the table can hold far more users than a plain select can list.
  const fetchUserOptions = useCallback(
    (query: string, page: number, pageSize: number) =>
      searchAuditLogUsers(query, page, pageSize),
    []
  );

  const handleViewDetails = useCallback((log: { id: string }) => {
    setSelectedLogId(log.id);
  }, []);

  // Fetch all logs for export (no pagination)
  const { refetch: refetchAllLogs } = useFindManyAuditLog(
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
          action: actionFilter !== "all" ? actionFilter : undefined,
          entityType: entityTypeFilter !== "all" ? entityTypeFilter : undefined,
          project: projectFilter !== "all" ? projectFilter : undefined,
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
    debouncedSearchString,
    actionFilter,
    entityTypeFilter,
    projectFilter,
    userFilter,
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

  // All audit actions for filter
  const auditActions: AuditAction[] = [
    "CREATE",
    "UPDATE",
    "DELETE",
    "BULK_CREATE",
    "BULK_UPDATE",
    "BULK_DELETE",
    "LOGIN",
    "LOGOUT",
    "LOGIN_FAILED",
    "SESSION_INVALIDATED",
    "PASSWORD_CHANGED",
    "PASSWORD_RESET",
    "PERMISSION_GRANT",
    "PERMISSION_REVOKE",
    "ROLE_CHANGED",
    "API_KEY_CREATED",
    "API_KEY_REGENERATED",
    "API_KEY_DELETED",
    "API_KEY_REVOKED",
    "DATA_EXPORTED",
    "SSO_CONFIG_CHANGED",
    "SYSTEM_CONFIG_CHANGED",
  ];

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-8 w-8" />
              <CardTitle data-testid="audit-logs-page-title">
                {tGlobal("admin.menu.auditLogs")}
              </CardTitle>
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-2">
            {t("description")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Search + Export Row */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-[350px]">
                <Filter
                  key="audit-logs-filter"
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
                  <DateRangePickerField
                    control={dateForm.control}
                    name="dateRange"
                  />
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
                <Select
                  value={entityTypeFilter}
                  onValueChange={setEntityTypeFilter}
                >
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

              <div className="w-[180px]">
                <Label className="sr-only">{tCommon("fields.project")}</Label>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("allProjects")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allProjects")}</SelectItem>
                    {projectOptions.map((project) => (
                      <SelectItem
                        key={project.id}
                        value={project.id.toString()}
                      >
                        {project.name}
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

            {/* Controls Row */}
            <div className="flex justify-between items-center">
              <ColumnSelection
                key="audit-logs-column-selection"
                storageKey="admin-audit-logs"
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
              resetKey={`${debouncedSearchString}|${actionFilter}|${entityTypeFilter}|${projectFilter}|${userFilter}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
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
