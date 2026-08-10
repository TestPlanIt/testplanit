"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DataTable } from "@/components/tables/DataTable";
import {
  ActionButtonContent,
  collapsibleActionClass,
  useActionBarCompact,
} from "@/components/ui/action-bar";
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
import { AuditAction } from "~/zenstack/models";
import type { VisibilityState } from "@tanstack/react-table";
import { endOfDay, startOfDay } from "date-fns";
import { History } from "lucide-react";
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

interface ScopedAuditLogSheetProps {
  /** The AuditLog.entityType to scope to (e.g. RepositoryCases / TestRuns / Sessions). */
  entityType: string;
  /** The AuditLog.entityId to scope to. */
  entityId: string;
  /** Entity-flavored copy, supplied by the per-entity wrapper from its namespace. */
  triggerLabel: string;
  title: string;
  description: string;
  /** Stable, per-surface selectors so each entity's sheet is independently testable. */
  triggerTestId: string;
  tableTestIdPrefix: string;
  rowTestIdPrefix: string;
  /** Controlled open state (optional). When omitted the sheet self-manages. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger button (e.g. when opened from a menu item). */
  hideTrigger?: boolean;
}

/**
 * Entity-scoped audit history sheet — a slide-out "Activity" panel listing the
 * AuditLog rows for one entity (entityType + entityId). Reuses the admin audit
 * columns, operationId grouping, filters, infinite scroll, and detail modal.
 *
 * Visibility is enforced by the AuditLog read policy, which grants per-entity
 * audit access to anyone who can read the underlying case / run / session — so
 * reaching the entity's page already proves the sheet is allowed. Parameterized
 * so Cases, Runs, and Sessions share one implementation; the per-entity copy and
 * test ids are passed in by thin wrappers.
 */
export function ScopedAuditLogSheet({
  entityType,
  entityId,
  triggerLabel,
  title,
  description,
  triggerTestId,
  tableTestIdPrefix,
  rowTestIdPrefix,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: ScopedAuditLogSheetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  // Inside an ActionBar, follow its responsive collapse; outside one, keep the
  // legacy always-collapsed look.
  const collapsed = useActionBarCompact() ?? true;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={collapsibleActionClass(collapsed)}
            data-testid={triggerTestId}
          >
            <ActionButtonContent
              icon={History}
              label={triggerLabel}
              compact={collapsed}
              iconClassName="text-foreground h-4 w-4 shrink-0"
            />
          </Button>
        </SheetTrigger>
      )}
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {/* Mount the table only while open so audit data loads on demand. */}
        {open && (
          <ScopedAuditLogContent
            entityType={entityType}
            entityId={entityId}
            tableTestIdPrefix={tableTestIdPrefix}
            rowTestIdPrefix={rowTestIdPrefix}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScopedAuditLogContent({
  entityType,
  entityId,
  tableTestIdPrefix,
  rowTestIdPrefix,
}: {
  entityType: string;
  entityId: string;
  tableTestIdPrefix: string;
  rowTestIdPrefix: string;
}) {
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
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const dateForm = useForm<{ dateRange: DateRange | undefined }>({
    defaultValues: { dateRange: undefined },
  });
  const dateRange = useWatch({ control: dateForm.control, name: "dateRange" });

  // Hard-scoped to this single entity. Rolled-up child/value rows already share
  // the owning entity's entityType + entityId, so this captures them too.
  const whereClause = useMemo(() => {
    const conditions: any[] = [{ entityType }, { entityId }];

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
  }, [entityType, entityId, actionFilter, dateRange]);

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

  // Cast via unknown: operationId/sourceTable can type as never in the select
  // payload depending on client regeneration, so a direct cast doesn't overlap.
  const rows = useMemo(
    () => (pages?.pages.flat() ?? []) as unknown as ExtendedAuditLog[],
    [pages]
  );

  // Collapse rows sharing an operationId into one expandable lead via the shared
  // helper; flatten each group into a lead carrying its children.
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

  // Action options come from the distinct actions recorded for this entity, so
  // the dropdown lists only relevant actions.
  const { data: actionRows } = useClientQueries(schema).auditLog.useFindMany({
    where: { entityType, entityId },
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
  // for a single entity: project, entity type, and entity name.
  const allColumns = useColumns(userPreferences, handleViewDetails, t, tCommon);
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
          flexColumnId="userEmail"
          columnSizingStorageKey="scoped-audit-log"
          hasMore={!!hasNextPage}
          isLoading={isLoading || isFetchingNextPage}
          onLoadMore={fetchNextPage}
          emptyMessage={
            hasFilter ? tProfile("noMatchingEntries") : tProfile("noEntries")
          }
          resetKey={`${actionFilter}|${dateRange?.from?.toISOString() ?? ""}|${dateRange?.to?.toISOString() ?? ""}`}
          testIdPrefix={tableTestIdPrefix}
          rowTestIdPrefix={rowTestIdPrefix}
        />
      </div>

      {rows.length > 0 && (
        <p className="text-end text-xs text-muted-foreground">
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
