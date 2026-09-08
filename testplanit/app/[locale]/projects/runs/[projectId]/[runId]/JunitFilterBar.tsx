import { Button } from "@/components/ui/button";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { RotateCcw, X, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";
import { cn } from "~/utils";

export interface JunitFacetFilters {
  /** Selected result-status names (attempt rows keep their own status). */
  statuses: string[];
  suites: string[];
  flakyOnly: boolean;
  retriedOnly: boolean;
}

export const EMPTY_JUNIT_FACETS: JunitFacetFilters = {
  statuses: [],
  suites: [],
  flakyOnly: false,
  retriedOnly: false,
};

export function junitFacetsActive(facets: JunitFacetFilters): boolean {
  return (
    facets.statuses.length > 0 ||
    facets.suites.length > 0 ||
    facets.flakyOnly ||
    facets.retriedOnly
  );
}

export interface JunitFacetOption {
  value: string;
  count: number;
}

/** Serve the already-loaded facet options through the async-fetcher contract. */
function makeLocalFetcher(
  options: JunitFacetOption[]
): AsyncOptionsFetcher<JunitFacetOption> {
  return async (query, page, pageSize) => {
    const lower = query.toLowerCase();
    const filtered = lower
      ? options.filter((option) => option.value.toLowerCase().includes(lower))
      : options;
    const start = page * pageSize;
    return {
      results: filtered.slice(start, start + pageSize),
      total: filtered.length,
    };
  };
}

function FacetCombobox({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: JunitFacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const fetchOptions = useMemo(() => makeLocalFetcher(options), [options]);
  const selectedOptions = useMemo(
    () =>
      selected.map(
        (value) =>
          options.find((option) => option.value === value) ?? {
            value,
            count: 0,
          }
      ),
    [selected, options]
  );
  return (
    <MultiAsyncCombobox<JunitFacetOption>
      value={selectedOptions}
      onValueChange={(next) => onChange(next.map((option) => option.value))}
      fetchOptions={fetchOptions}
      getOptionValue={(option) => option.value}
      getOptionLabel={(option) => option.value}
      renderOption={(option) => (
        <span className="flex min-w-0 flex-1 items-center">
          <span className="min-w-0 flex-1 truncate">{option.value}</span>
          <span className="ms-2 text-xs text-muted-foreground">
            {option.count}
          </span>
        </span>
      )}
      renderSelectedOption={(option) => option.value}
      placeholder={label}
      ariaLabel={label}
      className="min-h-8 w-auto min-w-40 max-w-96"
      dropdownClassName="p-0 min-w-[280px] max-w-[400px]"
    />
  );
}

interface JunitFilterBarProps {
  facets: JunitFacetFilters;
  onFacetsChange: (next: JunitFacetFilters) => void;
  statusOptions: JunitFacetOption[];
  suiteOptions: JunitFacetOption[];
  /** Distinct flaky cases in the run — the toggle only shows when > 0. */
  flakyCaseCount: number;
  retriedCaseCount: number;
}

/**
 * Facet filters for the JUnit results table: result status, suite, and (when
 * the run has them) flaky/retried-only toggles. Filtering is client-side over
 * the already-loaded attempt rows; the metrics card's Flaky/Retries tiles set
 * `flakyOnly`/`retriedOnly` through the same state.
 */
export default function JunitFilterBar({
  facets,
  onFacetsChange,
  statusOptions,
  suiteOptions,
  flakyCaseCount,
  retriedCaseCount,
}: JunitFilterBarProps) {
  const t = useTranslations();
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="junit-filter-bar"
    >
      <FacetCombobox
        label={t("common.fields.resultStatus")}
        options={statusOptions}
        selected={facets.statuses}
        onChange={(statuses) => onFacetsChange({ ...facets, statuses })}
      />
      <FacetCombobox
        label={t("common.fields.suiteName")}
        options={suiteOptions}
        selected={facets.suites}
        onChange={(suites) => onFacetsChange({ ...facets, suites })}
      />
      {flakyCaseCount > 0 && (
        <Button
          type="button"
          variant={facets.flakyOnly ? "secondary" : "outline"}
          size="sm"
          className="h-8"
          aria-pressed={facets.flakyOnly}
          onClick={() =>
            onFacetsChange({ ...facets, flakyOnly: !facets.flakyOnly })
          }
          data-testid="junit-filter-flaky"
        >
          <Zap
            className={cn("h-3.5 w-3.5", facets.flakyOnly && "text-amber-500")}
          />
          {t("common.fields.flakyTests")}
        </Button>
      )}
      {retriedCaseCount > 0 && (
        <Button
          type="button"
          variant={facets.retriedOnly ? "secondary" : "outline"}
          size="sm"
          className="h-8"
          aria-pressed={facets.retriedOnly}
          onClick={() =>
            onFacetsChange({ ...facets, retriedOnly: !facets.retriedOnly })
          }
          data-testid="junit-filter-retried"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("runs.junitFilters.retried")}
        </Button>
      )}
      {junitFacetsActive(facets) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onFacetsChange(EMPTY_JUNIT_FACETS)}
          data-testid="junit-filter-clear"
        >
          <X className="h-3.5 w-3.5" />
          {t("runs.junitFilters.clear")}
        </Button>
      )}
    </div>
  );
}
