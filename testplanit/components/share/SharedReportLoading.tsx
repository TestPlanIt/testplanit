"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** How long a shared report may take before the spinner appears. */
export const SHARED_REPORT_LOADING_DELAY_MS = 400;

/**
 * When the current load began. The page, the access check and the data fetch
 * each render their own loading state; timing the delay from the first of them
 * keeps the hand-off from restarting it (spinner, blank, spinner).
 */
let loadingSince: number | null = null;

/** Call once the report is on screen, so the next load times from scratch. */
export function resetSharedReportLoading() {
  loadingSince = null;
}

/**
 * The one loading state of the shared-report page, from the access check
 * through the data fetch. It stays blank for a moment, so a report that loads
 * quickly never flashes a spinner.
 */
export function SharedReportLoading({
  delayMs = SHARED_REPORT_LOADING_DELAY_MS,
}: {
  delayMs?: number;
}) {
  const t = useTranslations("reports.sharedReport");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    loadingSince ??= Date.now();
    const remaining = delayMs - (Date.now() - loadingSince);
    if (remaining <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), remaining);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      data-testid="shared-report-loading"
      aria-busy="true"
    >
      {visible && (
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      )}
    </div>
  );
}
