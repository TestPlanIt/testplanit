"use client";

import { RepositoryFilterBar } from "@/components/repository/filter-bar/RepositoryFilterBar";
import { getDimensionLabel } from "@/components/repository/filter-bar/dimensionPresentation";
import {
  getDimensionValueOptions,
  type FilterBarViewOptions,
} from "@/components/repository/filter-bar/valueOptions";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { dropConflictingPredicates } from "~/hooks/useRepositoryFilters";
import { formatFilterChipText } from "~/lib/repository/filterChipText";
import { chipOperatorLabelKey } from "~/lib/repository/filterDimensionLabels";
import {
  buildFilterDimensions,
  dynamicFieldDimensionKey,
  getOperatorArity,
  type FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";
import {
  clampFilterPredicates,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";
import { schema } from "~/zenstack/schema";
import { getDateFnsLocale } from "~/utils/locales";

export interface ProjectCaseFilterOptions {
  /** The project's repository filter dimensions, as the repository page builds them. */
  registry: FilterDimensionRegistry;
  viewOptions: FilterBarViewOptions | undefined;
  /** Dynamic-field dimension key → the field's display name. */
  dynamicFieldLabels: Record<string, string>;
  /** True once the dimensions are known, so a stored filter can be judged. */
  ready: boolean;
}

/**
 * What a Create test run rule's test case filters need from the project:
 * the repository's filter dimensions and the names behind their values,
 * from the same view-options query the repository page runs. Run-only
 * dimensions are left out: the run has no results when it is created.
 */
export function useProjectCaseFilterOptions(
  projectId: number,
  enabled = true
): ProjectCaseFilterOptions {
  const { data: viewOptions } = useQuery<FilterBarViewOptions>({
    queryKey: ["viewOptions", projectId, "caseFilter"],
    queryFn: async () => {
      const response = await fetch("/api/repository-cases/view-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) throw new Error("Failed to fetch view options");
      return response.json();
    },
    enabled,
    staleTime: 30_000,
  });
  const { enabled: reviewEnabled } = useReviewFeatureEnabled(projectId);
  const queries = useClientQueries(schema);
  const { data: project } = queries.projects.useFindUnique(
    {
      where: { id: projectId },
      select: { impactEnabled: true, riskScoringEnabled: true },
    },
    { enabled }
  );

  const dynamicFieldSignature = useMemo(
    () =>
      JSON.stringify(
        Object.entries(viewOptions?.dynamicFields ?? {})
          .map(
            ([displayName, field]) =>
              [field.fieldId, field.type, displayName] as const
          )
          .sort((a, b) => a[0] - b[0])
      ),
    [viewOptions?.dynamicFields]
  );
  const fields = useMemo(
    () => JSON.parse(dynamicFieldSignature) as Array<[number, string, string]>,
    [dynamicFieldSignature]
  );
  const registry = useMemo(
    () =>
      buildFilterDimensions({
        dynamicFields: fields.map(([fieldId, type]) => ({ fieldId, type })),
        includeInReview: reviewEnabled === true,
        includeCodePins: project?.impactEnabled === true,
        includeRiskScore: project?.riskScoringEnabled === true,
      }),
    [fields, reviewEnabled, project?.impactEnabled, project?.riskScoringEnabled]
  );
  // Only fields the registry turned into dimensions: a field of an
  // unfilterable type has no chip to label.
  const dynamicFieldLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const [fieldId, , displayName] of fields) {
      const key = dynamicFieldDimensionKey(fieldId);
      if (registry.has(key)) labels[key] = displayName;
    }
    return labels;
  }, [fields, registry]);

  return {
    registry,
    viewOptions,
    dynamicFieldLabels,
    ready:
      viewOptions !== undefined &&
      reviewEnabled !== undefined &&
      project !== undefined,
  };
}

/**
 * One stored filter as the repository's chips read it, e.g. "Automation: Is
 * Automated", or null when the project no longer offers its dimension.
 */
export function useCaseFilterText(
  options: ProjectCaseFilterOptions
): (predicate: FilterPredicate) => string | null {
  const t = useTranslations();
  const locale = useLocale();
  return useCallback(
    (predicate) => {
      const dimension = options.registry.get(predicate.dimension);
      if (!dimension) return null;
      return formatFilterChipText({
        dimension,
        predicate,
        label: getDimensionLabel(dimension, t, options.dynamicFieldLabels),
        operatorLabel: t(
          chipOperatorLabelKey(predicate.operator, predicate.values.length)
        ),
        options: getDimensionValueOptions(dimension, options.viewOptions, t),
        localeTag: locale,
        dateLocale: getDateFnsLocale(locale),
      });
    },
    [options, t, locale]
  );
}

interface Props {
  options: ProjectCaseFilterOptions;
  value: FilterPredicate[];
  onChange: (next: FilterPredicate[]) => void;
}

/**
 * The test case filters a Create test run rule applies: the repository's
 * own filter bar, held in the rule instead of the URL. A stored filter on a
 * dimension the project no longer has stays out of sight and is dropped
 * when the rule is saved.
 */
export function WebhookActionCaseFilter({ options, value, onChange }: Props) {
  const t = useTranslations("projects.settings.webhooks.actions");
  const tViews = useTranslations("repository.savedViews");

  const commit = useCallback(
    (next: FilterPredicate[]) =>
      onChange(clampFilterPredicates(next).predicates),
    [onChange]
  );
  const add = useCallback(
    (next: FilterPredicate) => commit(upsertCaseFilterPredicate(value, next)),
    [value, commit]
  );
  const update = useCallback(
    (dimension: string, operator: string, next: FilterPredicate) => {
      const replaced = replaceCaseFilterPredicate(
        value,
        dimension,
        operator,
        next
      );
      if (replaced) commit(replaced);
    },
    [value, commit]
  );
  const remove = useCallback(
    (dimension: string, operator: string) =>
      commit(
        value.filter(
          (p) => !(p.dimension === dimension && p.operator === operator)
        )
      ),
    [value, commit]
  );
  const clear = useCallback(() => commit([]), [commit]);

  const unknownCount = options.ready
    ? value.filter((p) => !options.registry.has(p.dimension)).length
    : 0;

  return (
    <div className="space-y-1.5" data-testid="webhook-action-case-filter">
      <Label>{t("caseFilter")}</Label>
      <RepositoryFilterBar
        predicates={value}
        onAdd={add}
        onUpdate={update}
        onRemove={remove}
        onClearAll={clear}
        registry={options.registry}
        viewOptions={options.viewOptions}
        isRunMode={false}
      />
      <p className="text-xs text-muted-foreground">{t("caseFilterHelp")}</p>
      {unknownCount > 0 && (
        <p
          className="text-xs text-muted-foreground italic"
          data-testid="webhook-action-case-filter-dropped"
        >
          {tViews("droppedFilters", { count: unknownCount })}
        </p>
      )}
    </div>
  );
}

/**
 * Upsert keyed by (dimension, operator), then drop whatever now contradicts
 * the added predicate — what useRepositoryFilters.addPredicate does for the
 * URL-backed bar, for a list held in a form instead.
 */
export function upsertCaseFilterPredicate(
  value: readonly FilterPredicate[],
  next: FilterPredicate
): FilterPredicate[] {
  const index = value.findIndex(
    (p) => p.dimension === next.dimension && p.operator === next.operator
  );
  const upserted =
    index === -1
      ? [...value, next]
      : value.map((p, i) => (i === index ? next : p));
  return dropConflictingPredicates(upserted, next);
}

/**
 * Replace the predicate at (dimension, operator) with `next`, which may
 * re-key it; editing away the last value of an operator that needs one
 * removes it. Null when there is nothing at that key.
 */
export function replaceCaseFilterPredicate(
  value: readonly FilterPredicate[],
  dimension: string,
  operator: string,
  next: FilterPredicate
): FilterPredicate[] | null {
  const index = value.findIndex(
    (p) => p.dimension === dimension && p.operator === operator
  );
  if (index === -1) return null;
  const removesLastValue =
    next.values.length === 0 && (getOperatorArity(next.operator)?.min ?? 0) > 0;
  const result: FilterPredicate[] = [];
  value.forEach((p, i) => {
    if (i === index) {
      if (!removesLastValue) result.push(next);
      return;
    }
    // A re-key can land on another chip's key; that chip gives way.
    if (
      !removesLastValue &&
      p.dimension === next.dimension &&
      p.operator === next.operator
    ) {
      return;
    }
    result.push(p);
  });
  return removesLastValue ? result : dropConflictingPredicates(result, next);
}

/** The filters a rule can be saved with: the ones the project offers today. */
export function caseFilterForSave(
  value: FilterPredicate[],
  options: ProjectCaseFilterOptions
): FilterPredicate[] {
  return options.ready
    ? value.filter((p) => options.registry.has(p.dimension))
    : value;
}
