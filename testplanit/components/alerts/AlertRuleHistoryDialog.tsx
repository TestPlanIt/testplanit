"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Webhook } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { DateFormatter } from "@/components/DateFormatter";
import { DataTable } from "@/components/tables/DataTable";
import type { ColumnDef } from "@/components/tables/tableFeatures";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AlertEvent } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";
import { AlertRuleSummary } from "./AlertRuleSummary";
import {
  AlertSubjectDisplay,
  useAlertSubjectMeta,
} from "./AlertSubjectDisplay";
import type { AlertRuleLike } from "./alertRuleForm";

const PAGE_SIZE = 50;

/** The last firings of one rule: when, for what, the numbers, who was told. */
export function AlertRuleHistoryDialog({
  open,
  onOpenChange,
  rule,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: (AlertRuleLike & { id: number }) | null;
  projectId: number;
}) {
  const t = useTranslations("alerts");
  const tGlobal = useTranslations();
  const locale = useLocale();
  const { data: session } = useSession();
  const preferences = session?.user?.preferences;
  const client = useClientQueries(schema);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const where = { ruleId: rule?.id ?? -1 };
  const baseArgs = useMemo(
    () => ({
      where,
      orderBy: { firedAt: "desc" as const },
      take: PAGE_SIZE,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rule?.id]
  );
  const enabled = open && rule != null;

  // Newest first, pulled in pages as the table scrolls.
  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = client.alertEvent.useInfiniteFindMany(baseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...baseArgs, skip: allPages.flat().length };
    },
    enabled,
    refetchOnWindowFocus: false,
  });
  const { data: total } = client.alertEvent.useCount({ where }, { enabled });
  const rows = useMemo(
    () => (pages?.pages.flat() ?? []) as AlertEvent[],
    [pages]
  );
  const subjectMeta = useAlertSubjectMeta(rows);

  const format = (value: number | null | undefined) =>
    value == null
      ? ""
      : Number.isInteger(value)
        ? String(value)
        : value.toFixed(2);

  const columns = useMemo<ColumnDef<AlertEvent>[]>(
    () => [
      {
        id: "firedAt",
        accessorKey: "firedAt",
        header: t("historyDialog.columns.firedAt"),
        enableSorting: false,
        enableResizing: true,
        size: 180,
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-sm">
            <DateFormatter
              date={row.original.firedAt}
              formatString={`${preferences?.dateFormat || "MM-dd-yyyy"} ${preferences?.timeFormat || "HH:mm"}`}
              timezone={preferences?.timezone || "Etc/UTC"}
            />
          </div>
        ),
      },
      {
        id: "subject",
        accessorKey: "subjectName",
        header: t("historyDialog.columns.subject"),
        enableSorting: false,
        enableResizing: true,
        enableHiding: false,
        size: 290,
        cell: ({ row }) => {
          const event = row.original;
          const details = (event.details ?? {}) as Record<string, unknown>;
          const testRunId =
            typeof details.testRunId === "number" ? details.testRunId : null;
          return (
            <div className="min-w-0 text-sm">
              <AlertSubjectDisplay
                subjectType={event.subjectType}
                subjectId={event.subjectId}
                subjectName={event.subjectName}
                projectId={projectId}
                testRunId={testRunId}
                meta={subjectMeta}
              />
            </div>
          );
        },
      },
      {
        id: "observed",
        accessorKey: "observedValue",
        header: t("historyDialog.columns.observed"),
        enableSorting: false,
        enableResizing: true,
        size: 110,
        cell: ({ row }) => (
          <div className="text-end text-sm tabular-nums">
            {format(row.original.observedValue)}
            {row.original.baselineValue != null && (
              <span className="ms-1 text-xs text-muted-foreground">
                / {format(row.original.baselineValue)}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "threshold",
        accessorKey: "thresholdValue",
        header: t("historyDialog.columns.threshold"),
        enableSorting: false,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-end text-sm tabular-nums">
            {format(row.original.thresholdValue)}
          </div>
        ),
      },
      {
        id: "notified",
        accessorKey: "notifiedCount",
        header: t("historyDialog.columns.notified"),
        enableSorting: false,
        enableResizing: true,
        minSize: 110,
        size: 110,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <div className="flex items-center justify-end gap-1 text-sm tabular-nums">
              {event.webhookEmitted && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Webhook className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("historyDialog.webhookSent")}
                  </TooltipContent>
                </Tooltip>
              )}
              {event.recipientIds.length > 0 ? (
                <UserListDisplay filter={{ id: { in: event.recipientIds } }} />
              ) : (
                event.notifiedCount
              )}
            </div>
          );
        },
      },
    ],
    [t, preferences, projectId, subjectMeta]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[700px] lg:max-w-[900px]"
        data-testid="alert-history-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t("historyDialog.title", { name: rule?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {rule && <AlertRuleSummary rule={rule} />}
          </DialogDescription>
        </DialogHeader>
        {!isLoading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("historyDialog.empty")}
          </p>
        ) : (
          <div className="space-y-2">
            {total != null && (
              <p className="text-end text-sm text-muted-foreground">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: rows.length.toLocaleString(locale),
                  total: total.toLocaleString(locale),
                })}
              </p>
            )}
            <div className="h-[60vh] min-h-[240px] w-full">
              <DataTable
                virtualized
                columns={columns}
                data={rows}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                flexColumnId="subject"
                hasMore={!!hasNextPage}
                isLoading={isLoading || isFetchingNextPage}
                onLoadMore={fetchNextPage}
                resetKey={rule?.id}
                testIdPrefix="alert-history-table"
                rowTestIdPrefix="alert-event"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
