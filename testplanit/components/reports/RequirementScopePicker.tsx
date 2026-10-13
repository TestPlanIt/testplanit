"use client";

import { HelpPopover } from "@/components/ui/help-popover";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";

/**
 * The subset of `RequirementTreeRow` the scope picker actually holds:
 * enough for `formatIssueDisplayText`'s "KEY: Title" convention and the
 * id the report request carries. Selected options persist in the report
 * builder's state (and ride into the share config as ids only), so the
 * shape is kept deliberately small.
 */
export interface RequirementScopeOption {
  id: number;
  name: string;
  title: string | null;
  externalUrl: string | null;
}

interface RequirementScopePickerProps {
  projectId: number;
  value: RequirementScopeOption[];
  onValueChange: (next: RequirementScopeOption[]) => void;
}

/**
 * Scope control for the two requirement report types
 * (`requirement-coverage-gaps` / `requirement-traceability`): pick the
 * requirements whose subtrees the report is confined to — "report on
 * Enrolments only". Empty selection means the whole project.
 *
 * Options come from the requirements tree route rather than a raw model
 * query so the picker sees exactly what the tree renders (deleted rows
 * excluded, viewer-scoped by the route's own project gate):
 * - empty search → the roots window (top-level hierarchies, the natural
 *   things to scope a report to),
 * - typed search → the same filtered-match page the list's own filter
 *   bar uses, which matches name AND title anywhere in the forest.
 *
 * One page per query, no cursor paging: the picker is a narrow-by-typing
 * surface (the `search-issues-dialog` convention), so `total` is
 * reported as the returned row count to keep the load-more sentinel
 * quiet.
 */
export function RequirementScopePicker({
  projectId,
  value,
  onValueChange,
}: RequirementScopePickerProps) {
  const tReports = useTranslations("reports.ui");

  const fetchOptions = useCallback<AsyncOptionsFetcher<RequirementScopeOption>>(
    async (query, page, pageSize) => {
      // Pages past the first would re-serve page one (no cursor is kept);
      // returning an empty page keeps the accumulated list intact and
      // ends the sentinel's walk immediately.
      if (page > 0) return [];

      const treeUrl = `/api/projects/${projectId}/requirements/tree`;
      const trimmed = query.trim();
      const response = trimmed
        ? await fetch(treeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              search: trimmed,
              include: "rows",
              limit: pageSize,
              cursor: null,
            }),
          })
        : await fetch(`${treeUrl}?limit=${pageSize}`);
      if (!response.ok) return [];

      const data = (await response.json()) as {
        rows?: RequirementScopeOption[];
        matchedIds?: number[];
      };
      const rows = data.rows ?? [];
      // The filtered page hydrates ancestor rows alongside the matches so
      // the tree can render retention — a picker has no tree, so only the
      // rows the search actually matched are options.
      const matched = data.matchedIds ? new Set(data.matchedIds) : null;
      const results = matched
        ? rows.filter((row) => matched.has(row.id))
        : rows;
      return { results, total: results.length };
    },
    [projectId]
  );

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">
          {tReports("requirementCoverage.scopeLabel")}
        </label>
        <HelpPopover
          helpKey={`## ${tReports("requirementCoverage.scopeLabel")}\n${tReports("requirementCoverage.scopeHelp")}`}
        />
      </div>
      <RequirementScopeCombobox
        value={value}
        onValueChange={onValueChange}
        fetchOptions={fetchOptions}
        placeholder={tReports("requirementCoverage.scopePlaceholder")}
        ariaLabel={tReports("requirementCoverage.scopeLabel")}
      />
    </div>
  );
}

/** The bare combobox, split out so tests can stub the popover-based
 * control the same way `RequirementsListView.test.tsx` stubs its own
 * `MultiAsyncCombobox` axes (real Radix popovers don't survive jsdom). */
function RequirementScopeCombobox({
  value,
  onValueChange,
  fetchOptions,
  placeholder,
  ariaLabel,
}: {
  value: RequirementScopeOption[];
  onValueChange: (next: RequirementScopeOption[]) => void;
  fetchOptions: AsyncOptionsFetcher<RequirementScopeOption>;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <span data-testid="requirement-scope-picker">
      <MultiAsyncCombobox<RequirementScopeOption>
        value={value}
        onValueChange={onValueChange}
        fetchOptions={fetchOptions}
        renderOption={(option) => formatIssueDisplayText(option)}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => formatIssueDisplayText(option)}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        className="w-full"
      />
    </span>
  );
}
