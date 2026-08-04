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
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { cn } from "~/utils";
import { AddFilterButton } from "./AddFilterButton";
import { chipKey, defaultPredicateFor, isCommittable } from "./chipHelpers";
import { getDimensionIcon, getDimensionLabel } from "./dimensionPresentation";
import { FilterChip } from "./FilterChip";
import {
  getDimensionValueOptions,
  type FilterBarViewOptions,
} from "./valueOptions";

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
  /** From the TABLE query's useCount (filter/folder/search-aware) — NOT view-options. */
  totalCount: number;
  isRunMode: boolean;
  /**
   * Interim rule (spec §13): while ES search bypasses predicates, the chips
   * row is muted and a "filters are paused" notice shows. Removed with the
   * Phase-4 bypass deletion.
   */
  searchPaused?: boolean;
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
  totalCount,
  isRunMode,
  searchPaused = false,
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

  const dynamicFieldLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const [displayName, field] of Object.entries(
      viewOptions?.dynamicFields ?? {}
    )) {
      labels[dynamicFieldDimensionKey(field.fieldId)] = displayName;
    }
    return labels;
  }, [viewOptions?.dynamicFields]);

  // Counts in the chip editors come from the filter-blind view-options route
  // until Phase 3; mute them whenever any predicate is active (spec §13).
  const countsMuted = predicates.length > 0;

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
        aria-disabled={searchPaused || undefined}
        className={cn(
          "flex flex-wrap items-center gap-1.5 min-w-0",
          searchPaused && "opacity-50 pointer-events-none"
        )}
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
      {searchPaused && (
        <span
          className="text-xs text-muted-foreground italic"
          data-testid="filter-bar-paused"
        >
          {t("repository.filterBar.pausedDuringSearch")}
        </span>
      )}
      <span
        aria-live="polite"
        className="text-xs text-muted-foreground whitespace-nowrap"
        data-testid="filter-bar-results"
      >
        {t("repository.filterBar.resultsCount", { count: totalCount })}
      </span>
    </div>
  );
}
