import { Badge } from "@/components/ui/badge";
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
import { Check, ChevronsUpDown, Loader2, PackagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useRef, useState } from "react";
import {
  useAsyncComboboxOptions,
  type AsyncOptionsFetcher,
} from "~/hooks/useAsyncComboboxOptions";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { cn, type ClassValue } from "~/utils";

/** Above this many options the list virtualizes. Smaller lists keep rendering
 *  in full so existing comboboxes are untouched, and cmdk keeps arrow-key
 *  navigation over every row — virtualized rows only exist while scrolled to. */
const VIRTUALIZE_THRESHOLD = 100;
const ESTIMATED_OPTION_HEIGHT = 36;

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      className={cn("h-4 w-4 animate-spin text-primary", className)}
      {...props}
    />
  );
}

interface MultiAsyncComboboxProps<T> {
  value: T[];
  onValueChange: (value: T[]) => void;
  fetchOptions: AsyncOptionsFetcher<T>;
  renderOption: (option: T) => React.ReactNode;
  renderSelectedOption?: (option: T) => React.ReactNode;
  getOptionValue: (option: T) => string | number;
  getOptionLabel: (option: T) => string;
  placeholder?: string;
  /**
   * Accessible name for the trigger. The trigger is a button, so its selected
   * values do not name it — pass the field's visible label.
   */
  ariaLabel?: string;
  disabled?: boolean;
  className?: ClassValue;
  dropdownClassName?: ClassValue;
  pageSize?: number;
  showTotal?: boolean;
  hideSelected?: boolean;
  hideSelectAll?: boolean;
}

export function MultiAsyncCombobox<T>({
  value,
  onValueChange,
  fetchOptions,
  renderOption,
  renderSelectedOption,
  getOptionValue,
  getOptionLabel,
  placeholder,
  ariaLabel,
  disabled = false,
  className,
  dropdownClassName,
  pageSize = 30,
  showTotal: _showTotal = false,
  hideSelected = false,
  hideSelectAll = false,
}: MultiAsyncComboboxProps<T>) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number>(200);

  const {
    search,
    setSearch,
    debouncedSearch,
    options,
    total,
    hasMore,
    loading,
    loadingMore,
    loadMore,
    resetPaging,
  } = useAsyncComboboxOptions<T>({
    open,
    fetchOptions,
    getOptionValue,
    pageSize,
  });

  const isSelected = (option: T) => {
    return value.some((v) => getOptionValue(v) === getOptionValue(option));
  };

  const visibleOptions = hideSelected
    ? options.filter((option) => !isSelected(option))
    : options;

  // Mounting thousands of CommandItems is what makes a large list slow to
  // open, so past the threshold only the visible window renders. The hook
  // also owns the load-more wiring (bottom sentinel + virtualizer-index
  // trigger behind a shared double-fire guard), which is why it runs even
  // below the threshold — with `count: 0` the virtualizer idles and the
  // sentinel alone pulls the next page. `loadedCount` is the RAW loaded
  // count: with hideSelected a whole page can land already-selected and the
  // rendered count stays flat, and pagination must still advance.
  const shouldVirtualize = visibleOptions.length > VIRTUALIZE_THRESHOLD;
  const { scrollRef, sentinelRef, virtualItems, totalSize, measureElement } =
    useVirtualizedInfiniteList({
      count: shouldVirtualize ? visibleOptions.length : 0,
      loadedCount: options.length,
      estimateSize: ESTIMATED_OPTION_HEIGHT,
      overscan: 12,
      hasMore,
      isLoading: loading || loadingMore,
      onLoadMore: loadMore,
      boundToViewport: false,
      resetKey: debouncedSearch,
    });

  // Update width when trigger element changes size
  useEffect(() => {
    if (!triggerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(triggerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const toggleOption = (option: T) => {
    if (isSelected(option)) {
      onValueChange(
        value.filter((v) => getOptionValue(v) !== getOptionValue(option))
      );
    } else {
      onValueChange([...value, option]);
    }
  };

  const removeOption = (option: T, e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange(
      value.filter((v) => getOptionValue(v) !== getOptionValue(option))
    );
  };

  // What "Select all" would add: everything matching the current search, not
  // just what has loaded so far.
  const selectAllCount =
    total != null
      ? hideSelected
        ? total - value.length
        : total
      : visibleOptions.length;

  const showSelectAll =
    !hideSelectAll && selectAllCount > 0 && visibleOptions.length > 0;

  const selectAll = async () => {
    // Fetch all matching items (use large page size to get all)
    const allItemsResult = await fetchOptions(search, 0, 10000);
    let allItems: T[] = [];
    if (Array.isArray(allItemsResult)) {
      allItems = allItemsResult;
    } else if (allItemsResult && "results" in allItemsResult) {
      allItems = allItemsResult.results;
    }

    const newSelections = [...value];
    allItems.forEach((option) => {
      if (!value.some((v) => getOptionValue(v) === getOptionValue(option))) {
        newSelections.push(option);
      }
    });
    onValueChange(newSelections);
  };

  const renderCommandItem = (option: T) => (
    <CommandItem
      key={getOptionValue(option)}
      value={String(getOptionValue(option))}
      onSelect={() => toggleOption(option)}
    >
      <div className="flex items-center w-full [&_a]:no-underline [&_a]:text-inherit [&_a:hover]:text-inherit">
        {renderOption(option)}
        {!hideSelected && isSelected(option) ? (
          <Check className="ms-auto h-4 w-4" />
        ) : (
          <Check className="text-transparent" />
        )}
      </div>
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          setSearch("");
          resetPaging();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn(
            "w-full justify-between text-start font-normal min-h-10 h-auto",
            !value.length && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <div className="flex flex-wrap gap-1 flex-1 max-h-[72px] overflow-y-auto py-1">
            {value.length === 0 ? (
              <span>
                {placeholder || tCommon("placeholders.selectConfigurations")}
              </span>
            ) : (
              value.map((v) => (
                <Badge
                  key={getOptionValue(v)}
                  variant="secondary"
                  className="me-1 shrink-0 min-w-[80px] max-w-[200px] overflow-hidden"
                  title={getOptionLabel(v)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {renderSelectedOption
                      ? renderSelectedOption(v)
                      : getOptionLabel(v)}
                  </span>
                  <span
                    title={getOptionLabel(v)}
                    role="button"
                    tabIndex={0}
                    className="ms-1 rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background cursor-pointer opacity-70 hover:opacity-100 hover:bg-destructive/20 flex items-center"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        removeOption(v, e as unknown as React.MouseEvent);
                      }
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => removeOption(v, e)}
                  >
                    <X className="h-3 w-3 hover:text-destructive" />
                  </span>
                </Badge>
              ))
            )}
          </div>
          {loading ? (
            <Spinner
              className="shrink-0"
              data-testid="multi-async-combobox-trigger-spinner"
            />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className={cn(
          dropdownClassName || "p-0 min-w-[400px] max-w-[800px]",
          // Keep the whole panel inside the viewport. Radix flips above the
          // trigger when there is no room below, but flipping does not shrink
          // the panel, so the list scrolls inside a flex column while the
          // search box, the Select All row, and the footer keep their height.
          "flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden"
        )}
        style={{ width: Math.max(width, 400) }}
      >
        <Command className="w-full min-h-0 flex-1" shouldFilter={false}>
          <CommandInput
            placeholder={placeholder || tCommon("search")}
            value={search}
            onValueChange={setSearch}
            autoFocus
            className="my-2"
          />
          {(showSelectAll || value.length > 0) && (
            <div className="flex items-center border-b px-2 py-1">
              {showSelectAll && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={loading}
                  data-testid="multi-async-combobox-select-all"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void selectAll();
                  }}
                >
                  <PackagePlus className="h-3 w-3 shrink-0" />
                  {tCommon("actions.selectAll")} {"("}
                  {selectAllCount}
                  {")"}
                </Button>
              )}
              {value.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  data-testid="multi-async-combobox-clear-all"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onValueChange([]);
                  }}
                >
                  <X className="h-3 w-3 shrink-0" />
                  {tCommon("actions.clearAll")} {"("}
                  {value.length}
                  {")"}
                </Button>
              )}
            </div>
          )}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {loading && (
              <div className="absolute inset-0 flex justify-center items-center bg-muted/60 z-10">
                <Spinner />
              </div>
            )}
            <CommandList
              ref={scrollRef}
              className="min-h-0 flex-1 max-h-[300px]"
            >
              <CommandEmpty>{tCommon("labels.noResults")}</CommandEmpty>
              <CommandGroup
                className={cn(loading ? "opacity-50 pointer-events-none" : "")}
              >
                {shouldVirtualize ? (
                  <div
                    className="relative w-full"
                    style={{ height: totalSize }}
                    data-testid="multi-async-combobox-virtual-list"
                  >
                    {virtualItems.map((virtualRow) => {
                      const option = visibleOptions[virtualRow.index];
                      if (!option) return null;
                      return (
                        <div
                          key={getOptionValue(option)}
                          ref={measureElement}
                          data-index={virtualRow.index}
                          className="absolute top-0 start-0 w-full"
                          style={{
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderCommandItem(option)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  visibleOptions.map(renderCommandItem)
                )}
              </CommandGroup>
              {loadingMore && (
                <div
                  className="flex items-center justify-center py-2"
                  data-testid="multi-async-combobox-loading-more"
                >
                  <Spinner />
                </div>
              )}
              {/* Load-more sentinel: scrolling it into view pulls the next
                  page. Rendered last so it sits below every row. */}
              <div ref={sentinelRef} aria-hidden="true" />
            </CommandList>
            {total != null && (
              <div
                className="flex items-center justify-center border-t px-2 py-1 bg-muted"
                data-testid="multi-async-combobox-count-footer"
              >
                <span className="text-xs text-muted-foreground">
                  {tCommon("pagination.loadedOfTotal", {
                    loaded: options.length,
                    total,
                  })}
                </span>
              </div>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
