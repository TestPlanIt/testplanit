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
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type Ref } from "react";
import type {
  FilterDimension,
  FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";
import { getDimensionIcon, getDimensionLabel } from "./dimensionPresentation";

export interface AddFilterButtonProps {
  /** The active mode's registry — run dimensions only appear in run mode. */
  registry: FilterDimensionRegistry;
  /** Dynamic-field displayNames keyed by dimension key (e.g. `field_12`). */
  dynamicFieldLabels?: Readonly<Record<string, string>>;
  onPick: (dimension: FilterDimension) => void;
  /** Lets the bar return focus here after the last chip is removed. */
  triggerRef?: Ref<HTMLButtonElement>;
}

export function AddFilterButton({
  registry,
  dynamicFieldLabels,
  onPick,
  triggerRef,
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          data-testid="filter-bar-add"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("repository.filterBar.addFilter")}
        </Button>
      </PopoverTrigger>
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
