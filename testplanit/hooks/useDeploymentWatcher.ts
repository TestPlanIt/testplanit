"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  dismissUpdateBanner,
  isUpdateAvailable,
  isUpdateBannerVisible,
  reportPossibleSkew,
  reportServerBuildId,
  setVersionCheckRequester,
  subscribeToUpdateBanner,
} from "~/lib/deploymentSkew";

export const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Re-check after a first mismatch, long enough to outlast a blue-green switch. */
export const VERSION_CONFIRM_DELAY_MS = 30 * 1000;

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.buildId === "string" ? body.buildId : null;
  } catch {
    // Offline or mid-restart: no answer is not a mismatch.
    return null;
  }
}

/**
 * Watches for this tab falling behind a deploy: checks /api/version when the
 * tab becomes visible, comes back online, and every few minutes while visible,
 * and listens for skew errors nothing else caught. Mount once, app-wide.
 */
export function useDeploymentWatcher() {
  const updateAvailable = useSyncExternalStore(
    subscribeToUpdateBanner,
    isUpdateBannerVisible,
    () => false
  );

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (
        inFlight ||
        !process.env.NEXT_PUBLIC_BUILD_ID ||
        isUpdateAvailable() ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      inFlight = true;
      const serverBuildId = await fetchServerBuildId();
      inFlight = false;
      if (disposed || serverBuildId === null) return;
      clearTimeout(confirmTimer);
      if (reportServerBuildId(serverBuildId) && !isUpdateAvailable()) {
        confirmTimer = setTimeout(check, VERSION_CONFIRM_DELAY_MS);
      }
    };

    const startPolling = () => {
      pollTimer ??= setInterval(check, VERSION_POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void check();
        startPolling();
      } else {
        stopPolling();
      }
    };
    const handleOnline = () => void check();
    const handleRejection = (event: PromiseRejectionEvent) =>
      reportPossibleSkew(event.reason);
    const handleError = (event: ErrorEvent) =>
      reportPossibleSkew(event.error ?? event.message);

    if (document.visibilityState === "visible") startPolling();
    const releaseRequester = setVersionCheckRequester(() => void check());
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);

    return () => {
      disposed = true;
      stopPolling();
      clearTimeout(confirmTimer);
      releaseRequester();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  return { updateAvailable, dismiss: dismissUpdateBanner };
}
