"use client";

import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitPullRequest } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

export type PullRequestState = "open" | "merged" | "closed";

export interface RepoPullRequest {
  number: number;
  title: string;
  state: PullRequestState;
  authorName?: string;
  sourceBranch: string;
  targetBranch: string;
  headSha?: string;
  baseSha?: string;
  url?: string;
  updatedAt?: string;
}

export interface PullRequestsResponse {
  state: string;
  page: number;
  perPage: number;
  pullRequests: RepoPullRequest[];
  hasMore: boolean;
}

export type PullRequestStateFilter = "all" | PullRequestState;

const STATE_FILTERS: PullRequestStateFilter[] = [
  "all",
  "open",
  "merged",
  "closed",
];

const STATE_LABEL_KEY: Record<PullRequestStateFilter, string> = {
  all: "pull.stateAll",
  open: "pull.stateOpen",
  merged: "pull.stateMerged",
  closed: "pull.stateClosed",
};

const STATE_VARIANT: Record<
  PullRequestState,
  "default" | "secondary" | "outline"
> = {
  open: "default",
  merged: "secondary",
  closed: "outline",
};

export function pullRequestsUrl(
  repositoryId: number,
  configId: number,
  opts: { state: PullRequestStateFilter; search?: string; page?: number }
): string {
  const params = new URLSearchParams({
    configId: String(configId),
    state: opts.state,
    page: String(opts.page ?? 1),
    perPage: "50",
  });
  if (opts.search) params.set("search", opts.search);
  return `/api/code-repositories/${repositoryId}/pull-requests?${params.toString()}`;
}

interface PullRequestPickerProps {
  repositoryId: number;
  configId: number;
  value: RepoPullRequest | null;
  onValueChange: (pullRequest: RepoPullRequest | null) => void;
  /** Raised when the provider has no pull requests, so the mode can hide. */
  onUnsupported?: () => void;
  disabled?: boolean;
}

/**
 * Picks a pull request to compare instead of naming two commits. The state
 * filter narrows what the provider returns before the search box does, since
 * an active repository buries an open PR under hundreds of closed ones.
 */
export function PullRequestPicker({
  repositoryId,
  configId,
  value,
  onValueChange,
  onUnsupported,
  disabled = false,
}: PullRequestPickerProps) {
  const t = useTranslations("runs.impact");
  const [state, setState] = useState<PullRequestStateFilter>("all");

  const fetchOptions = useCallback(
    async (search: string, page: number, pageSize: number) => {
      const response = await fetch(
        pullRequestsUrl(repositoryId, configId, {
          state,
          search: search.trim() || undefined,
          page: page + 1,
        })
      );
      if (response.status === 501) {
        onUnsupported?.();
        return { results: [], total: 0 };
      }
      if (!response.ok) throw new Error("Failed to load pull requests");
      const data = (await response.json()) as PullRequestsResponse;
      const results = data.pullRequests.slice(0, pageSize);
      return {
        results,
        total: data.hasMore
          ? page * pageSize + results.length + 1
          : page * pageSize + results.length,
      };
    },
    [repositoryId, configId, state, onUnsupported]
  );

  return (
    <div className="space-y-2" data-testid="impact-pull-request-section">
      <div className="flex h-8 items-center justify-between gap-2">
        <Label>{t("pull.label")}</Label>
        <Select
          value={state}
          onValueChange={(next) => setState(next as PullRequestStateFilter)}
          disabled={disabled}
        >
          <SelectTrigger
            className="h-8 w-36"
            data-testid="impact-pull-request-state"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_FILTERS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(STATE_LABEL_KEY[option])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AsyncCombobox<RepoPullRequest>
        // Refetching on a state change is what makes the filter feel applied.
        key={state}
        value={value}
        onValueChange={onValueChange}
        fetchOptions={fetchOptions}
        renderOption={(pr) => (
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Badge variant={STATE_VARIANT[pr.state]} className="shrink-0">
              {t(STATE_LABEL_KEY[pr.state])}
            </Badge>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {"#"}
              {pr.number}
            </span>
            <span className="truncate">{pr.title}</span>
            {pr.authorName && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {pr.authorName}
              </span>
            )}
          </div>
        )}
        getOptionValue={(pr) => pr.number}
        placeholder={t("pull.searchPlaceholder")}
        triggerLabel={t("pull.selectPlaceholder")}
        ariaLabel={t("pull.label")}
        disabled={disabled}
        pageSize={50}
        dropdownClassName="p-0 min-w-[520px] max-w-[820px]"
        renderTrigger={({ value: selected, defaultContent }) => (
          <button
            type="button"
            className="group flex h-9 w-full items-center justify-start gap-2 rounded-md border border-input bg-background px-3 py-2 text-start text-sm shadow-xs hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            data-testid="impact-pull-request"
          >
            <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {selected ? (
              <span className="min-w-0 flex-1 truncate">
                {"#"}
                {selected.number} {selected.title}
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate">{defaultContent}</span>
            )}
          </button>
        )}
      />
    </div>
  );
}

export default PullRequestPicker;
