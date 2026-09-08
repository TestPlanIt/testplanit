"use client";

import { FilterToggleChip } from "@/components/FilterToggleChip";
import { CircleCheck, CircleDot, List, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  CARD_STATUS_FILTERS,
  type CardFilters,
  type CardStatusFilter,
} from "./cardFilters";

const STATUS_ICONS = {
  all: List,
  active: CircleDot,
  completed: CircleCheck,
} as const;

export interface CardFilterChipsProps {
  filters: CardFilters;
  onChange: (next: CardFilters) => void;
  /** Which card this bar belongs to — picks the labels and the test ids. */
  variant: "runs" | "sessions";
}

/**
 * Filter bar for the milestone detail page's Test Runs and Sessions cards: a
 * one-of-three status radiogroup plus an independent "mine" toggle.
 *
 * Chip anatomy is shared with the runs and sessions list pages
 * (FilterToggleChip). The status chips are radios, not toggles — the set is
 * mutually exclusive, and "All" is what clearing looks like, so there is no
 * separate Clear All.
 */
export function CardFilterChips({
  filters,
  onChange,
  variant,
}: CardFilterChipsProps) {
  const t = useTranslations();
  const tCommon = useTranslations("common");

  const statusLabels: Record<CardStatusFilter, string> = {
    all: tCommon("filters.all"),
    active: tCommon("fields.isActive"),
    completed: tCommon("fields.completed"),
  };

  const groupLabel =
    variant === "runs"
      ? t("milestones.cardFilters.labelRuns")
      : t("milestones.cardFilters.labelSessions");

  const mineLabel =
    variant === "runs"
      ? t("runs.runFilters.mine")
      : t("sessions.sessionFilters.mine");

  const testIdBase =
    variant === "runs" ? "milestone-runs" : "milestone-sessions";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <div
        role="radiogroup"
        aria-label={groupLabel}
        className="flex flex-wrap items-center gap-1.5"
        data-testid={`${testIdBase}-filter`}
      >
        {CARD_STATUS_FILTERS.map((status) => (
          <FilterToggleChip
            key={status}
            mode="radio"
            active={filters.status === status}
            label={statusLabels[status]}
            icon={STATUS_ICONS[status]}
            onToggle={() => onChange({ ...filters, status })}
            testId={`${testIdBase}-filter-${status}`}
          />
        ))}
      </div>
      <FilterToggleChip
        active={filters.mine}
        label={mineLabel}
        icon={UserCheck}
        onToggle={() => onChange({ ...filters, mine: !filters.mine })}
        testId={`${testIdBase}-filter-mine`}
      />
    </div>
  );
}
