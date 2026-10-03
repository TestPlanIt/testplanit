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
import {
  ActionBar,
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  History,
  Loader2,
  PinOff,
  ScanSearch,
  SearchCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { isIssueScanInFlight, readIssueScanReport } from "./issueScanReport";
import { isStalePinCheckInFlight, readStalePinReport } from "./stalePinReport";

export interface ImpactBulkConnection {
  id: number;
  repositoryId: number;
  issueScanReport?: unknown;
  stalePinReport?: unknown;
  repository: { name: string };
}

type BulkAction = "scanRecent" | "scanFull" | "checkStale" | "removeStale";

interface ImpactBulkActionsProps {
  configs: ImpactBulkConnection[];
  /** Pins the last stale check flagged that a cleanup would remove, per connection. */
  staleByConfig: Map<number, number>;
  /** Reloads the connections and stale counts after the requests settle. */
  onChanged: () => Promise<unknown>;
}

/** POST one connection's request; resolves to the response body or throws its error. */
async function post(
  url: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(
      typeof data.error === "string" ? data.error : res.statusText
    );
  }
  return data;
}

/**
 * Rescan Recent / Scan Full History / Check for Stale Pins / Remove Stale Pins
 * for every Impact connection of the project at once. Each request goes to the
 * same per-connection endpoint as the card buttons, so authorization and the
 * one-job-per-connection rule are unchanged; connections that already have
 * that kind of job queued or running are skipped. The page's polling follows
 * the jobs, and each card's buttons pick up the scans they did not start.
 */
export function ImpactBulkActions({
  configs,
  staleByConfig,
  onChanged,
}: ImpactBulkActionsProps) {
  const t = useTranslations("projects.settings.impact");
  const tCommon = useTranslations("common");

  const [pending, setPending] = useState<BulkAction | null>(null);
  const [confirm, setConfirm] = useState<"scanFull" | "removeStale" | null>(
    null
  );

  const staleTargets = configs.filter(
    (config) => (staleByConfig.get(config.id) ?? 0) > 0
  );
  const totalStale = staleTargets.reduce(
    (sum, config) => sum + (staleByConfig.get(config.id) ?? 0),
    0
  );
  const anyCheckRunning = configs.some((config) =>
    isStalePinCheckInFlight(readStalePinReport(config.stalePinReport))
  );

  const run = async (action: BulkAction) => {
    const scanInFlight = (config: ImpactBulkConnection) =>
      isIssueScanInFlight(readIssueScanReport(config.issueScanReport));
    const checkInFlight = (config: ImpactBulkConnection) =>
      isStalePinCheckInFlight(readStalePinReport(config.stalePinReport));

    const targets =
      action === "removeStale"
        ? staleTargets
        : configs.filter((config) =>
            action === "checkStale"
              ? !checkInFlight(config)
              : !scanInFlight(config)
          );
    const skipped =
      action === "removeStale" ? 0 : configs.length - targets.length;
    if (targets.length === 0) {
      toast.info(t("bulk.allRunning"));
      return;
    }

    setPending(action);
    try {
      const results = await Promise.allSettled(
        targets.map((config) => {
          const base = `/api/code-repositories/${config.repositoryId}`;
          const body = { projectConfigId: config.id };
          switch (action) {
            case "scanRecent":
              return post(`${base}/scan-issues`, { ...body, full: false });
            case "scanFull":
              return post(`${base}/scan-issues`, { ...body, full: true });
            case "checkStale":
              return post(`${base}/stale-pins/check`, body);
            case "removeStale":
              return post(`${base}/stale-pins/remove`, body);
          }
        })
      );

      const failed = targets.filter(
        (_, index) => results[index].status === "rejected"
      );
      const succeeded = targets.length - failed.length;

      if (succeeded > 0) {
        if (action === "removeStale") {
          const removed = results.reduce(
            (sum, result) =>
              result.status === "fulfilled"
                ? sum + Number(result.value.removed ?? 0)
                : sum,
            0
          );
          toast.success(t("stalePins.removed", { count: removed }));
        } else {
          toast.info(t("bulk.queued", { count: succeeded, skipped }));
        }
      }
      if (failed.length > 0) {
        toast.error(
          t("bulk.failed", {
            names: failed.map((config) => config.repository.name).join(", "),
          })
        );
      }
      setConfirm(null);
    } finally {
      setPending(null);
      await onChanged();
    }
  };

  const button = (
    action: BulkAction,
    icon: typeof ScanSearch,
    label: string,
    hint: string,
    onClick: () => void,
    extra?: { disabled?: boolean; destructive?: boolean }
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          onClick={onClick}
          disabled={pending !== null || extra?.disabled}
          aria-label={label}
          className={collapsibleActionClass(
            undefined,
            extra?.destructive ? "text-destructive" : ""
          )}
          data-testid={`impact-bulk-${action}`}
        >
          <ActionButtonContent
            icon={pending === action ? Loader2 : icon}
            iconClassName={
              pending === action
                ? "h-4 w-4 shrink-0 animate-spin"
                : "h-4 w-4 shrink-0"
            }
            label={label}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );

  const count = configs.length;

  return (
    <>
      <ActionBar
        compact
        className="flex-wrap justify-end"
        data-testid="impact-bulk-actions"
      >
        <span className="me-1 text-xs text-muted-foreground">
          {t("bulk.label", { count })}
        </span>
        {button(
          "scanRecent",
          ScanSearch,
          t("bulk.scanRecent"),
          t("bulk.scanRecentHint", { count }),
          () => void run("scanRecent")
        )}
        {button(
          "scanFull",
          History,
          t("bulk.scanFull"),
          t("bulk.scanFullHint", { count }),
          () => setConfirm("scanFull")
        )}
        {button(
          "checkStale",
          SearchCheck,
          t("bulk.checkStale"),
          t("bulk.checkStaleHint", { count }),
          () => void run("checkStale")
        )}
        {totalStale > 0 &&
          button(
            "removeStale",
            PinOff,
            t("bulk.removeStale"),
            t("bulk.removeStaleHint", {
              count: totalStale,
              repos: staleTargets.length,
            }),
            () => setConfirm("removeStale"),
            { disabled: anyCheckRunning, destructive: true }
          )}
      </ActionBar>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && pending === null) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className={
                  confirm === "removeStale"
                    ? "h-5 w-5 text-destructive"
                    : "h-5 w-5 text-warning"
                }
              />
              {confirm === "removeStale"
                ? t("bulk.removeStale")
                : t("bulk.scanFull")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-2">
              <div>
                {confirm === "removeStale" ? (
                  <>
                    <p>
                      {t("bulk.removeConfirm", {
                        count: totalStale,
                        repos: staleTargets.length,
                      })}
                    </p>
                    <p>{t("stalePins.removeConfirmNote")}</p>
                  </>
                ) : (
                  <p>{t("bulk.scanFullConfirm", { count })}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog open until the requests settle.
                event.preventDefault();
                if (confirm) void run(confirm);
              }}
              disabled={pending !== null}
              className={
                confirm === "removeStale"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              data-testid="impact-bulk-confirm"
            >
              {pending !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : confirm === "removeStale" ? (
                <PinOff className="h-4 w-4" />
              ) : (
                <History className="h-4 w-4" />
              )}
              {confirm === "removeStale"
                ? t("bulk.removeStale")
                : t("bulk.scanFull")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
