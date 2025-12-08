"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import { useFindManyAuditLog, useCountAuditLog } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedAuditLog, getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AuditLogDetailModal } from "./AuditLogDetailModal";
import { AuditAction } from "@prisma/client";
import { ShieldCheck } from "lucide-react";
import type { Session } from "next-auth";

type PageSizeOption = number | "All";

export default function AuditLogsPage() {
  return (
    <PaginationProvider>
      <AuditLogsGuard />
    </PaginationProvider>
  );
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
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
    startIndex,
    endIndex,
    totalPages,
  } = usePagination();

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
  const [selectedLog, setSelectedLog] = useState<ExtendedAuditLog | null>(null);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems || 100;
  const skip = (currentPage - 1) * effectivePageSize;

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

    return conditions.length > 0 ? { AND: conditions } : {};
  }, [debouncedSearchString, actionFilter, entityTypeFilter]);

  // Get total count
  const { data: totalCount } = useCountAuditLog({ where: whereClause });

  // Update total items in pagination context
  useEffect(() => {
    if (typeof totalCount === "number") {
      setTotalItems(totalCount);
    }
  }, [totalCount, setTotalItems]);

  // Fetch audit logs
  const { data: auditLogs, isLoading } = useFindManyAuditLog(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { timestamp: "desc" },
      include: {
        project: {
          select: { name: true },
        },
      },
      where: whereClause,
      take: effectivePageSize,
      skip: skip,
    },
    {
      refetchOnWindowFocus: false,
    }
  );

  // Get unique entity types for filter
  const { data: entityTypes } = useFindManyAuditLog({
    select: { entityType: true },
    distinct: ["entityType"],
    orderBy: { entityType: "asc" },
  });

  const pageSizeOptions: PageSizeOption[] = useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, actionFilter, entityTypeFilter, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  const handleViewDetails = useCallback((log: ExtendedAuditLog) => {
    setSelectedLog(log);
  }, []);

  const columns = useMemo(
    () => getColumns(session, handleViewDetails, t),
    [session, handleViewDetails, t]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1);
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
                {t("title")}
              </CardTitle>
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-2">
            {t("description")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Filters Row */}
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[250px]">
                <Filter
                  key="audit-logs-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
              </div>

              <div className="w-[180px]">
                <Label className="text-sm mb-1 block">
                  {t("filterAction")}
                </Label>
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
                <Label className="text-sm mb-1 block">
                  {t("filterEntityType")}
                </Label>
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

              <div>
                <ColumnSelection
                  key="audit-logs-column-selection"
                  columns={columns}
                  onVisibilityChange={setColumnVisibility}
                />
              </div>
            </div>

            {/* Pagination Row */}
            <div className="flex justify-between items-center">
              <div className="text-sm text-muted-foreground">
                {totalItems > 0 &&
                  t("showing", {
                    start: startIndex + 1,
                    end: Math.min(endIndex, totalItems),
                    total: totalItems,
                  })}
              </div>
              <div className="flex items-center gap-4">
                {totalItems > 0 && (
                  <>
                    <PaginationInfo
                      key="audit-logs-pagination-info"
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalItems}
                      searchString={searchString}
                      pageSize={typeof pageSize === "number" ? pageSize : "All"}
                      pageSizeOptions={pageSizeOptions}
                      handlePageSizeChange={(size) => setPageSize(size)}
                    />
                    <PaginationComponent
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPageChange={setCurrentPage}
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Data Table */}
          <div className="mt-4">
            <DataTable
              columns={columns as any}
              data={(auditLogs || []) as any}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              pageSize={typeof pageSize === "number" ? pageSize : totalItems}
              isLoading={isLoading}
            />
          </div>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <AuditLogDetailModal
        log={selectedLog}
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
      />
    </main>
  );
}
