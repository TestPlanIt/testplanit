"use client";

import {
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { History, Loader2, ScanSearch, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIssueScan } from "~/hooks/useIssueScan";
import { isIssueScanStale, readIssueScanReport } from "./issueScanReport";

export interface ImpactScanConnection {
  id: number;
  repositoryId: number;
  issueScanReport?: unknown;
}

interface ImpactScanButtonsProps {
  config: ImpactScanConnection;
  /** Reloads the project's connections; the buttons follow this one's `issueScanReport`. */
  refetchConfigs: () => Promise<{ data?: ImpactScanConnection[] | null }>;
}

/**
 * Rescan Recent / Scan Full History / Cancel for one Impact connection, as
 * shown on the settings page cards. Each instance drives its own scan and
 * follows one already running for the connection.
 */
export function ImpactScanButtons({
  config,
  refetchConfigs,
}: ImpactScanButtonsProps) {
  const t = useTranslations("projects.settings.impact");
  const tRepo = useTranslations("projects.settings.codeRepository");
  const tDuplicates = useTranslations("repository.duplicates");
  const configId = config.id;

  const refetchConfig = useCallback(async () => {
    const result = await refetchConfigs();
    return {
      data: result.data?.find((row) => row.id === configId) ?? null,
    };
  }, [refetchConfigs, configId]);

  const {
    isScanning,
    isFollowing,
    scanError,
    startScan,
    cancelScan,
    followScan,
  } = useIssueScan({
    refetchConfig,
    messages: {
      started: t("tickets.scanStarted"),
      cancelRequested: t("tickets.cancelRequested"),
      stillRunning: t("tickets.scanStillRunning"),
      failedToStart: t("tickets.scanFailedToStart"),
      networkError: tRepo("networkError"),
    },
  });

  const [requestedFull, setRequestedFull] = useState<boolean | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const issueView = readIssueScanReport(config.issueScanReport);
  const scanRunning = issueView.kind === "running";
  const scanStale = scanRunning && isIssueScanStale(issueView.progress);
  // Which button's scan is in flight: the report knows once the worker has
  // written it; until then, the one that was clicked.
  const activeScanFull: boolean | null =
    issueView.kind === "running" && !scanStale
      ? issueView.progress.full
      : isScanning
        ? requestedFull
        : null;

  // A scan queued elsewhere (the dialog, a webhook, a cache refresh) is
  // followed too, unless its flag is old enough to be a leftover.
  const followedRef = useRef(false);
  useEffect(() => {
    if (
      scanRunning &&
      !scanStale &&
      !isScanning &&
      !isFollowing &&
      !followedRef.current
    ) {
      followedRef.current = true;
      void followScan().finally(() => {
        followedRef.current = false;
      });
    }
  }, [scanRunning, scanStale, isScanning, isFollowing, followScan]);

  const handleScan = (full: boolean) => {
    setRequestedFull(full);
    void startScan({
      repositoryId: config.repositoryId,
      configId: config.id,
      full,
    });
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelScan({
        repositoryId: config.repositoryId,
        configId: config.id,
      });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleScan(false)}
              disabled={isScanning}
              aria-label={t("tickets.scanRecent")}
              className={collapsibleActionClass()}
              data-testid={`impact-repo-scan-recent-${config.id}`}
            >
              <ActionButtonContent
                icon={activeScanFull === false ? Loader2 : ScanSearch}
                iconClassName={
                  activeScanFull === false
                    ? "h-4 w-4 shrink-0 animate-spin"
                    : "h-4 w-4 shrink-0"
                }
                label={t("tickets.scanRecent")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("tickets.scanRecent")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleScan(true)}
              disabled={isScanning}
              aria-label={t("tickets.scanFull")}
              className={collapsibleActionClass()}
              data-testid={`impact-repo-scan-full-${config.id}`}
            >
              <ActionButtonContent
                icon={activeScanFull === true ? Loader2 : History}
                iconClassName={
                  activeScanFull === true
                    ? "h-4 w-4 shrink-0 animate-spin"
                    : "h-4 w-4 shrink-0"
                }
                label={t("tickets.scanFull")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("tickets.scanFullHint")}</TooltipContent>
        </Tooltip>
        {scanRunning && !scanStale && (
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={cancelling}
            aria-label={tDuplicates("cancelScan")}
            className={collapsibleActionClass(undefined, "text-destructive")}
            data-testid={`impact-repo-scan-cancel-${config.id}`}
          >
            <ActionButtonContent
              icon={cancelling ? Loader2 : XCircle}
              iconClassName={
                cancelling
                  ? "h-4 w-4 shrink-0 animate-spin"
                  : "h-4 w-4 shrink-0"
              }
              label={tDuplicates("cancelScan")}
            />
          </Button>
        )}
      </div>
      {scanError && (
        <p
          className="text-xs text-destructive"
          data-testid={`impact-repo-scan-error-${config.id}`}
        >
          {scanError}
        </p>
      )}
    </div>
  );
}
