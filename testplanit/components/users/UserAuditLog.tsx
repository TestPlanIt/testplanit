"use client";
/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns unstable function references by design; same pattern as UnifiedSearch / MatrixGrid. */

import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuditAction } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AuditLogDetailModal } from "~/app/[locale]/admin/audit-logs/AuditLogDetailModal";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import {
  useCountAuditLog,
  useFindManyAuditLog,
  useInfiniteFindManyAuditLog,
} from "~/lib/hooks";

const PAGE_SIZE = 50;

function getActionBadgeVariant(
  action: AuditAction
): "default" | "secondary" | "destructive" | "outline" {
  switch (action) {
    case "CREATE":
    case "BULK_CREATE":
    case "API_KEY_CREATED":
      return "default";
    case "DELETE":
    case "BULK_DELETE":
    case "API_KEY_DELETED":
    case "API_KEY_REVOKED":
    case "LOGIN_FAILED":
      return "destructive";
    case "UPDATE":
    case "BULK_UPDATE":
    case "API_KEY_REGENERATED":
      return "secondary";
    default:
      return "outline";
  }
}

interface UserAuditLogProps {
  userId: string;
  total?: number | null;
}

export function UserAuditLog({ userId, total }: UserAuditLogProps) {
  const { data: session } = useSession();
  const t = useTranslations("users.profile.auditLog");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<AuditAction | "all">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const where = {
    userId,
    ...(actionFilter !== "all" ? { action: actionFilter } : {}),
    ...(typeFilter !== "all" ? { entityType: typeFilter } : {}),
  };
  const baseArgs = {
    where,
    orderBy: { timestamp: "desc" as const },
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
  });

  const rows = pages?.pages.flat() ?? [];

  // Filter options come from the distinct values this user has actually
  // generated, so each dropdown lists only relevant actions/types rather than
  // the full AuditAction enum or every entity in the system.
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

  // When a filter is active the parent's unfiltered `total` no longer matches
  // what's shown, so count the filtered set instead (skipped otherwise).
  const hasFilter = actionFilter !== "all" || typeFilter !== "all";
  const { data: filteredCount } = useCountAuditLog(
    { where },
    { enabled: hasFilter }
  );
  const effectiveTotal = hasFilter ? filteredCount : total;

  const { scrollRef, sentinelRef, virtualItems, totalSize, measureElement } =
    useVirtualizedInfiniteList({
      count: rows.length,
      estimateSize: 40,
      overscan: 8,
      hasMore: !!hasNextPage,
      isLoading: isLoading || isFetchingNextPage,
      onLoadMore: fetchNextPage,
      boundToViewport: false,
      resetKey: `${actionFilter}|${typeFilter}`,
    });

  // Only collapse to the bare empty state when the user has no audit history at
  // all. With a filter applied we keep the controls mounted so an empty result
  // can be cleared.
  if (!hasFilter && !isLoading && rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">{t("noEntries")}</p>
    );
  }

  const showEmpty = !isLoading && rows.length === 0;

  const dateFormat =
    session?.user.preferences?.dateFormat &&
    session?.user.preferences?.timeFormat
      ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat}`
      : session?.user.preferences?.dateFormat;

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <Select
          value={actionFilter}
          onValueChange={(value) =>
            setActionFilter(value as AuditAction | "all")
          }
        >
          <SelectTrigger
            className="h-8 w-[170px] text-xs"
            aria-label={t("columnAction")}
          >
            <SelectValue />
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

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger
            className="h-8 w-[170px] text-xs"
            aria-label={t("columnEntityType")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTypes")}</SelectItem>
            {typeRows?.map((row) => (
              <SelectItem key={row.entityType} value={row.entityType}>
                {row.entityType}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[140px_120px_1fr_140px] gap-2 px-2 pb-1 border-b text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <span>{t("columnAction")}</span>
        <span>{t("columnEntityType")}</span>
        <span>{t("columnEntityName")}</span>
        <span className="text-right">{t("columnTimestamp")}</span>
      </div>

      {showEmpty ? (
        <p className="text-sm text-muted-foreground py-2">
          {t("noMatchingEntries")}
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto"
          style={{ overflowAnchor: "none" }}
        >
          <div style={{ height: totalSize, position: "relative" }}>
            {virtualItems.map((vItem) => {
              const log = rows[vItem.index];
              if (!log) return null;
              return (
                <div
                  key={log.id}
                  data-index={vItem.index}
                  ref={measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setDetailId(log.id)}
                    className="w-full grid grid-cols-[140px_120px_1fr_140px] gap-2 items-center py-1.5 px-2 text-left hover:bg-accent transition-colors border-b border-border/40 last:border-0"
                  >
                    <span>
                      <Badge
                        variant={getActionBadgeVariant(log.action)}
                        className="text-xs"
                      >
                        {log.action.replace(/_/g, " ")}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {log.entityType}
                    </span>
                    <span className="text-sm truncate">
                      {log.entityName ?? (
                        <span className="text-muted-foreground">{"—"}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground text-right">
                      <DateFormatter
                        date={log.timestamp}
                        formatString={dateFormat}
                        timezone={session?.user.preferences?.timezone}
                      />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div ref={sentinelRef} style={{ height: 1 }} />
          {isFetchingNextPage && (
            <div className="py-2 text-center text-xs text-muted-foreground">
              {t("loadMore")}
              {"…"}
            </div>
          )}
        </div>
      )}

      {/* Footer: loaded / total */}
      {rows.length > 0 && (
        <p className="pt-1 text-xs text-muted-foreground text-right">
          {t("showing", {
            loaded: rows.length.toLocaleString(),
            total: (effectiveTotal ?? rows.length).toLocaleString(),
          })}
        </p>
      )}

      <AuditLogDetailModal
        logId={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />
    </>
  );
}
