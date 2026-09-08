"use client";

import { FilterToggleChip } from "@/components/FilterToggleChip";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  EMPTY_SESSION_FILTERS,
  isAnySessionFilterActive,
  type SessionFilters,
} from "./sessionFilters";

export interface SessionFilterChipsProps {
  filters: SessionFilters;
  onChange: (next: SessionFilters) => void;
}

/**
 * Toggle-chip filter bar above the Active/Completed tabs, matching the runs
 * page's bar (see RunFilterChips) so the two list pages read the same.
 */
export function SessionFilterChips({
  filters,
  onChange,
}: SessionFilterChipsProps) {
  const t = useTranslations("sessions");
  const tCommon = useTranslations("common");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <div
        role="group"
        aria-label={t("sessionFilters.label")}
        className="flex flex-wrap items-center gap-1.5"
      >
        <FilterToggleChip
          active={filters.mine}
          label={t("sessionFilters.mine")}
          icon={UserCheck}
          onToggle={() => onChange({ ...filters, mine: !filters.mine })}
          testId="session-filter-chip-mine"
        />
      </div>
      <HelpPopover helpKey="projectSessionsFilters" />
      {/* Outside the chip group, and last: Clear All unmounts the moment it is
          pressed, so anything sharing a wrap flow with it gets re-laid-out
          mid-click. Trailing it keeps the chips' positions fixed. */}
      {isAnySessionFilterActive(filters) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => onChange(EMPTY_SESSION_FILTERS)}
          data-testid="session-filter-clear"
        >
          {tCommon("actions.clearAll")}
        </Button>
      )}
    </div>
  );
}
