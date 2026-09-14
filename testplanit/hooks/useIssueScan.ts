"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface IssueScanSnapshot {
  issueScanReport?: unknown;
}

export interface IssueScanMessages {
  started: string;
  cancelRequested: string;
  stillRunning: string;
  failedToStart: string;
  networkError: string;
}

interface UseIssueScanArgs {
  refetchConfig: () => Promise<{ data?: IssueScanSnapshot | null }>;
  messages: IssueScanMessages;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_MS = 2500;
/** ~30 minutes at the default interval: a full-history walk can be long. */
const DEFAULT_MAX_POLLS = 720;

function isRunning(report: unknown): boolean {
  return (
    !!report &&
    typeof report === "object" &&
    (report as Record<string, unknown>).running === true
  );
}

/**
 * Queues a ticket scan for an Impact config (recent window or full history)
 * and polls the config's `issueScanReport` until the worker clears its
 * `running` flag. The report itself is read by the caller from the refetched
 * config; this hook only drives the request and the polling.
 */
export function useIssueScan({
  refetchConfig,
  messages,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
}: UseIssueScanArgs) {
  const [isScanning, setIsScanning] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const waitForScan = useCallback(async () => {
    for (let polls = 0; polls < maxPolls; polls++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (unmounted.current) return;
      const { data } = await refetchConfig();
      if (!isRunning(data?.issueScanReport)) return;
    }
    toast.info(messages.stillRunning);
  }, [refetchConfig, maxPolls, pollIntervalMs, messages.stillRunning]);

  const startScan = useCallback(
    async ({
      repositoryId,
      configId,
      full,
    }: {
      repositoryId: number;
      configId: number;
      full: boolean;
    }) => {
      setIsScanning(true);
      setScanError(null);
      try {
        const res = await fetch(
          `/api/code-repositories/${repositoryId}/scan-issues`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectConfigId: configId, full }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          setScanError(data.error ?? messages.failedToStart);
          return;
        }
        toast.info(messages.started);
        await refetchConfig();
        await waitForScan();
      } catch (err) {
        setScanError(
          err instanceof Error ? err.message : messages.networkError
        );
      } finally {
        if (!unmounted.current) setIsScanning(false);
      }
    },
    [refetchConfig, waitForScan, messages]
  );

  /**
   * Ask the worker to stop the running scan. The report clears its running
   * flag once the worker notices (or at once, if the job had not started),
   * which the ongoing poll picks up.
   */
  const cancelScan = useCallback(
    async ({
      repositoryId,
      configId,
    }: {
      repositoryId: number;
      configId: number;
    }) => {
      setScanError(null);
      try {
        const res = await fetch(
          `/api/code-repositories/${repositoryId}/scan-issues/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectConfigId: configId }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          setScanError(data.error ?? messages.failedToStart);
          return;
        }
        toast.info(messages.cancelRequested);
        await refetchConfig();
      } catch (err) {
        setScanError(
          err instanceof Error ? err.message : messages.networkError
        );
      }
    },
    [refetchConfig, messages]
  );

  /**
   * Resume polling for a scan that was already running when the page opened.
   * Following never blocks the buttons: a flag left behind by a worker that
   * died mid-scan must stay recoverable by queueing again.
   */
  const followScan = useCallback(async () => {
    setIsFollowing(true);
    try {
      await waitForScan();
    } finally {
      if (!unmounted.current) setIsFollowing(false);
    }
  }, [waitForScan]);

  return {
    isScanning,
    isFollowing,
    scanError,
    startScan,
    cancelScan,
    followScan,
  };
}
