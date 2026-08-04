"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type Ref } from "react";
import type {
  FilterDimension,
  FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";
import { MAX_FILTER_PREDICATES } from "~/lib/schemas/repositoryFilterPredicates";
import { getDimensionIcon, getDimensionLabel } from "./dimensionPresentation";

export interface AddFilterButtonProps {
  /** The active mode's registry — run dimensions only appear in run mode. */
  registry: FilterDimensionRegistry;
  /** Dynamic-field displayNames keyed by dimension key (e.g. `field_12`). */
  dynamicFieldLabels?: Readonly<Record<string, string>>;
  onPick: (dimension: FilterDimension) => void;
  /** Lets the bar return focus here after the last chip is removed. */
  triggerRef?: Ref<HTMLButtonElement>;
  /**
   * At MAX_FILTER_PREDICATES the trigger is disabled and explains why — a
   * 51st chip would be truncated away at parse.
   */
  limitReached?: boolean;
}

export function AddFilterButton({
  registry,
  dynamicFieldLabels,
  onPick,
  triggerRef,
  limitReached = false,
}: AddFilterButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  const dimensions = useMemo(
    () =>
      Array.from(registry.values()).map((dimension) => ({
        dimension,
        label: getDimensionLabel(dimension, t, dynamicFieldLabels),
        icon: getDimensionIcon(dimension),
      })),
    [registry, t, dynamicFieldLabels]
  );

  const trigger = (
    <Button
      ref={triggerRef}
      variant="ghost"
      size="sm"
      className="h-6 text-xs"
      disabled={limitReached}
      data-testid="filter-bar-add"
    >
      <Plus className="h-3.5 w-3.5" />
      {t("repository.filterBar.addFilter")}
    </Button>
  );

  if (limitReached) {
    return (
      <Tooltip>
        {/* A disabled button emits no pointer events; the span carries them. */}
        <TooltipTrigger asChild>
          <span tabIndex={0} data-testid="filter-bar-add-limit">
            {trigger}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t("repository.filterBar.filterLimitReached", {
            count: MAX_FILTER_PREDICATES,
          })}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput
            placeholder={t("common.search")}
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandEmpty>{t("repository.filterBar.noMatches")}</CommandEmpty>
            <CommandGroup>
              {dimensions.map(({ dimension, label, icon: Icon }) => (
                <CommandItem
                  key={dimension.key}
                  value={`${label} ${dimension.key}`}
                  onSelect={() => {
                    setOpen(false);
                    onPick(dimension);
                  }}
                  data-testid={`filter-dimension-option-${dimension.key}`}
                  className="cursor-pointer"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
