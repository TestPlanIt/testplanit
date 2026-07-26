"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateFormatter } from "@/components/DateFormatter";
import { DateRangePicker } from "@/components/forms/DateRangePicker";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import type { ColumnDef } from "@tanstack/react-table";
import { useSession } from "next-auth/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, Inbox, Send } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { bulkReplayFailedDeliveries } from "~/app/actions/webhook-config";
import { usePathname, useRouter } from "~/lib/navigation";

import { WebhookDeliveryDrawer } from "./webhook-delivery-drawer";

type DeliveryListItem = {
  id: string;
  webhookConfigId: string;
  webhookConfig: {
    name: string | null;
    adapterType: string;
    direction: string;
  } | null;
  direction: string;
  adapterType: string;
  eventType: string | null;
  eventId: string | null;
  payloadDigest: string | null;
  statusCode: number | null;
  error: string | null;
  latencyMs: number | null;
  attempt: number;
  receivedAt: Date;
  replayedFromDeliveryId: string | null;
};

interface WebhookDeliveriesTabProps {
  projectId: number;
}

type StatusFilter = "all" | "failed" | "success";

function adapterLabelKey(
  adapterType: string
):
  | "inboundChooserJira"
  | "inboundChooserGithub"
  | "inboundChooserAdo"
  | "inboundChooserGitlab"
  | "inboundChooserGitea"
  | "inboundChooserRedmine"
  | "inboundChooserMantisbt"
  | "adapterLabelSlack"
  | "adapterLabelGenericHmac"
  | null {
  switch (adapterType) {
    case "JIRA":
      return "inboundChooserJira";
    case "GITHUB":
      return "inboundChooserGithub";
    case "AZURE_DEVOPS":
      return "inboundChooserAdo";
    case "GITLAB":
      return "inboundChooserGitlab";
    case "GITEA":
      return "inboundChooserGitea";
    case "REDMINE":
      return "inboundChooserRedmine";
    case "MANTISBT":
      return "inboundChooserMantisbt";
    case "SLACK":
      return "adapterLabelSlack";
    case "GENERIC_HMAC":
      return "adapterLabelGenericHmac";
    default:
      return null;
  }
}

const EVENT_LABEL_KEYS: Record<string, string> = {
  // Outbound events
  "test_run.created": "events.testRunCreated",
  "test_run.state_changed": "events.testRunStateChanged",
  "test_run.completed": "events.testRunCompleted",
  "test_run.duplicated": "events.testRunDuplicated",
  "test_run.result_added": "events.testRunResultAdded",
  "session.created": "events.sessionCreated",
  "session.state_changed": "events.sessionStateChanged",
  "session.completed": "events.sessionCompleted",
  "session.duplicated": "events.sessionDuplicated",
  "session.result_added": "events.sessionResultAdded",
  "issue.created": "events.issueCreated",
  "issue.updated": "events.issueUpdated",
  "issue.deleted": "events.issueDeleted",
  "case.created": "events.caseCreated",
  "case.updated": "events.caseUpdated",
  "case.deleted": "events.caseDeleted",
  // Inbound: Jira
  "jira:issue_created": "events.jiraIssueCreated",
  "jira:issue_updated": "events.jiraIssueUpdated",
  "jira:issue_deleted": "events.jiraIssueDeleted",
  // Inbound: GitHub
  issues: "events.githubIssues",
  pull_request: "events.githubPullRequest",
  push: "events.githubPush",
  issue_comment: "events.githubIssueComment",
  // Inbound: Azure DevOps
  "workitem.created": "events.adoWorkitemCreated",
  "workitem.updated": "events.adoWorkitemUpdated",
  "workitem.deleted": "events.adoWorkitemDeleted",
  // Synthetic test event ("Send test webhook" / "Send test event")
  "webhook.test": "events.webhookTest",
};

function eventLabelKey(eventType: string | null | undefined): string | null {
  if (!eventType) return null;
  return EVENT_LABEL_KEYS[eventType] ?? null;
}

interface FilterState {
  configIds: string[];
  status: StatusFilter;
  since: Date | null;
  until: Date | null;
}

function defaultSince(): Date {
  // CONTEXT D-03 — default range: last 7 days.
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseFilterFromSearchParams(
  searchParams: URLSearchParams | null
): FilterState {
  const raw = searchParams?.get("configIds") ?? "";
  const configIds = raw.split(",").filter(Boolean);
  const statusRaw = (searchParams?.get("status") ?? "all") as StatusFilter;
  const status: StatusFilter =
    statusRaw === "failed" || statusRaw === "success" ? statusRaw : "all";
  const sinceParam = searchParams?.get("since");
  const untilParam = searchParams?.get("until");
  const since = sinceParam ? new Date(sinceParam) : null;
  const until = untilParam ? new Date(untilParam) : null;
  return { configIds, status, since, until };
}

/**
 * Plan 04-07 Scope A — Deliveries tab: list + filter bar + drawer + bulk
 * outbound replay.
 *
 * Filter state lives in URL query params (D-32) so reload preserves the
 * view. Cursor pagination at 50 rows/page (D-35); "Load more" appends.
 *
 * Bulk-replay button (D-17a / Blocker 4):
 *   - visible only when configIds.length === 1 && status === "failed" AND
 *     ≥ 1 OUTBOUND failed row in the current view.
 *   - label includes outbound-only count (e.g., "Bulk replay 5 outbound
 *     failures").
 *   - if all visible failures are inbound, the button is hidden and a
 *     helper line invites re-triggering upstream instead.
 */
const PAGE_SIZE = 50;

export function WebhookDeliveriesTab({ projectId }: WebhookDeliveriesTabProps) {
  return <WebhookDeliveriesTabContent projectId={projectId} />;
}

function WebhookDeliveriesTabContent({ projectId }: WebhookDeliveriesTabProps) {
  const locale = useLocale();
  const t = useTranslations("projects.settings.webhooks");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filter = useMemo(
    () => parseFilterFromSearchParams(searchParams),
    [searchParams]
  );

  // ─── DataTable sort + visibility state ──────────────────────────────
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "received", direction: "desc" });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const handleSortChange = (columnId: string) => {
    setSortConfig((prev) => ({
      column: columnId,
      direction:
        prev.column === columnId && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const { data: session } = useSession();
  const dateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;

  // ─── Fetch project's webhook configs for the multi-select ───────────
  const { data: configs } = useClientQueries(schema).webhookConfig.useFindMany({
    where: { projectId },
    select: { id: true, name: true, adapterType: true, direction: true },
  });

  const configList = (configs ?? []) as Array<{
    id: string;
    name: string | null;
    adapterType: string;
    direction: string;
  }>;

  // ─── Fetch deliveries with filter applied ───────────────────────────
  const where = useMemo(() => {
    const w: Record<string, unknown> = {
      webhookConfig: { projectId },
    };
    if (filter.since || filter.until) {
      const receivedAt: Record<string, Date> = {};
      if (filter.since) receivedAt.gte = filter.since;
      if (filter.until) receivedAt.lte = filter.until;
      w.receivedAt = receivedAt;
    }
    if (filter.status === "failed") w.error = { not: null };
    if (filter.status === "success") w.error = null;
    if (filter.configIds.length > 0) {
      w.webhookConfigId = { in: filter.configIds };
    }
    return w;
  }, [projectId, filter]);

  const orderBy = useMemo(() => {
    const dir: "asc" | "desc" = sortConfig.direction;
    const tieBreaker = { id: "desc" } as const;
    switch (sortConfig.column) {
      case "webhook":
        return [{ webhookConfig: { name: dir } }, tieBreaker];
      case "event":
        return [{ eventType: dir }, tieBreaker];
      case "direction":
        return [{ direction: dir }, tieBreaker];
      case "status":
        return [{ statusCode: dir }, tieBreaker];
      case "error":
        return [{ error: dir }, tieBreaker];
      case "attempt":
        return [{ attempt: dir }, tieBreaker];
      case "received":
      default:
        return [{ receivedAt: dir }, tieBreaker];
    }
  }, [sortConfig]);

  const { data: totalCount } = useClientQueries(
    schema
  ).webhookDelivery.useCount({ where });

  // Deliveries load a page at a time and accumulate; the virtualized table
  // renders only the visible window and pulls the next page as the user scrolls.
  const deliveriesInfiniteArgs = useMemo(
    () => ({
      where,
      orderBy,
      take: PAGE_SIZE,
      select: {
        id: true,
        webhookConfigId: true,
        webhookConfig: {
          select: { name: true, adapterType: true, direction: true },
        },
        direction: true,
        adapterType: true,
        eventType: true,
        eventId: true,
        payloadDigest: true,
        statusCode: true,
        error: true,
        latencyMs: true,
        attempt: true,
        receivedAt: true,
        replayedFromDeliveryId: true,
      },
    }),
    [where, orderBy]
  );

  const {
    data: deliveriesPages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingDeliveries,
    refetch: refetchDeliveries,
  } = useClientQueries(schema).webhookDelivery.useInfiniteFindMany(
    deliveriesInfiniteArgs,
    {
      getNextPageParam: (lastPage, allPages) =>
        !lastPage || lastPage.length < PAGE_SIZE
          ? undefined
          : { ...deliveriesInfiniteArgs, skip: allPages.flat().length },
    }
  );

  const deliveries = useMemo(
    () => (deliveriesPages?.pages.flat() ?? []) as DeliveryListItem[],
    [deliveriesPages]
  );

  // ─── Drawer + bulk-replay local state ───────────────────────────────
  const [openDrawerDeliveryId, setOpenDrawerDeliveryId] = useState<
    string | null
  >(null);
  const [bulkReplayOpen, setBulkReplayOpen] = useState(false);
  const [bulkInFlight, setBulkInFlight] = useState(false);

  // ─── Outbound-only bulk-replay gating (D-17a / Blocker 4) ───────────
  const outboundFailedCount = deliveries.filter(
    (r) => r.direction === "OUTBOUND" && r.error !== null
  ).length;
  const inboundFailedCount = deliveries.filter(
    (r) => r.direction === "INBOUND" && r.error !== null
  ).length;
  const showBulkReplay =
    filter.configIds.length === 1 &&
    filter.status === "failed" &&
    outboundFailedCount > 0;
  const showBulkReplayHiddenHelper =
    filter.configIds.length === 1 &&
    filter.status === "failed" &&
    outboundFailedCount === 0 &&
    inboundFailedCount > 0;

  // ─── URL filter helpers ─────────────────────────────────────────────
  function updateFilter(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // Preserve the current tab so updates from the deliveries tab don't
    // unwittingly send the user back to the inbound default.
    if (!params.has("tab")) params.set("tab", "deliveries");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function resetFilters() {
    const params = new URLSearchParams();
    params.set("tab", "deliveries");
    router.replace(`${pathname}?${params.toString()}`);
  }

  // ─── Bulk replay handler ────────────────────────────────────────────
  async function performBulkReplay() {
    if (filter.configIds.length !== 1) return;
    setBulkInFlight(true);
    try {
      const sinceTimestamp = (filter.since ?? defaultSince()).toISOString();
      const input: {
        webhookConfigId: string;
        sinceTimestamp: string;
        untilTimestamp?: string;
      } = {
        webhookConfigId: filter.configIds[0]!,
        sinceTimestamp,
      };
      if (filter.until) input.untilTimestamp = filter.until.toISOString();
      const result = await bulkReplayFailedDeliveries(input);
      if (result.ok) {
        toast.success(t("toastBulkReplaySuccess", { batchId: result.batchId }));
        await refetchDeliveries();
        return;
      }
      if (result.reason === "exceeds_cap") {
        toast.error(t("bulkReplayCapExceeded", { count: outboundFailedCount }));
        return;
      }
      toast.error(t("toastBulkReplayFailed", { error: result.error ?? "" }));
    } finally {
      setBulkInFlight(false);
    }
  }

  // ─── Renderers ──────────────────────────────────────────────────────
  function renderFilterBar() {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DateRangePicker
            className="w-full"
            buttonTestId="webhook-deliveries-filter-date-range-trigger"
            value={
              filter.since || filter.until
                ? {
                    from: filter.since ?? undefined,
                    to: filter.until ?? undefined,
                  }
                : undefined
            }
            onChange={(range) =>
              updateFilter({
                since: range?.from ? range.from.toISOString() : null,
                until: range?.to ? range.to.toISOString() : null,
              })
            }
          />

          <Select
            value={filter.configIds[0] ?? ""}
            onValueChange={(v: string) =>
              updateFilter({
                configIds: v === "__all__" || v === "" ? null : v,
              })
            }
          >
            <SelectTrigger
              data-testid="webhook-deliveries-filter-config"
              className="w-full"
            >
              <SelectValue placeholder={t("filterConfigPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                {t("filterConfigPlaceholder")}
              </SelectItem>
              {configList.map((c) => {
                const fallbackKey = adapterLabelKey(c.adapterType);
                const fallback = fallbackKey ? t(fallbackKey) : c.adapterType;
                return (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      {c.direction === "INBOUND" ? (
                        <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{c.name ?? fallback}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select
            value={filter.status}
            onValueChange={(v: string) =>
              updateFilter({ status: v === "all" ? null : v })
            }
          >
            <SelectTrigger
              data-testid="webhook-deliveries-filter-status"
              className="w-full"
            >
              <SelectValue placeholder={t("filterStatusAll")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterStatusAll")}</SelectItem>
              <SelectItem value="failed">{t("filterStatusFailed")}</SelectItem>
              <SelectItem value="success">
                {t("filterStatusSuccess")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            data-testid="webhook-deliveries-reset-top"
            onClick={resetFilters}
          >
            {t("filterReset")}
          </Button>

          {showBulkReplay && (
            <Button
              type="button"
              variant="destructive"
              data-testid="webhook-bulk-replay-button"
              onClick={() => setBulkReplayOpen(true)}
              disabled={bulkInFlight}
            >
              {t("filterBulkReplayButton", { count: outboundFailedCount })}
            </Button>
          )}
          {showBulkReplayHiddenHelper && (
            <span
              data-testid="webhook-bulk-replay-hidden-helper"
              className="text-xs text-muted-foreground"
            >
              {t("filterBulkReplayHidden")}
            </span>
          )}
        </div>
      </div>
    );
  }

  function renderEmpty() {
    if (configList.length === 0) {
      return (
        <div
          data-testid="webhook-deliveries-empty"
          className="rounded-md border p-6 text-center text-sm text-muted-foreground"
        >
          <p>{t("deliveriesEmptyNoConfigs")}</p>
        </div>
      );
    }
    return (
      <div
        data-testid="webhook-deliveries-empty"
        className="rounded-md border p-6 text-center text-sm text-muted-foreground"
      >
        <p>{t("deliveriesEmpty")}</p>
        <Button
          type="button"
          variant="outline"
          data-testid="webhook-deliveries-reset"
          onClick={resetFilters}
          className="mt-2"
        >
          {t("deliveriesResetFilters")}
        </Button>
      </div>
    );
  }

  type DeliveryRow = (typeof deliveries)[number] & { name: string };

  const tableData: DeliveryRow[] = useMemo(
    () =>
      deliveries.map((d) => {
        const k = adapterLabelKey(d.adapterType);
        const adapterPretty = k ? t(k) : d.adapterType;
        return {
          ...d,
          name: d.webhookConfig?.name ?? adapterPretty,
        };
      }),
    [deliveries, t]
  );

  const columns: ColumnDef<DeliveryRow>[] = useMemo(
    () => [
      {
        id: "webhook",
        accessorKey: "name",
        header: t("tableHeaderConfig"),
        enableSorting: true,
        enableResizing: true,
        size: 250,
        cell: ({ row }) => row.original.name,
      },
      {
        id: "event",
        accessorKey: "eventType",
        header: t("tableHeaderEvent"),
        enableSorting: true,
        enableResizing: true,
        size: 250,
        cell: ({ row }) => {
          const k = eventLabelKey(row.original.eventType);
          return k
            ? (t as unknown as (key: string) => string)(k)
            : (row.original.eventType ?? "—");
        },
      },
      {
        id: "direction",
        accessorKey: "direction",
        header: t("tableHeaderDirection"),
        enableSorting: true,
        enableResizing: true,
        cell: ({ row }) => (
          <Badge className="gap-1">
            {row.original.direction === "INBOUND" ? (
              <Inbox className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Send className="h-3 w-3" aria-hidden="true" />
            )}
            <span>{row.original.direction}</span>
          </Badge>
        ),
      },
      {
        id: "status",
        accessorKey: "statusCode",
        header: t("tableHeaderStatus"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => {
          const value = row.original.statusCode ?? "—";
          return row.original.error ? (
            <span className="text-destructive">{value}</span>
          ) : (
            <span>{value}</span>
          );
        },
      },
      {
        id: "error",
        accessorKey: "error",
        header: t("tableHeaderError"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => {
          return (
            row.original.error && (
              <span className="text-destructive">{row.original.error}</span>
            )
          );
        },
      },
      {
        id: "attempt",
        accessorKey: "attempt",
        header: t("tableHeaderAttempt"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => row.original.attempt,
      },
      {
        id: "received",
        accessorKey: "receivedAt",
        header: t("tableHeaderReceivedAt"),
        enableSorting: true,
        enableResizing: true,
        minSize: 150,
        size: 200,
        maxSize: 350,
        cell: ({ row }) => (
          <DateFormatter
            date={row.original.receivedAt}
            formatString={dateTimeFormat}
            timezone={session?.user?.preferences?.timezone}
          />
        ),
      },
      {
        id: "actions",
        header: t("tableHeaderActions"),
        enableSorting: false,
        enableResizing: false,
        size: 60,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid={`webhook-delivery-view-details-${row.original.id}`}
            title={t("tableActionViewDetails")}
            onClick={(e) => {
              e.stopPropagation();
              setOpenDrawerDeliveryId(row.original.id);
            }}
          >
            <Eye className="h-4 w-4" />
            <span className="sr-only">{t("tableActionViewDetails")}</span>
          </Button>
        ),
      },
    ],
    [t, dateTimeFormat, session?.user?.preferences?.timezone]
  );

  function renderTable() {
    return (
      <div
        className="h-[calc(100vh-24rem)] min-h-[400px] w-full"
        data-testid="webhook-deliveries-table"
      >
        <VirtualizedDataTable
          columns={columns as ColumnDef<any, any>[]}
          data={tableData}
          sortConfig={sortConfig}
          onSortChange={handleSortChange}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoadingDeliveries || isFetchingNextPage}
          hasMore={!!hasNextPage}
          onLoadMore={fetchNextPage}
          resetKey={`${filter.configIds.join(",")}|${filter.status}|${filter.since?.toISOString() ?? ""}|${filter.until?.toISOString() ?? ""}|${sortConfig.column}|${sortConfig.direction}`}
          testIdPrefix="webhook-deliveries-vtable"
          rowTestIdPrefix="webhook-delivery-row"
        />
      </div>
    );
  }

  // ─── Top-level layout ────────────────────────────────────────────────
  const configForBulk = configList.find((c) => c.id === filter.configIds[0]);
  const configNameForBulk =
    configForBulk?.name ?? configForBulk?.adapterType ?? "";

  return (
    <div className="space-y-4" data-testid="webhook-deliveries-tab">
      {renderFilterBar()}

      <div className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
          <div className="m-2">
            <ColumnSelection
              key="webhook-deliveries-column-selection"
              storageKey={`webhook-deliveries:${projectId}`}
              columns={
                columns as ColumnDef<DeliveryRow & { name: string }, unknown>[]
              }
              onVisibilityChange={setColumnVisibility}
            />
          </div>
        </div>
        {deliveries.length > 0 && (
          <p className="text-sm text-muted-foreground shrink-0">
            {tGlobal("admin.auditLogs.showing", {
              loaded: deliveries.length.toLocaleString(locale),
              total: (totalCount ?? deliveries.length).toLocaleString(locale),
            })}
          </p>
        )}
      </div>

      {deliveries.length === 0 && !isLoadingDeliveries
        ? renderEmpty()
        : renderTable()}

      <WebhookDeliveryDrawer
        deliveryId={openDrawerDeliveryId}
        open={openDrawerDeliveryId !== null}
        onOpenChange={(open) => !open && setOpenDrawerDeliveryId(null)}
        onReplaySuccess={() => {
          void refetchDeliveries();
        }}
      />

      <AlertDialog open={bulkReplayOpen} onOpenChange={setBulkReplayOpen}>
        <AlertDialogContent data-testid="webhook-bulk-replay-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bulkReplayConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {outboundFailedCount > 100
                ? t("bulkReplayCapExceeded", { count: outboundFailedCount })
                : t("bulkReplayConfirm", {
                    count: outboundFailedCount,
                    configName: configNameForBulk,
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-bulk-replay-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-bulk-replay-confirm"
              disabled={outboundFailedCount > 100 || bulkInFlight}
              onClick={() => void performBulkReplay()}
            >
              {t("bulkReplayAction", { count: outboundFailedCount })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
