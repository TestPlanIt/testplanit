"use client";

import { FilterToggleChip } from "@/components/FilterToggleChip";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { Bot, PlayCircle, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { EMPTY_RUN_FILTERS, type RunFilters } from "./runFilters";

export interface RunFilterChipsProps {
  filters: RunFilters;
  onChange: (next: RunFilters) => void;
}

/**
 * Toggle-chip filter bar above the Active/Completed tabs. Chip anatomy
 * follows the repository filter bar (Badge-styled chip, icon + label, ghost
 * Clear all); the state is far simpler here — three booleans, no predicates —
 * so this stays a local component rather than reaching for that machinery.
 */
export function RunFilterChips({ filters, onChange }: RunFilterChipsProps) {
  const t = useTranslations("runs");
  const tCommon = useTranslations("common");

  const anyChipOn = filters.manual || filters.automated || filters.mine;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <div
        role="group"
        aria-label={t("runFilters.label")}
        className="flex flex-wrap items-center gap-1.5"
      >
        <FilterToggleChip
          active={filters.manual}
          label={tCommon("fields.manual")}
          icon={PlayCircle}
          onToggle={() => onChange({ ...filters, manual: !filters.manual })}
          testId="run-filter-chip-manual"
        />
        <FilterToggleChip
          active={filters.automated}
          label={tCommon("fields.automated")}
          icon={Bot}
          onToggle={() =>
            onChange({ ...filters, automated: !filters.automated })
          }
          testId="run-filter-chip-automated"
        />
        <FilterToggleChip
          active={filters.mine}
          label={t("runFilters.mine")}
          icon={UserCheck}
          onToggle={() => onChange({ ...filters, mine: !filters.mine })}
          testId="run-filter-chip-mine"
        />
      </div>
      <HelpPopover helpKey="projectRunsFilters" />
      {/* Outside the chip group, and last: Clear All unmounts the moment it is
          pressed, so anything sharing a wrap flow with it gets re-laid-out
          mid-click. Trailing it keeps the chips' positions fixed. */}
      {anyChipOn && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => onChange(EMPTY_RUN_FILTERS)}
          data-testid="run-filter-clear"
        >
          {tCommon("actions.clearAll")}
        </Button>
      )}
    </div>
  );
}
