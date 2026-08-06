"use client";

import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { Bot, PlayCircle, UserCheck, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";
import { EMPTY_RUN_FILTERS, type RunFilters } from "./runFilters";

interface RunFilterChipProps {
  active: boolean;
  label: string;
  icon: LucideIcon;
  onToggle: () => void;
  testId: string;
}

function RunFilterChip({
  active,
  label,
  icon: Icon,
  onToggle,
  testId,
}: RunFilterChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        badgeVariants({ variant: active ? "default" : "outline" }),
        // transition-none overrides the Badge base's transition-colors. A
        // filled chip has light text; cross-fading to the muted outline state
        // passes through pale-text-on-pale-background, which reads as the
        // label blinking out and back. Toggles snap.
        "gap-1.5 py-1 cursor-pointer transition-none",
        // Dashed + muted while off, so an inactive chip reads as an offer
        // rather than as an applied filter.
        !active &&
          "border-dashed text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export interface RunFilterChipsProps {
  filters: RunFilters;
  onChange: (next: RunFilters) => void;
}

/**
 * Toggle-chip filter bar above the Active/Completed tabs. Chip anatomy
 * follows the repository filter bar (Badge-styled chip, icon + label, ghost
 * Clear all); the state is far simpler here — three booleans, no predicates —
 * so this stays a local component rather than reaching for that machinery.
 *
 * No per-chip X: there the chip body opens an editor so removal needs its own
 * control, whereas here the body IS the toggle. Dropping it also keeps a
 * chip's width identical in both states, so toggling never reflows the row.
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
        <RunFilterChip
          active={filters.manual}
          label={tCommon("fields.manual")}
          icon={PlayCircle}
          onToggle={() => onChange({ ...filters, manual: !filters.manual })}
          testId="run-filter-chip-manual"
        />
        <RunFilterChip
          active={filters.automated}
          label={tCommon("fields.automated")}
          icon={Bot}
          onToggle={() =>
            onChange({ ...filters, automated: !filters.automated })
          }
          testId="run-filter-chip-automated"
        />
        <RunFilterChip
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
