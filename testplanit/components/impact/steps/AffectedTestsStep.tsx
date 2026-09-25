"use client";

import { DataTable } from "@/components/tables/DataTable";
import type { SortConfig } from "@/components/tables/dataTableShared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ColumnDef,
  RowSelectionState,
} from "@/components/tables/tableFeatures";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import type {
  ImpactAnalysisCaseRow,
  ImpactAnalysisResultPayload,
} from "~/hooks/useImpactAnalysis";
import { Link } from "~/lib/navigation";
import type {
  AnalysisWarning,
  CaseTier,
  ReasonKind,
} from "~/lib/services/impact/types";
import type { ImpactRepoConfig } from "../ImpactDialog";
import {
  groupReasonsByKind,
  REASON_ICON,
  REASON_KIND_ORDER,
  REASON_LABEL_KEY,
  ReasonBadges,
  reasonDetailLines,
} from "../ReasonBadges";
import { UncoveredFilesCallout } from "../UncoveredFilesCallout";

export const TIER_ORDER: CaseTier[] = ["pinned", "affected", "related"];

const TIER_KEY: Record<CaseTier, string> = {
  pinned: "affected.tierPinned",
  affected: "affected.tierAffected",
  related: "affected.tierRelated",
};

const TIER_TOOLTIP_KEY: Record<CaseTier, string> = {
  pinned: "affected.tierPinnedTooltip",
  affected: "affected.tierAffectedTooltip",
  related: "affected.tierRelatedTooltip",
};

const TIER_VARIANT: Record<CaseTier, "default" | "secondary" | "outline"> = {
  pinned: "default",
  affected: "secondary",
  related: "outline",
};

const TIER_RANK: Record<CaseTier, number> = {
  pinned: 0,
  affected: 1,
  related: 2,
};

/** The threshold the tiers were cut at when the analysis did not record it. */
const DEFAULT_AFFECTED_THRESHOLD = 50;

export function warningCount(warning: AnalysisWarning): number | undefined {
  const detail = warning.detail ?? {};
  if (warning.code === "diff_truncated_by_budget") {
    const value = detail.omittedFileCount ?? detail.count;
    return typeof value === "number" ? value : 0;
  }
  if (warning.code === "ai_truncated") {
    const batches = detail.truncatedBatches;
    if (Array.isArray(batches)) return batches.length;
    const value = detail.count;
    return typeof value === "number" ? value : 0;
  }
  return undefined;
}

/**
 * The score at which a case counts as affected. Recent analyses record it;
 * older ones fall back to the lowest score among their affected cases, then
 * to the engine default.
 */
export function affectedThresholdOf(
  result: ImpactAnalysisResultPayload | null,
  cases: ImpactAnalysisCaseRow[]
): number {
  const recorded = result?.stats?.thresholds?.affected;
  if (typeof recorded === "number") return recorded;
  const affected = cases.filter((row) => row.tier === "affected");
  if (affected.length > 0) {
    return Math.floor(Math.min(...affected.map((row) => row.score)));
  }
  return DEFAULT_AFFECTED_THRESHOLD;
}

export interface AffectedFilters {
  /** Empty means every tier. */
  tiers: ReadonlySet<CaseTier>;
  /** Empty means every reason; otherwise a case needs one of these. */
  reasons: ReadonlySet<ReasonKind>;
  minScore: number;
}

export const NO_FILTERS: AffectedFilters = {
  tiers: new Set(),
  reasons: new Set(),
  minScore: 0,
};

/** The filters the step opens with: only the minimum score, at the threshold. */
export function defaultFilters(threshold: number): AffectedFilters {
  return { ...NO_FILTERS, minScore: threshold };
}

export function hasActiveFilters(
  filters: AffectedFilters,
  defaults: AffectedFilters = NO_FILTERS
): boolean {
  return (
    filters.tiers.size > 0 ||
    filters.reasons.size > 0 ||
    filters.minScore !== defaults.minScore
  );
}

export function filterCases(
  cases: ImpactAnalysisCaseRow[],
  filters: AffectedFilters
): ImpactAnalysisCaseRow[] {
  return cases.filter((row) => {
    if (filters.tiers.size > 0 && !filters.tiers.has(row.tier)) return false;
    if (row.score < filters.minScore) return false;
    if (filters.reasons.size > 0) {
      const kinds = new Set((row.reasons ?? []).map((reason) => reason.kind));
      let matches = false;
      for (const kind of filters.reasons) {
        if (kinds.has(kind)) {
          matches = true;
          break;
        }
      }
      if (!matches) return false;
    }
    return true;
  });
}

export interface TierOption {
  tier: CaseTier;
  count: number;
}

export interface ReasonOption {
  kind: ReasonKind;
  count: number;
}

/**
 * How many cases each tier or reason would show, given every OTHER filter,
 * so the counts in one picker follow the score slider and the other picker.
 */
export function facetCounts(
  cases: ImpactAnalysisCaseRow[],
  filters: AffectedFilters
): { tiers: TierOption[]; reasons: ReasonOption[] } {
  const forTiers = filterCases(cases, { ...filters, tiers: new Set() });
  const tierCounts: Record<CaseTier, number> = {
    pinned: 0,
    affected: 0,
    related: 0,
  };
  for (const row of forTiers) tierCounts[row.tier]++;

  const forReasons = filterCases(cases, { ...filters, reasons: new Set() });
  const reasonCounts = new Map<ReasonKind, number>();
  for (const row of forReasons) {
    const kinds = new Set((row.reasons ?? []).map((reason) => reason.kind));
    for (const kind of kinds) {
      reasonCounts.set(kind, (reasonCounts.get(kind) ?? 0) + 1);
    }
  }

  // Every tier or reason present in the whole result stays offered, at zero
  // when the other filters exclude it, so a choice never disappears.
  const presentTiers = new Set(cases.map((row) => row.tier));
  const presentReasons = new Set(
    cases.flatMap((row) => (row.reasons ?? []).map((reason) => reason.kind))
  );
  return {
    tiers: TIER_ORDER.filter((tier) => presentTiers.has(tier)).map((tier) => ({
      tier,
      count: tierCounts[tier],
    })),
    reasons: REASON_KIND_ORDER.filter((kind) => presentReasons.has(kind)).map(
      (kind) => ({ kind, count: reasonCounts.get(kind) ?? 0 })
    ),
  };
}

export function sortCases(
  cases: ImpactAnalysisCaseRow[],
  sort: SortConfig
): ImpactAnalysisCaseRow[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  const compare = (a: ImpactAnalysisCaseRow, b: ImpactAnalysisCaseRow) => {
    switch (sort.column) {
      case "case":
        return a.case.name.localeCompare(b.case.name) * dir;
      case "tier":
        return (TIER_RANK[a.tier] - TIER_RANK[b.tier]) * dir;
      default:
        return (a.score - b.score) * dir;
    }
  };
  // Score breaks every tie so the order is stable across renders.
  return [...cases].sort((a, b) => compare(a, b) || b.score - a.score);
}

type AffectedRow = ImpactAnalysisCaseRow & { id: number };

interface AffectedTestsStepProps {
  projectId: number;
  config: ImpactRepoConfig;
  cases: ImpactAnalysisCaseRow[];
  /** Cases the analysis found that are already in the run and so not listed. */
  excludedCount?: number;
  result: ImpactAnalysisResultPayload | null;
  selectedCaseIds: number[];
  onToggleCase: (caseId: number) => void;
  onSetSelection: (caseIds: number[]) => void;
  pinnedUncovered: Record<string, number>;
  onPinCreated: (path: string, caseId: number) => void;
}

const DEFAULT_SORT: SortConfig = { column: "score", direction: "desc" };
const noopVisibilityChange = () => {};

export function AffectedTestsStep({
  projectId,
  config,
  cases,
  excludedCount = 0,
  result,
  selectedCaseIds,
  onSetSelection,
  pinnedUncovered,
  onPinCreated,
}: AffectedTestsStepProps) {
  const t = useTranslations("runs.impact");
  const tRuns = useTranslations("runs");
  const tCommon = useTranslations("common");
  const tCodePins = useTranslations("repository.codePins");
  const tDuplicates = useTranslations("repository.duplicates");
  const locale = useLocale();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const threshold = affectedThresholdOf(result, cases);
  // The list opens showing what starts selected: the cases at or above the
  // affected threshold. Lowering the score reveals the rest.
  const initialFilters = useMemo(() => defaultFilters(threshold), [threshold]);
  const [filters, setFilters] = useState<AffectedFilters>(initialFilters);
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const selected = useMemo(() => new Set(selectedCaseIds), [selectedCaseIds]);
  const warnings = result?.warnings ?? [];
  const stalePins = result?.stalePins ?? [];
  const uncoveredFiles = result?.uncoveredFiles ?? [];

  const facets = useMemo(() => facetCounts(cases, filters), [cases, filters]);
  const tierLabel = useCallback(
    (option: TierOption) => t(TIER_KEY[option.tier]),
    [t]
  );
  const reasonLabel = useCallback(
    (option: ReasonOption) => t(REASON_LABEL_KEY[option.kind]),
    [t]
  );
  const fetchTierOptions = useCallback(
    (query: string) => {
      const needle = query.trim().toLowerCase();
      const results = facets.tiers.filter(
        (option) => !needle || tierLabel(option).toLowerCase().includes(needle)
      );
      return Promise.resolve({ results, total: results.length });
    },
    [facets.tiers, tierLabel]
  );
  const fetchReasonOptions = useCallback(
    (query: string) => {
      const needle = query.trim().toLowerCase();
      const results = facets.reasons.filter(
        (option) =>
          !needle || reasonLabel(option).toLowerCase().includes(needle)
      );
      return Promise.resolve({ results, total: results.length });
    },
    [facets.reasons, reasonLabel]
  );
  const selectedTiers = useMemo(
    () => facets.tiers.filter((option) => filters.tiers.has(option.tier)),
    [facets.tiers, filters.tiers]
  );
  const selectedReasons = useMemo(
    () => facets.reasons.filter((option) => filters.reasons.has(option.kind)),
    [facets.reasons, filters.reasons]
  );

  const shown = useMemo(
    () => sortCases(filterCases(cases, filters), sort),
    [cases, filters, sort]
  );
  const rows = useMemo<AffectedRow[]>(
    () => shown.map((row) => ({ ...row, id: row.caseId })),
    [shown]
  );
  const shownSelectedCount = shown.filter((row) =>
    selected.has(row.caseId)
  ).length;

  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries(selectedCaseIds.map((id) => [String(id), true])),
    [selectedCaseIds]
  );
  const handleRowSelectionChange = useCallback(
    (
      updater:
        RowSelectionState | ((old: RowSelectionState) => RowSelectionState)
    ) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater;
      onSetSelection(
        Object.entries(next)
          .filter(([, on]) => on)
          .map(([id]) => Number(id))
      );
    },
    [rowSelection, onSetSelection]
  );

  /** Select or deselect just the rows the filters leave visible. */
  const setShownSelected = (on: boolean) => {
    const shownIds = new Set(shown.map((row) => row.caseId));
    const kept = selectedCaseIds.filter((id) => !shownIds.has(id));
    onSetSelection(on ? [...kept, ...shownIds] : kept);
  };

  const toggleExpanded = useCallback((caseId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  }, []);

  const handleSortChange = useCallback((column: string) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: column === "score" ? "desc" : "asc" }
    );
  }, []);

  const setTiers = (options: TierOption[]) =>
    setFilters((prev) => ({
      ...prev,
      tiers: new Set(options.map((option) => option.tier)),
    }));
  const setReasons = (options: ReasonOption[]) =>
    setFilters((prev) => ({
      ...prev,
      reasons: new Set(options.map((option) => option.kind)),
    }));

  const renderRationale = useCallback(
    (row: AffectedRow) => {
      const groups = groupReasonsByKind(row.reasons ?? []);
      return (
        <div
          className="mt-2 space-y-2 rounded-md bg-muted/30 p-2 text-sm"
          data-testid={`impact-rationale-${row.caseId}`}
        >
          {[...groups.entries()].map(([kind, reasons]) => {
            const lines = reasonDetailLines(t, kind, reasons);
            return (
              <div
                key={kind}
                className="flex flex-wrap items-start gap-2"
                data-testid={`impact-reason-${row.caseId}-${kind}`}
              >
                <ReasonBadges reasons={reasons} className="shrink-0" />
                <ul className="min-w-0 flex-1 space-y-0.5">
                  {lines.map((line, index) => (
                    <li
                      key={index}
                      className="flex flex-wrap items-center gap-2 break-words"
                    >
                      <span>{line.text}</span>
                      {line.stale && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Badge variant="destructive">
                                {t("stale.badge")}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {t("stale.tooltipAnalysis")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {row.coveredFiles.length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
              {row.coveredFiles.slice(0, 8).map((path) => (
                <li key={path} className="truncate">
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    },
    [t]
  );

  const columns = useMemo<ColumnDef<AffectedRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(value === true)
            }
            aria-label={tCommon("aria.selectAll")}
            data-testid="impact-select-all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
            aria-label={row.original.case.name}
            data-testid={`impact-recommendation-checkbox-${row.original.caseId}`}
          />
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 40,
        minSize: 40,
        maxSize: 40,
      },
      {
        id: "case",
        header: tCodePins("caseLabel"),
        size: 380,
        enableSorting: true,
        meta: { wrap: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/projects/repository/${projectId}/${row.original.caseId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm font-medium hover:underline"
            >
              {row.original.case.name}
            </Link>
            {row.original.case.folder && (
              <p className="truncate text-xs text-muted-foreground">
                {row.original.case.folder.name}
              </p>
            )}
            {expanded.has(row.original.caseId) && renderRationale(row.original)}
          </div>
        ),
      },
      {
        id: "score",
        header: tDuplicates("columnScore"),
        size: 90,
        enableSorting: true,
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {Math.round(row.original.score).toLocaleString(locale)}
          </Badge>
        ),
      },
      {
        id: "tier",
        header: t("affected.tierAffected"),
        size: 120,
        enableSorting: true,
        cell: ({ row }) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Badge
                  variant={TIER_VARIANT[row.original.tier]}
                  data-testid={`impact-tier-${row.original.caseId}`}
                >
                  {t(TIER_KEY[row.original.tier])}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t(TIER_TOOLTIP_KEY[row.original.tier], { threshold })}
            </TooltipContent>
          </Tooltip>
        ),
      },
      {
        id: "reasons",
        header: t("affected.reasons"),
        size: 240,
        enableSorting: false,
        meta: { wrap: true },
        cell: ({ row }) => (
          <ReasonBadges reasons={row.original.reasons ?? []} />
        ),
      },
      {
        id: "details",
        header: "",
        size: 48,
        minSize: 48,
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        cell: ({ row }) => {
          const isExpanded = expanded.has(row.original.caseId);
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => toggleExpanded(row.original.caseId)}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? t("affected.hideDetails")
                  : t("affected.showDetails")
              }
              data-testid={`impact-recommendation-toggle-${row.original.caseId}`}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          );
        },
      },
    ],
    [
      t,
      tCommon,
      tCodePins,
      tDuplicates,
      locale,
      projectId,
      threshold,
      expanded,
      renderRationale,
      toggleExpanded,
    ]
  );
  const columnVisibility = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, true])),
    [columns]
  );

  return (
    <div className="space-y-4 py-2">
      <div>
        <h3
          className="text-sm font-semibold"
          data-testid="impact-affected-title"
        >
          {t("affected.selectedOf", {
            selected: selectedCaseIds.length,
            total: cases.length,
          })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("affected.thresholdHint", { threshold })}
        </p>
        {excludedCount > 0 && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="impact-excluded-note"
          >
            {t("affected.excluded", { count: excludedCount })}
          </p>
        )}
      </div>

      {result?.summary && (
        <div
          className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm"
          data-testid="impact-summary"
        >
          <Label className="flex items-center gap-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            {tCommon("fields.summary")}
          </Label>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {result.summary}
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <Alert data-testid="impact-warnings">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc space-y-0.5 ps-4">
              {warnings.map((warning, index) => {
                const count = warningCount(warning);
                return (
                  <li key={`${warning.code}-${index}`}>
                    {count === undefined
                      ? t(`warnings.${warning.code}`)
                      : t(`warnings.${warning.code}`, { count })}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {stalePins.length > 0 && (
        <Alert data-testid="impact-stale-pins">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {t("stale.title", { count: stalePins.length })}
          </AlertTitle>
          <AlertDescription>
            <p>{t("stale.description")}</p>
            <ul className="mt-2 space-y-1">
              {stalePins.map((pin) => (
                <li
                  key={pin.pinId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Badge variant="outline">{pin.pinKind}</Badge>
                  <code className="font-mono text-xs">{pin.filePath}</code>
                  {pin.suggestedPath && (
                    <>
                      <span className="text-muted-foreground">{"→"}</span>
                      <code className="font-mono text-xs">
                        {pin.suggestedPath}
                      </code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {cases.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("noAffected.title")}</AlertTitle>
          <AlertDescription>{t("noAffected.description")}</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-3">
          <div
            className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-md border p-3"
            data-testid="impact-affected-filters"
          >
            <div className="w-56 space-y-1">
              <Label className="text-xs" id="impact-filter-tier-label">
                {t("affected.tierAffected")}
              </Label>
              <div data-testid="impact-filter-tier">
                <MultiAsyncCombobox<TierOption>
                  value={selectedTiers}
                  onValueChange={setTiers}
                  fetchOptions={fetchTierOptions}
                  getOptionValue={(option) => option.tier}
                  getOptionLabel={tierLabel}
                  renderOption={(option) => (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="flex w-full items-center justify-between gap-2"
                          data-testid={`impact-filter-tier-${option.tier}`}
                        >
                          <span>{tierLabel(option)}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {option.count.toLocaleString(locale)}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs" side="right">
                        {t(TIER_TOOLTIP_KEY[option.tier], { threshold })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  renderSelectedOption={tierLabel}
                  placeholder={tCommon("filters.all")}
                  ariaLabel={t("affected.tierAffected")}
                  hideSelectAll
                />
              </div>
            </div>

            <div className="w-64 space-y-1">
              <Label className="text-xs">{t("affected.reasons")}</Label>
              <div data-testid="impact-filter-reason">
                <MultiAsyncCombobox<ReasonOption>
                  value={selectedReasons}
                  onValueChange={setReasons}
                  fetchOptions={fetchReasonOptions}
                  getOptionValue={(option) => option.kind}
                  getOptionLabel={reasonLabel}
                  renderOption={(option) => {
                    const Icon = REASON_ICON[option.kind];
                    return (
                      <span
                        className="flex w-full items-center justify-between gap-2"
                        data-testid={`impact-filter-reason-${option.kind}`}
                      >
                        <span className="flex items-center gap-1">
                          <Icon className="h-3 w-3" />
                          {reasonLabel(option)}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {option.count.toLocaleString(locale)}
                        </span>
                      </span>
                    );
                  }}
                  renderSelectedOption={reasonLabel}
                  placeholder={tCommon("filters.all")}
                  ariaLabel={t("affected.reasons")}
                  hideSelectAll
                />
              </div>
            </div>

            <div className="w-48 space-y-1">
              <Label className="flex items-center justify-between text-xs">
                <span id="impact-min-score-label">
                  {t("affected.minScore")}
                </span>
                <span
                  className="font-mono"
                  data-testid="impact-filter-min-score-value"
                >
                  {filters.minScore.toLocaleString(locale)}
                </span>
              </Label>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[filters.minScore]}
                onValueChange={([value]) =>
                  setFilters((prev) => ({ ...prev, minScore: value ?? 0 }))
                }
                aria-labelledby="impact-min-score-label"
                data-testid="impact-filter-min-score"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                shown.length === 0 || shownSelectedCount === shown.length
              }
              onClick={() => setShownSelected(true)}
              data-testid="impact-select-shown"
            >
              {t("affected.selectShown", { count: shown.length })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={shownSelectedCount === 0}
              onClick={() => setShownSelected(false)}
              data-testid="impact-deselect-shown"
            >
              {t("affected.deselectShown", { count: shownSelectedCount })}
            </Button>
            {hasActiveFilters(filters, initialFilters) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFilters(initialFilters)}
                data-testid="impact-clear-filters"
              >
                {tRuns("junitFilters.clear")}
              </Button>
            )}
            <span
              className="ms-auto text-xs text-muted-foreground"
              data-testid="impact-shown-count"
            >
              {t("affected.shownCount", {
                shown: shown.length,
                total: cases.length,
              })}
            </span>
          </div>

          <DataTable<AffectedRow>
            columns={columns}
            data={rows}
            getRowId={(row) => String(row.id)}
            rowTestIdPrefix="impact-recommendation"
            rowSelection={rowSelection}
            onRowSelectionChange={handleRowSelectionChange}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={noopVisibilityChange}
            sortConfig={sort}
            onSortChange={handleSortChange}
            storageKey="impact-affected-tests"
            enableColumnReorder={false}
            enableColumnMenu={false}
            emptyMessage={t("affected.noneShown")}
          />
        </div>
      )}

      <UncoveredFilesCallout
        projectId={projectId}
        configId={config.id}
        repositoryId={config.repositoryId}
        files={uncoveredFiles}
        pinned={pinnedUncovered}
        onPinned={onPinCreated}
      />
    </div>
  );
}
