"use client";

import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  dynamicFieldDimensionKey,
  getOperatorArity,
  type FilterDimension,
  type FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";
import {
  isFilterPredicateLimitReached,
  MAX_FILTER_PREDICATES,
  MAX_VALUES_PER_PREDICATE,
  type FilterCapTruncation,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";
import type { SavedRepositoryViewCriteria } from "~/lib/schemas/savedRepositoryView";
import { AddFilterButton } from "./AddFilterButton";
import { chipKey, defaultPredicateFor, isCommittable } from "./chipHelpers";
import { getDimensionIcon, getDimensionLabel } from "./dimensionPresentation";
import { FilterChip } from "./FilterChip";
import { SavedViewsMenu } from "./SavedViewsMenu";
import {
  getDimensionValueOptions,
  type FilterBarViewOptions,
} from "./valueOptions";

/**
 * Everything the saved-views control needs that the FilterBar does not already
 * hold: the owning project, the grouping axis and search text a view captures
 * alongside the predicates, and the apply callback. Omit the prop entirely to
 * render the bar without saved views.
 */
export interface RepositorySavedViewsBinding {
  projectId: number;
  /** Current grouping axis (`?view=`); null means the surface's default. */
  axis: string | null;
  /**
   * Applies a saved view. The host routes this through the same predicate
   * setter the chips use, so the URL updates and the view stays shareable.
   */
  onApply: (criteria: SavedRepositoryViewCriteria) => void;
}

export interface RepositoryFilterBarProps {
  predicates: FilterPredicate[];
  /** Upsert keyed by (dimension, operator) — useRepositoryFilters.addPredicate. */
  onAdd: (next: FilterPredicate) => void;
  /** useRepositoryFilters.updatePredicate — may re-key the chip's operator. */
  onUpdate: (
    dimension: string,
    operator: string,
    next: FilterPredicate
  ) => void;
  onRemove: (dimension: string, operator: string) => void;
  onClearAll: () => void;
  /** The active mode's registry (buildFilterDimensions). */
  registry: FilterDimensionRegistry;
  viewOptions?: FilterBarViewOptions;
  isRunMode: boolean;
  /**
   * The active search matched more cases than Elasticsearch's result window
   * could return, so filters and counts apply to the top `searchWindow`
   * matches only (spec §9). Rendered as a notice beside the chips.
   */
  searchTruncated?: boolean;
  /** Size of that window, for the notice's number. */
  searchWindow?: number;
  /**
   * True while the chip editors' option counts are stale for the active
   * predicates (the previous predicate set's view-options response is shown
   * while the filter-aware refetch is in flight) — counts render muted with
   * an explanatory tooltip.
   */
  countsMuted?: boolean;
  /**
   * What the hard caps trimmed, on read (an over-cap shared link) or on write
   * (the codec's clamp) — `useRepositoryFilters.truncation`. Surfaced so an
   * over-cap filter set never silently shows fewer filters, or fewer values,
   * than it carried. The two caps render as two distinct notices.
   */
  truncation?: FilterCapTruncation;
  /**
   * Wires the saved-views menu into the bar. Saved views are the curated,
   * named complement to the ad-hoc sharing the `f`/`fz` URL params already
   * provide — same state, different lifetime.
   */
  savedViews?: RepositorySavedViewsBinding;
}

interface ChipEntry {
  predicate: FilterPredicate;
  dimension: FilterDimension;
}

/**
 * The FilterBar above the case table: live editable chips, an Add-filter
 * picker, the run-mode "assigned to me" quick toggle, Clear-all, and the
 * results count. Fully controlled — predicate state lives in
 * useRepositoryFilters, wired in by ProjectRepository.
 */
export function RepositoryFilterBar({
  predicates,
  onAdd,
  onUpdate,
  onRemove,
  onClearAll,
  registry,
  viewOptions,
  isRunMode,
  searchTruncated = false,
  searchWindow = 0,
  countsMuted = false,
  truncation,
  savedViews,
}: RepositoryFilterBarProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const meId = session?.user?.id;

  const [openChipKey, setOpenChipKey] = useState<string | null>(null);
  // Add-filter picks whose seed predicate is not yet committable (e.g.
  // `templates:in` before a template is chosen) live here, off-URL, until the
  // editor produces a valid state.
  const [draft, setDraft] = useState<ChipEntry | null>(null);

  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const chips = useMemo<ChipEntry[]>(
    () =>
      predicates.flatMap((predicate) => {
        const dimension = registry.get(predicate.dimension);
        return dimension ? [{ predicate, dimension }] : [];
      }),
    [predicates, registry]
  );

  // The counts payload gets a fresh identity on every refetch (each chip edit
  // re-keys that query), so derive the labels from a stable signature instead
  // of the object — otherwise the dimension list rebuilds under an open picker
  // and drops the click that is in flight.
  const dynamicFieldSignature = useMemo(
    () =>
      JSON.stringify(
        Object.entries(viewOptions?.dynamicFields ?? {})
          .map(([displayName, field]) => [field.fieldId, displayName] as const)
          .sort((a, b) => a[0] - b[0])
      ),
    [viewOptions?.dynamicFields]
  );
  const dynamicFieldLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const [fieldId, displayName] of JSON.parse(
      dynamicFieldSignature
    ) as Array<[number, string]>) {
      labels[dynamicFieldDimensionKey(fieldId)] = displayName;
    }
    return labels;
  }, [dynamicFieldSignature]);

  // The dynamic-field ids that still exist, so a saved view grouped by a
  // deleted field degrades to the default axis instead of grouping by nothing.
  const knownDynamicAxisFieldIds = useMemo(
    () =>
      new Set(
        (JSON.parse(dynamicFieldSignature) as Array<[number, string]>).map(
          ([fieldId]) => fieldId
        )
      ),
    [dynamicFieldSignature]
  );

  const handlePick = useCallback(
    (dimension: FilterDimension) => {
      const seed = defaultPredicateFor(dimension);
      const existing = predicates.find(
        (predicate) =>
          predicate.dimension === seed.dimension &&
          predicate.operator === seed.operator
      );
      if (existing) {
        setDraft(null);
        setOpenChipKey(chipKey(existing));
        return;
      }
      if (isCommittable(seed, dimension)) {
        onAdd(seed);
        setDraft(null);
        setOpenChipKey(chipKey(seed));
      } else {
        setDraft({ predicate: seed, dimension });
        setOpenChipKey(null);
      }
    },
    [predicates, onAdd]
  );

  const handleDraftChange = useCallback(
    (next: FilterPredicate) => {
      if (!draft) return;
      if (isCommittable(next, draft.dimension)) {
        onAdd(next);
        setDraft(null);
        setOpenChipKey(chipKey(next));
      } else {
        setDraft({ ...draft, predicate: next });
      }
    },
    [draft, onAdd]
  );

  const handleChipChange = useCallback(
    (original: FilterPredicate, next: FilterPredicate) => {
      onUpdate(original.dimension, original.operator, next);
      const arity = getOperatorArity(next.operator);
      if (next.values.length === 0 && (arity?.min ?? 0) > 0) {
        // The hook removes the chip when the last value of a min-1 operator
        // is edited away — drop the stale open-editor key with it.
        setOpenChipKey(null);
      } else if (next.operator !== original.operator) {
        // Operator re-keys remount the chip; keep its editor open.
        setOpenChipKey(chipKey(next));
      }
    },
    [onUpdate]
  );

  const handleChipRemove = useCallback(
    (index: number) => {
      const removed = chips[index];
      if (!removed) return;
      const remaining = chips.filter((_, i) => i !== index);
      const focusTarget = remaining[index] ?? remaining[index - 1];
      onRemove(removed.predicate.dimension, removed.predicate.operator);
      // Focus would die with the removed chip's DOM; move it to the next
      // chip (or the Add-filter button) once React commits the removal.
      requestAnimationFrame(() => {
        if (focusTarget) {
          removeButtonRefs.current.get(chipKey(focusTarget.predicate))?.focus();
        } else {
          addButtonRef.current?.focus();
        }
      });
    },
    [chips, onRemove]
  );

  const handleClearAll = useCallback(() => {
    setDraft(null);
    setOpenChipKey(null);
    onClearAll();
  }, [onClearAll]);

  const assignedToDimension = registry.get("assignedTo");
  const assignedToMePredicate = useMemo(
    () =>
      predicates.find(
        (predicate) =>
          predicate.dimension === "assignedTo" && predicate.operator === "in"
      ),
    [predicates]
  );
  const assignedToMeActive =
    !!meId && !!assignedToMePredicate?.values.includes(meId);

  const handleQuickAssignedMe = useCallback(() => {
    if (!meId) return;
    if (!assignedToMePredicate) {
      onAdd({ dimension: "assignedTo", operator: "in", values: [meId] });
      return;
    }
    const values = assignedToMePredicate.values.includes(meId)
      ? assignedToMePredicate.values.filter((value) => value !== meId)
      : [...assignedToMePredicate.values, meId];
    onUpdate("assignedTo", "in", { ...assignedToMePredicate, values });
  }, [meId, assignedToMePredicate, onAdd, onUpdate]);

  const renderChip = (entry: ChipEntry, index: number | null) => {
    const key = chipKey(entry.predicate);
    const isDraft = index === null;
    return (
      <FilterChip
        key={isDraft ? `draft-${key}` : key}
        dimension={entry.dimension}
        predicate={entry.predicate}
        label={getDimensionLabel(entry.dimension, t, dynamicFieldLabels)}
        icon={getDimensionIcon(entry.dimension)}
        options={getDimensionValueOptions(entry.dimension, viewOptions, t)}
        open={isDraft ? true : openChipKey === key}
        onOpenChange={(open) => {
          if (isDraft) {
            if (!open) setDraft(null);
            return;
          }
          if (open) {
            setOpenChipKey(key);
          } else if (openChipKey === key) {
            setOpenChipKey(null);
          }
        }}
        onChange={(next) =>
          isDraft
            ? handleDraftChange(next)
            : handleChipChange(entry.predicate, next)
        }
        // eslint-disable-next-line react-hooks/refs
        onRemove={() => (isDraft ? setDraft(null) : handleChipRemove(index))}
        countsMuted={countsMuted}
        /* eslint-disable react-hooks/refs */
        removeButtonRef={(element) => {
          if (isDraft) return;
          if (element) {
            removeButtonRefs.current.set(key, element);
          } else {
            removeButtonRefs.current.delete(key);
          }
        }}
        /* eslint-enable react-hooks/refs */
      />
    );
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 min-w-0"
      data-testid="filter-bar"
    >
      <div
        role="group"
        aria-label={
          predicates.length > 0
            ? t("repository.filterBar.activeCount", {
                count: predicates.length,
              })
            : t("repository.filterBar.noFilters")
        }
        className="flex flex-wrap items-center gap-1.5 min-w-0"
      >
        {chips.map((entry, index) => renderChip(entry, index))}
        {draft && renderChip(draft, null)}
        {isRunMode && assignedToDimension && meId && (
          <Button
            variant={assignedToMeActive ? "secondary" : "ghost"}
            size="sm"
            className="h-6 text-xs"
            aria-pressed={assignedToMeActive}
            onClick={handleQuickAssignedMe}
            data-testid="filter-quick-assigned-me"
          >
            {t("repository.filterBar.assignedToMe")}
          </Button>
        )}
        <AddFilterButton
          registry={registry}
          dynamicFieldLabels={dynamicFieldLabels}
          onPick={handlePick}
          triggerRef={addButtonRef}
          limitReached={isFilterPredicateLimitReached(predicates.length)}
        />
        {predicates.length >= 2 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={handleClearAll}
            data-testid="filter-bar-clear"
          >
            {t("common.actions.clearAll")}
          </Button>
        )}
      </div>
      {savedViews && (
        <SavedViewsMenu
          projectId={savedViews.projectId}
          registry={registry}
          predicates={predicates}
          axis={savedViews.axis}
          onApply={savedViews.onApply}
          knownDynamicAxisFieldIds={knownDynamicAxisFieldIds}
        />
      )}
      {searchTruncated && (
        <span
          className="text-xs text-muted-foreground italic"
          data-testid="filter-bar-search-truncated"
        >
          {t("repository.filterBar.searchTruncated", { count: searchWindow })}
        </span>
      )}
      {/* The two caps are reported separately: a trimmed chip list and a
          trimmed value list are different losses with different limits, and
          both can happen to the same link. */}
      {truncation && truncation.predicatesDropped > 0 && (
        <span
          className="text-xs text-muted-foreground italic"
          data-testid="filter-bar-truncated"
        >
          {t("repository.filterBar.filtersTruncated", {
            count: MAX_FILTER_PREDICATES,
          })}
        </span>
      )}
      {truncation && truncation.valuesTruncated.length > 0 && (
        <span
          className="text-xs text-muted-foreground italic"
          data-testid="filter-bar-values-truncated"
        >
          {t("repository.filterBar.valuesTruncated", {
            count: MAX_VALUES_PER_PREDICATE,
          })}
        </span>
      )}
    </div>
  );
}
