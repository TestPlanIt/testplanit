"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, PackageCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "~/lib/basePath";

interface ReleaseInfo {
  version: string;
  url: string;
  publishedAt: string | null;
}

export interface ReleaseCheckResponse {
  enabled: boolean;
  currentVersion: string;
  latest: ReleaseInfo | null;
  latestOnLine: ReleaseInfo | null;
  checkedAt: string | null;
  lastError: string | null;
}

const QUERY_KEY = ["admin", "release-check"] as const;
const UPGRADE_DOCS_URL =
  "https://docs.testplanit.com/docs/docker-setup#updates--maintenance";

/** Dismissal is remembered per release, so the next one shows again. */
function dismissalKey(version: string): string {
  return `testplanit.newReleaseNotice.dismissed.${version}`;
}

function readDismissed(version: string): boolean {
  try {
    return window.localStorage.getItem(dismissalKey(version)) === "1";
  } catch {
    return false;
  }
}

/**
 * Tells administrators that a newer TestPlanIt release than the one this
 * instance runs has been published. It goes away once the instance is
 * upgraded, or for this browser when dismissed.
 */
export function NewReleaseNotice() {
  const t = useTranslations("admin.newRelease");
  const tCommon = useTranslations("common");
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const { data } = useQuery<ReleaseCheckResponse | null>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await apiFetch("/api/admin/release-check");
      return response.ok ? response.json() : null;
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const latestVersion = data?.latest?.version ?? null;
  useEffect(() => {
    if (latestVersion && readDismissed(latestVersion)) {
      setDismissedVersion(latestVersion);
    }
  }, [latestVersion]);

  const dismiss = useCallback(() => {
    if (!latestVersion) return;
    try {
      window.localStorage.setItem(dismissalKey(latestVersion), "1");
    } catch {
      // Without storage the notice is dismissed for this page view only.
    }
    setDismissedVersion(latestVersion);
  }, [latestVersion]);

  if (!data?.latest || dismissedVersion === data.latest.version) return null;

  return (
    <div
      role="status"
      data-testid="new-release-notice"
      className="me-4 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-primary/20 bg-primary/10 px-4 py-2 text-sm"
    >
      <PackageCheck className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-foreground" data-testid="new-release-notice-text">
        {t("available", {
          version: data.latest.version,
          currentVersion: data.currentVersion,
        })}
        {data.latestOnLine && (
          <> {t("onLine", { version: data.latestOnLine.version })}</>
        )}
      </span>
      <a
        href={data.latest.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        data-testid="new-release-notice-notes"
      >
        {t("releaseNotes")}
        <ExternalLink className="h-3 w-3" />
      </a>
      <a
        href={UPGRADE_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        data-testid="new-release-notice-upgrade"
      >
        {t("howToUpgrade")}
        <ExternalLink className="h-3 w-3" />
      </a>
      <button
        type="button"
        onClick={dismiss}
        className="ms-auto text-muted-foreground transition-colors hover:text-foreground"
        aria-label={tCommon("dismiss")}
        data-testid="new-release-notice-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
