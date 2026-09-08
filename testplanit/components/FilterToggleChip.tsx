"use client";

import { badgeVariants } from "@/components/ui/badge";
import { type LucideIcon } from "lucide-react";
import { cn } from "~/utils";

export interface FilterToggleChipProps {
  active: boolean;
  label: string;
  icon: LucideIcon;
  onToggle: () => void;
  testId: string;
  /**
   * `toggle` (default) for independent on/off chips — reports `aria-pressed`.
   * `radio` for chips that belong to a mutually exclusive set, which the
   * parent wraps in `role="radiogroup"`; `aria-pressed` on a one-of-N set
   * describes the wrong relationship to a screen reader.
   */
  mode?: "toggle" | "radio";
}

/**
 * The Badge-styled filter chip shared by the run, session, and milestone-card
 * filter bars. The body IS the control: clicking it toggles (or selects), so
 * there is no per-chip X and a chip's width is identical in both states, which
 * keeps a row from reflowing as it is used.
 */
export function FilterToggleChip({
  active,
  label,
  icon: Icon,
  onToggle,
  testId,
  mode = "toggle",
}: FilterToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role={mode === "radio" ? "radio" : undefined}
      aria-checked={mode === "radio" ? active : undefined}
      aria-pressed={mode === "toggle" ? active : undefined}
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
