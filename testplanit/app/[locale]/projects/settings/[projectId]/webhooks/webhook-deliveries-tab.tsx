"use client";

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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { bulkReplayFailedDeliveries } from "~/app/actions/webhook-config";
import {
  useFindManyWebhookConfig,
  useFindManyWebhookDelivery,
} from "~/lib/hooks";
import { usePathname, useRouter } from "~/lib/navigation";

import {
  WebhookDeliveryDrawer,
  type DeliveryDrawerRow,
} from "./webhook-delivery-drawer";

interface WebhookDeliveriesTabProps {
  projectId: number;
}

type StatusFilter = "all" | "failed" | "success";

const PAGE_SIZE = 50;

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
  const since = sinceParam ? new Date(sinceParam) : defaultSince();
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
export function WebhookDeliveriesTab({ projectId }: WebhookDeliveriesTabProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filter = useMemo(
    () => parseFilterFromSearchParams(searchParams),
    [searchParams]
  );

  // ─── Cursor pagination state (independent from URL filter state) ────
  const [cursor, setCursor] = useState<string | null>(null);

  // ─── Fetch project's webhook configs for the multi-select ───────────
  const { data: configs } = useFindManyWebhookConfig({
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
  const where: Record<string, unknown> = {
    webhookConfig: { projectId },
  };
  if (filter.since || filter.until) {
    const receivedAt: Record<string, Date> = {};
    if (filter.since) receivedAt.gte = filter.since;
    if (filter.until) receivedAt.lte = filter.until;
    where.receivedAt = receivedAt;
  }
  if (filter.status === "failed") where.error = { not: null };
  if (filter.status === "success") where.error = null;
  if (filter.configIds.length > 0) {
    where.webhookConfigId = { in: filter.configIds };
  }

  const { data: deliveriesData, refetch: refetchDeliveries } =
    useFindManyWebhookDelivery({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
        latencyMs: true,
        error: true,
        attempt: true,
        receivedAt: true,
        replayedFromDeliveryId: true,
      },
    });

  const deliveries = (deliveriesData ?? []) as DeliveryDrawerRow[];

  // ─── Drawer + bulk-replay local state ───────────────────────────────
  const [openDrawerDeliveryId, setOpenDrawerDeliveryId] = useState<
    string | null
  >(null);
  const [bulkReplayOpen, setBulkReplayOpen] = useState(false);
  const [bulkInFlight, setBulkInFlight] = useState(false);

  const openDelivery =
    deliveries.find((d) => d.id === openDrawerDeliveryId) ?? null;

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
    setCursor(null);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function resetFilters() {
    const params = new URLSearchParams();
    params.set("tab", "deliveries");
    setCursor(null);
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
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter.configIds[0] ?? ""}
          onValueChange={(v: string) =>
            updateFilter({ configIds: v === "__all__" || v === "" ? null : v })
          }
        >
          <SelectTrigger
            data-testid="webhook-deliveries-filter-config"
            className="w-56"
          >
            <SelectValue placeholder={t("filterConfigPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">
              {t("filterConfigPlaceholder")}
            </SelectItem>
            {configList.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name ?? c.adapterType}
              </SelectItem>
            ))}
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
            className="w-40"
          >
            <SelectValue placeholder={t("filterStatusAll")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterStatusAll")}</SelectItem>
            <SelectItem value="failed">{t("filterStatusFailed")}</SelectItem>
            <SelectItem value="success">{t("filterStatusSuccess")}</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              data-testid="webhook-deliveries-filter-since-trigger"
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {filter.since
                ? format(filter.since, "yyyy-MM-dd")
                : t("filterSinceDefault")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={filter.since ?? undefined}
              onSelect={(d: Date | undefined) =>
                updateFilter({ since: d ? d.toISOString() : null })
              }
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              data-testid="webhook-deliveries-filter-until-trigger"
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              {filter.until
                ? format(filter.until, "yyyy-MM-dd")
                : t("filterUntilDefault")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={filter.until ?? undefined}
              onSelect={(d: Date | undefined) =>
                updateFilter({ until: d ? d.toISOString() : null })
              }
            />
          </PopoverContent>
        </Popover>

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
    );
  }

  function renderEmpty() {
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

  function renderTable() {
    return (
      <Table data-testid="webhook-deliveries-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("tableHeaderConfig")}</TableHead>
            <TableHead>{t("tableHeaderEvent")}</TableHead>
            <TableHead>{t("tableHeaderDirection")}</TableHead>
            <TableHead>{t("tableHeaderStatus")}</TableHead>
            <TableHead>{t("tableHeaderAttempt")}</TableHead>
            <TableHead>{t("tableHeaderReceivedAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((d) => {
            const receivedAtDate =
              d.receivedAt instanceof Date
                ? d.receivedAt
                : new Date(d.receivedAt);
            return (
              <TableRow
                key={d.id}
                data-testid={`webhook-delivery-row-${d.id}`}
                onClick={() => setOpenDrawerDeliveryId(d.id)}
              >
                <TableCell>{d.webhookConfig?.name ?? d.adapterType}</TableCell>
                <TableCell>{d.eventType ?? "—"}</TableCell>
                <TableCell>
                  <Badge>{d.direction}</Badge>
                </TableCell>
                <TableCell>
                  {d.error ? (
                    <span className="text-destructive">
                      {d.statusCode ?? "—"}
                    </span>
                  ) : (
                    <span>{d.statusCode ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell>{d.attempt}</TableCell>
                <TableCell>{receivedAtDate.toISOString()}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  // ─── Top-level layout ────────────────────────────────────────────────
  const configForBulk = configList.find((c) => c.id === filter.configIds[0]);
  const configNameForBulk =
    configForBulk?.name ?? configForBulk?.adapterType ?? "";

  return (
    <div className="space-y-4" data-testid="webhook-deliveries-tab">
      {renderFilterBar()}

      {deliveries.length === 0 ? renderEmpty() : renderTable()}

      {deliveries.length >= PAGE_SIZE && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            data-testid="webhook-deliveries-load-more"
            onClick={() => {
              const last = deliveries[deliveries.length - 1];
              if (last) setCursor(last.id);
            }}
          >
            {t("deliveriesLoadMore")}
          </Button>
        </div>
      )}

      <WebhookDeliveryDrawer
        delivery={openDelivery}
        open={openDelivery !== null}
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
