"use client";

import { AsyncCombobox } from "@/components/ui/async-combobox";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

export interface CommitRef {
  sha: string;
  shortSha: string;
  message?: string;
  authorName?: string;
  authoredAt?: string;
}

export interface CommitsResponse {
  ref: string;
  page: number;
  perPage: number;
  commits: CommitRef[];
  hasMore: boolean;
}

export const SHA_QUERY_PATTERN = /^[0-9a-f]{7,40}$/i;

const DEFAULT_DATE_FORMAT = "MM/dd/yyyy";

export function commitsUrl(
  repositoryId: number,
  configId: number,
  params: { ref: string; page?: number; perPage?: number }
): string {
  const search = new URLSearchParams({
    configId: String(configId),
    ref: params.ref,
  });
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.perPage !== undefined)
    search.set("perPage", String(params.perPage));
  return `/api/code-repositories/${repositoryId}/commits?${search.toString()}`;
}

export function toCommitRef(commit: CommitRef): CommitRef {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha || commit.sha.slice(0, 7),
    message: commit.message,
    authorName: commit.authorName,
    authoredAt: commit.authoredAt,
  };
}

export function firstLine(message: string | undefined): string {
  if (!message) return "";
  const newline = message.indexOf("\n");
  return newline === -1 ? message : message.slice(0, newline);
}

/** Formats an ISO timestamp with the viewer's date preference, as a string. */
export function useCommitDateFormatter(): (iso: string | undefined) => string {
  const locale = useLocale();
  const { data: session } = useSession();
  const dateFormat = session?.user?.preferences?.dateFormat;
  const dateLocale = getDateFnsLocale(locale);
  return useCallback(
    (iso: string | undefined) => {
      if (!iso) return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      const formatString = mapDateTimeFormatString(
        dateFormat ?? DEFAULT_DATE_FORMAT
      );
      try {
        return format(date, formatString, { locale: dateLocale });
      } catch {
        return format(date, DEFAULT_DATE_FORMAT, { locale: dateLocale });
      }
    },
    [dateFormat, dateLocale]
  );
}

export function CommitOption({
  commit,
  formatDate,
}: {
  commit: CommitRef;
  formatDate: (iso: string | undefined) => string;
}) {
  const meta = [commit.authorName, formatDate(commit.authoredAt)]
    .filter((part) => part && part.length > 0)
    .join(" · ");
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-sm">
      <code className="shrink-0 font-mono text-xs">{commit.shortSha}</code>
      <span className="truncate">{firstLine(commit.message)}</span>
      {meta && (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
          {"— "}
          {meta}
        </span>
      )}
    </div>
  );
}

interface CommitPickerProps {
  repositoryId: number;
  configId: number;
  branch: string | null;
  value: CommitRef | null;
  onValueChange: (commit: CommitRef | null) => void;
  ariaLabel: string;
  testId: string;
  disabled?: boolean;
  className?: string;
}

export function CommitPicker({
  repositoryId,
  configId,
  branch,
  value,
  onValueChange,
  ariaLabel,
  testId,
  disabled,
  className,
}: CommitPickerProps) {
  const t = useTranslations("runs.impact");
  const formatDate = useCommitDateFormatter();
  const [loadError, setLoadError] = useState(false);
  const loadedCountRef = useRef(0);

  const fetchOptions = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const trimmed = query.trim();
      setLoadError(false);

      if (SHA_QUERY_PATTERN.test(trimmed)) {
        if (page > 0) return { results: [] as CommitRef[], total: 0 };
        const response = await fetch(
          commitsUrl(repositoryId, configId, {
            ref: trimmed,
            page: 1,
            perPage: pageSize,
          })
        );
        if (response.status === 404) {
          return { results: [] as CommitRef[], total: 0 };
        }
        if (!response.ok) {
          setLoadError(true);
          return { results: [] as CommitRef[], total: 0 };
        }
        const data = (await response.json()) as CommitsResponse;
        const results = data.commits.map(toCommitRef);
        return { results, total: results.length };
      }

      if (!branch) return { results: [] as CommitRef[], total: 0 };

      const response = await fetch(
        commitsUrl(repositoryId, configId, {
          ref: branch,
          page: page + 1,
          perPage: pageSize,
        })
      );
      if (!response.ok) {
        setLoadError(true);
        return { results: [] as CommitRef[], total: 0 };
      }
      const data = (await response.json()) as CommitsResponse;
      const needle = trimmed.toLowerCase();
      const results = data.commits
        .map(toCommitRef)
        .filter(
          (commit) =>
            needle.length === 0 ||
            (commit.message ?? "").toLowerCase().includes(needle) ||
            (commit.authorName ?? "").toLowerCase().includes(needle)
        );
      const loadedBefore = page === 0 ? 0 : loadedCountRef.current;
      const loaded = loadedBefore + results.length;
      loadedCountRef.current = loaded;
      return { results, total: data.hasMore ? loaded + 1 : loaded };
    },
    [branch, configId, repositoryId]
  );

  return (
    <div className="space-y-1">
      <AsyncCombobox<CommitRef>
        value={value}
        onValueChange={onValueChange}
        fetchOptions={fetchOptions}
        renderOption={(commit) => (
          <CommitOption commit={commit} formatDate={formatDate} />
        )}
        getOptionValue={(commit) => commit.sha}
        placeholder={t("pick.commitPlaceholder")}
        ariaLabel={ariaLabel}
        disabled={disabled || !branch}
        showPagination={false}
        className={className ?? "w-full"}
        renderTrigger={({ defaultContent, loading }) => (
          <button
            type="button"
            className="group flex h-9 w-full items-center justify-start rounded-md border border-input bg-background px-3 py-2 text-start text-sm shadow-xs hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={testId}
            data-loading={loading ? "true" : undefined}
          >
            <span className="min-w-0 flex-1 truncate">{defaultContent}</span>
          </button>
        )}
      />
      {loadError && (
        <p className="text-xs text-destructive">{t("errors.commitsFailed")}</p>
      )}
    </div>
  );
}
