"use client";

import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { AuditAction } from "@prisma/client";
import type { VisibilityState } from "@tanstack/react-table";
import { endOfDay, startOfDay } from "date-fns";
import { History } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
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
import {
  useCountAuditLog,
  useFindManyAuditLog,
  useInfiniteFindManyAuditLog,
} from "~/lib/hooks";

const PAGE_SIZE = 50;
const ENTITY_TYPE = "RepositoryCases";

interface RepositoryCaseAuditLogSheetProps {
  caseId: number;
}

export function RepositoryCaseAuditLogSheet({
  caseId,
}: RepositoryCaseAuditLogSheetProps) {
  const t = useTranslations("repository.auditLog");
  const [open, setOpen] = useState(false);

  // Visibility is enforced by the AuditLog read policy, which grants test-case
  // audit access to anyone who can read the case. Reaching this page already
  // means the case is readable, so the entry point is shown to all viewers.
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
        >
          <History className="h-4 w-4 shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
            {t("trigger")}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        {/* Mount the table only while open so audit data loads on demand. */}
        {open && <CaseAuditLogContent caseId={caseId} />}
      </SheetContent>
    </Sheet>
  );
}

function CaseAuditLogContent({ caseId }: { caseId: number }) {
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
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const dateForm = useForm<{ dateRange: DateRange | undefined }>({
    defaultValues: { dateRange: undefined },
  });
  const dateRange = useWatch({ control: dateForm.control, name: "dateRange" });

  // Hard-scoped to this single test case. Case versions are intentionally
  // excluded — their field changes are already captured on the case itself.
  const whereClause = useMemo(() => {
    const conditions: any[] = [
      { entityType: ENTITY_TYPE },
      { entityId: String(caseId) },
    ];

    if (actionFilter !== "all") {
      conditions.push({ action: actionFilter });
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
  }, [caseId, actionFilter, dateRange]);

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

  const { data: totalCount } = useCountAuditLog({ where: whereClause });

  // Action options come from the distinct actions recorded for this case, so
  // the dropdown lists only relevant actions.
  const { data: actionRows } = useFindManyAuditLog({
    where: { entityType: ENTITY_TYPE, entityId: String(caseId) },
    select: { action: true },
    distinct: ["action"],
    orderBy: { action: "asc" },
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

  // Reuse the admin audit-log columns, but drop the columns that are constant
  // for a single case: project, entity type, and entity name.
  const allColumns = useColumns(
    userPreferences,
    handleViewDetails,
    t,
    tCommon,
    tUserMenu
  );
  const columns = useMemo(
    () =>
      allColumns.filter(
        (c) => !["project", "entityType", "entityName"].includes(c.id as string)
      ),
    [allColumns]
  );

  const hasFilter = actionFilter !== "all" || !!dateRange?.from;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {/* Data Table — virtualized, infinite scroll. */}
      <div className="h-[calc(100vh-16rem)] min-h-[320px] w-full">
        <VirtualizedDataTable
          columns={columns as any}
          data={groupedData as any}
          getSubRows={(row) => row.auditChildren}
          subRowsLabel={t("relatedChanges")}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          flexColumnId="userEmail"
          hasMore={!!hasNextPage}
          isLoading={isLoading || isFetchingNextPage}
          onLoadMore={fetchNextPage}
          emptyMessage={
            hasFilter ? tProfile("noMatchingEntries") : tProfile("noEntries")
          }
          resetKey={`${actionFilter}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
          testIdPrefix="case-audit-log-table"
          rowTestIdPrefix="case-audit-log-row"
        />
      </div>

      {rows.length > 0 && (
        <p className="text-right text-xs text-muted-foreground">
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
