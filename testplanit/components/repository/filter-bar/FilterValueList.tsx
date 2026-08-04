"use client";

import DynamicIcon from "@/components/DynamicIcon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";
import type { FilterValueOption } from "./valueOptions";

// Above this many options a search input appears (same threshold as the
// ViewSelector's FilterOptionList switch to a searchable list).
const SEARCHABLE_OPTION_THRESHOLD = 10;

export interface FilterValueListProps {
  options: FilterValueOption[];
  selectedValues: ReadonlyArray<string | number>;
  onToggle: (id: string | number) => void;
  renderOptionLabel?: (option: FilterValueOption) => ReactNode;
  /**
   * True while option counts don't reflect the active predicates (the
   * previous predicate set's counts are shown during a refetch) — counts
   * render muted with an explanatory tooltip.
   */
  countsMuted?: boolean;
}

/**
 * Inline searchable value list for the chip editor. Command primitives are
 * used directly (not MultiAsyncCombobox, which renders its own Popover
 * trigger and would nest a popover inside the chip editor popover).
 */
export function FilterValueList({
  options,
  selectedValues,
  onToggle,
  renderOptionLabel,
  countsMuted,
}: FilterValueListProps) {
  const t = useTranslations();

  const renderLabel = (option: FilterValueOption) =>
    renderOptionLabel ? (
      renderOptionLabel(option)
    ) : (
      <>
        {option.color ? (
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: option.color.value }}
          />
        ) : option.icon ? (
          <DynamicIcon
            name={option.icon.name as IconName}
            className="w-4 h-4 shrink-0"
            color={option.iconColor?.value}
          />
        ) : null}
        <span className="truncate">{option.name}</span>
      </>
    );

  const renderCount = (option: FilterValueOption) => {
    if (option.count === undefined) return null;
    const count = (
      <span
        className={cn(
          "text-xs text-muted-foreground shrink-0 ms-2 whitespace-nowrap",
          countsMuted && "opacity-50"
        )}
      >
        {option.count}
      </span>
    );
    if (!countsMuted) return count;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{count}</TooltipTrigger>
        <TooltipContent>
          {t("repository.filterBar.countsIgnoreFilters")}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <Command className="bg-transparent">
      {options.length > SEARCHABLE_OPTION_THRESHOLD && (
        <CommandInput
          data-testid="filter-value-search"
          placeholder={t("common.search")}
          className="h-8 text-xs"
        />
      )}
      <CommandList>
        <CommandEmpty>{t("repository.filterBar.noMatches")}</CommandEmpty>
        <CommandGroup>
          {options.map((option) => {
            const selected = selectedValues.includes(option.id);
            return (
              <CommandItem
                key={option.id}
                value={`${option.name} ${option.id}`}
                onSelect={() => onToggle(option.id)}
                data-testid={`filter-value-option-${option.id}`}
                data-checked={selected ? "true" : undefined}
                className="cursor-pointer"
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    selected ? "opacity-100" : "opacity-0"
                  )}
                />
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {renderLabel(option)}
                </div>
                {renderCount(option)}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
