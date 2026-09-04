"use client";

import { useState } from "react";
import { toast } from "sonner";

export interface RepoCacheSnapshot {
  cacheStatus?: string | null;
  cacheFileCount?: number | null;
  cacheError?: string | null;
}

export interface RepoCacheRefreshMessages {
  pending: string;
  listingFiles: string;
  cachingFiles: (count: number) => string;
  contentsError: string;
  networkError: string;
  refreshComplete: (fileCount: number) => string;
  refreshInProgress: string;
}

interface UseRepoCacheRefreshArgs {
  refetchConfig: () => Promise<{ data?: RepoCacheSnapshot | null }>;
  messages: RepoCacheRefreshMessages;
  pollIntervalMs?: number;
  maxPolls?: number;
}

const DEFAULT_POLL_MS = 2500;
/** ~6 minutes at the default interval. */
const DEFAULT_MAX_POLLS = 144;

/**
 * Enqueues a background cache refresh for a project repository config and
 * polls the config's `cacheStatus` until the repo-cache worker finishes.
 * The list+content fetch runs in the worker so a rate-limited provider can't
 * time out the request.
 */
export function useRepoCacheRefresh({
  refetchConfig,
  messages,
  pollIntervalMs = DEFAULT_POLL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
}: UseRepoCacheRefreshArgs) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStep, setRefreshStep] = useState("");
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshCache = async ({
    repositoryId,
    configId,
  }: {
    repositoryId: number;
    configId: number;
  }) => {
    setIsRefreshing(true);
    setRefreshError(null);
    setRefreshStep(messages.pending);

    try {
      const res = await fetch(
        `/api/code-repositories/${repositoryId}/refresh-cache`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectConfigId: configId }),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setRefreshError(data.error ?? messages.networkError);
        void refetchConfig();
        return;
      }

      for (let polls = 0; polls < maxPolls; polls++) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const { data: fresh } = await refetchConfig();
        const status = fresh?.cacheStatus;
        const fileCount = fresh?.cacheFileCount;

        if (status == null || status === "pending") {
          setRefreshStep(
            fileCount != null
              ? messages.cachingFiles(fileCount)
              : messages.listingFiles
          );
          continue;
        }

        if (status === "error") {
          setRefreshError(fresh?.cacheError ?? messages.contentsError);
        } else {
          toast.success(messages.refreshComplete(fileCount ?? 0));
        }
        return;
      }

      toast.info(messages.refreshInProgress);
    } catch (err) {
      setRefreshError(
        err instanceof Error ? err.message : messages.networkError
      );
    } finally {
      setIsRefreshing(false);
      setRefreshStep("");
    }
  };

  return { isRefreshing, refreshStep, refreshError, refreshCache };
}
