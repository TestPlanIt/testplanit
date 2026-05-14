"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useFindManyStatus } from "~/lib/hooks";

import {
  glyphFromStatus,
  IterationStatusPip,
  type IterationStatusGlyph,
} from "./IterationStatusPip";

interface StatusLegendEntry {
  id: number;
  name: string;
  color?: string;
  glyph: IterationStatusGlyph;
}

export interface IterationStatusLegendPopoverProps {
  projectId: number;
}

export function IterationStatusLegendPopover({
  projectId,
}: IterationStatusLegendPopoverProps) {
  const t = useTranslations("parameters");

  // Real Test-Run-scope statuses for this project. Names + colors are
  // admin-configured per Workflow; the legend renders whatever is configured.
  const { data: statuses } = useFindManyStatus({
    where: {
      AND: [
        { isEnabled: true },
        { isDeleted: false },
        { projects: { some: { projectId: Number(projectId) } } },
        { scope: { some: { scope: { name: "Test Run" } } } },
      ],
    },
    include: { color: { select: { value: true } } },
    orderBy: { order: "asc" },
  });

  const entries: StatusLegendEntry[] = (statuses ?? []).map((status) => ({
    id: status.id,
    name: status.name,
    color: status.color?.value,
    glyph: glyphFromStatus(status, false),
  }));

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
        className="w-64 p-3"
        data-testid="iteration-status-legend"
      >
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={`status-${entry.id}`}
              className="flex items-center gap-2 text-xs"
              data-testid={`iteration-status-legend-status-${entry.id}`}
            >
              <IterationStatusPip
                glyph={entry.glyph}
                statusColor={entry.color}
              />
              <span>{entry.name}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export default IterationStatusLegendPopover;
