"use client";

import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";
import type { IssueFacetOptions } from "~/hooks/useIssueFilterOptions";
import type { IssueFacetValue } from "~/lib/issues/issueFacetConditions";

/**
 * Stands in for `null` where the combobox needs a string key. It never reaches
 * a query, and no real value can collide with it — blank values are not
 * offered as options.
 */
const NONE_KEY = "__issue_facet_none__";

interface FacetOption {
  value: IssueFacetValue;
  label: string;
}

const optionKey = (option: FacetOption) => option.value ?? NONE_KEY;

/** Serve an already-loaded option list through the async-fetcher contract. */
function makeLocalFetcher(
  options: FacetOption[]
): AsyncOptionsFetcher<FacetOption> {
  return async (query, page, pageSize) => {
    const lower = query.toLowerCase();
    const filtered = lower
      ? options.filter((option) => option.label.toLowerCase().includes(lower))
      : options;
    const start = page * pageSize;
    return {
      results: filtered.slice(start, start + pageSize),
      total: filtered.length,
    };
  };
}

function IssueFacetCombobox({
  label,
  placeholder,
  options,
  selected,
  onChange,
  testId,
}: {
  label: string;
  placeholder: string;
  options: FacetOption[];
  selected: IssueFacetValue[];
  onChange: (next: IssueFacetValue[]) => void;
  testId: string;
}) {
  const fetchOptions = useMemo(() => makeLocalFetcher(options), [options]);
  const selectedOptions = useMemo(
    () =>
      selected.map(
        (value) =>
          options.find((option) => option.value === value) ?? {
            value,
            label: value ?? "",
          }
      ),
    [selected, options]
  );

  return (
    <div data-testid={testId}>
      <MultiAsyncCombobox<FacetOption>
        value={selectedOptions}
        onValueChange={(next) => onChange(next.map((option) => option.value))}
        fetchOptions={fetchOptions}
        getOptionValue={optionKey}
        getOptionLabel={(option) => option.label}
        renderOption={(option) => (
          <span
            className={
              option.value === null
                ? "min-w-0 flex-1 truncate italic text-muted-foreground"
                : "min-w-0 flex-1 truncate"
            }
          >
            {option.label}
          </span>
        )}
        renderSelectedOption={(option) => option.label}
        placeholder={placeholder}
        ariaLabel={label}
        className="w-auto min-w-40 max-w-72"
        dropdownClassName="p-0 min-w-[240px] max-w-[400px]"
      />
    </div>
  );
}

/**
 * Status / priority / issue type facet filters shared by the global, project,
 * and admin issue lists. Option lists come from `useIssueFilterOptions`; each
 * facet is multi-select and an empty selection means "no filter".
 *
 * A facet with no values to offer is not rendered — it could only filter to
 * everything or to nothing. It stays mounted while its query is in flight so
 * the row does not reflow once the options land.
 *
 * Issue type additionally offers an explicit "not set" choice when some issues
 * in scope have no type: a type is only written on sync or on
 * create-through-integration, and several providers never supply one, so
 * untyped issues would otherwise be unreachable once any type is picked.
 */
export function IssueListFilters({
  statuses,
  priorities,
  issueTypes,
  statusFilter,
  priorityFilter,
  issueTypeFilter,
  onStatusChange,
  onPriorityChange,
  onIssueTypeChange,
  testIdPrefix = "issues",
}: {
  statuses: IssueFacetOptions;
  priorities: IssueFacetOptions;
  issueTypes: IssueFacetOptions;
  statusFilter: IssueFacetValue[];
  priorityFilter: IssueFacetValue[];
  issueTypeFilter: IssueFacetValue[];
  onStatusChange: (value: IssueFacetValue[]) => void;
  onPriorityChange: (value: IssueFacetValue[]) => void;
  onIssueTypeChange: (value: IssueFacetValue[]) => void;
  testIdPrefix?: string;
}) {
  const t = useTranslations();

  const statusOptions = useMemo(
    () => toOptions(statuses.values),
    [statuses.values]
  );

  const priorityOptions = useMemo(
    () => toOptions(priorities.values),
    [priorities.values]
  );

  const noIssueTypeLabel = t("common.filters.noIssueType");
  const issueTypeOptions = useMemo(
    () => [
      ...(issueTypes.hasNone ? [{ value: null, label: noIssueTypeLabel }] : []),
      ...toOptions(issueTypes.values),
    ],
    [issueTypes.hasNone, issueTypes.values, noIssueTypeLabel]
  );

  return (
    <>
      {!isEmptyFacet(statuses) && (
        <IssueFacetCombobox
          label={t("common.actions.status")}
          placeholder={t("common.filters.allStatuses")}
          options={statusOptions}
          selected={statusFilter}
          onChange={onStatusChange}
          testId={`${testIdPrefix}-status-filter`}
        />
      )}
      {!isEmptyFacet(priorities) && (
        <IssueFacetCombobox
          label={t("common.fields.priority")}
          placeholder={t("common.filters.allPriorities")}
          options={priorityOptions}
          selected={priorityFilter}
          onChange={onPriorityChange}
          testId={`${testIdPrefix}-priority-filter`}
        />
      )}
      {!isEmptyFacet(issueTypes) && (
        <IssueFacetCombobox
          label={t("issues.issueType")}
          placeholder={t("common.filters.allIssueTypes")}
          options={issueTypeOptions}
          selected={issueTypeFilter}
          onChange={onIssueTypeChange}
          testId={`${testIdPrefix}-issue-type-filter`}
        />
      )}
    </>
  );
}

/** Nothing to pick, and the query has answered — so it is really empty. */
function isEmptyFacet(facet: IssueFacetOptions): boolean {
  return facet.settled && facet.values.length === 0;
}

function toOptions(values: string[]): FacetOption[] {
  return values.map((value) => ({ value, label: value }));
}
