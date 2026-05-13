"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  IterationStatusPip,
  type IterationStatusGlyph,
} from "./IterationStatusPip";

interface LegendEntry {
  glyph: IterationStatusGlyph;
  labelKey:
    | "iterationStatusNotStarted"
    | "iterationStatusActive"
    | "iterationStatusPassed"
    | "iterationStatusFailed"
    | "iterationStatusSkipped"
    | "iterationStatusBlocked";
}

const LEGEND: ReadonlyArray<LegendEntry> = [
  { glyph: "notStarted", labelKey: "iterationStatusNotStarted" },
  { glyph: "active", labelKey: "iterationStatusActive" },
  { glyph: "passed", labelKey: "iterationStatusPassed" },
  { glyph: "failed", labelKey: "iterationStatusFailed" },
  { glyph: "skipped", labelKey: "iterationStatusSkipped" },
  { glyph: "blocked", labelKey: "iterationStatusBlocked" },
];

export function IterationStatusLegendPopover() {
  const t = useTranslations("parameters");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          data-testid="iteration-status-legend-trigger"
          aria-label={t("iterationStatusLegendAria")}
        >
          <Info className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-3"
        data-testid="iteration-status-legend"
      >
        <ul className="flex flex-col gap-2">
          {LEGEND.map((entry) => (
            <li
              key={entry.glyph}
              className="flex items-center gap-2 text-xs"
              data-testid={`iteration-status-legend-${entry.glyph}`}
            >
              <IterationStatusPip glyph={entry.glyph} />
              <span>{t(entry.labelKey)}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default IterationStatusLegendPopover;
