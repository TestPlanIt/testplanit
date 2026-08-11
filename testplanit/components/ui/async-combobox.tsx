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
import { Check, Loader2, UserX } from "lucide-react";
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

interface AsyncComboboxProps<T> {
  value: T | null;
  onValueChange: (value: T | null) => void;
  fetchOptions: AsyncOptionsFetcher<T>;
  /** `query` is the search the listed options were fetched for — empty
   *  wherever an option is rendered outside the list, such as on the trigger. */
  renderOption: (option: T, query: string) => React.ReactNode;
  getOptionValue: (option: T) => string | number;
  placeholder?: string;
  triggerLabel?: React.ReactNode;
  /**
   * Accessible name for the trigger. The trigger is a button, so its selected
   * value does not name it — pass the field's visible label.
   */
  ariaLabel?: string;
  disabled?: boolean;
  isOptionDisabled?: (option: T) => boolean;
  className?: ClassValue;
  dropdownClassName?: ClassValue;
  pageSize?: number;
  showTotal?: boolean;
  /** Hide the loaded-count footer — for local (non-paged) option sources
   *  where fetchOptions returns the full filtered list every time. */
  showPagination?: boolean;
  /** Minimum pixel width of the dropdown (defaults to 400; narrow form
   *  fields can lower it so the dropdown hugs the trigger). */
  minDropdownWidth?: number;
  showUnassigned?: boolean;
  unassignedLabel?: string;
  unassignedIcon?: React.ReactNode;
  renderTrigger?: (args: {
    value: T | null;
    open: boolean;
    /** True while an option fetch is in flight — render a busy indicator. */
    loading: boolean;
    placeholder?: string;
    triggerLabel?: React.ReactNode;
    defaultContent: React.ReactNode;
  }) => React.ReactElement;
}

export function AsyncCombobox<T>({
  value,
  onValueChange,
  fetchOptions,
  renderOption,
  getOptionValue,
  placeholder,
  triggerLabel,
  ariaLabel,
  disabled = false,
  isOptionDisabled,
  className,
  dropdownClassName,
  pageSize = 30,
  showTotal: _showTotal = false,
  showPagination = true,
  minDropdownWidth = 400,
  showUnassigned = false,
  unassignedLabel,
  unassignedIcon,
  renderTrigger,
}: AsyncComboboxProps<T>) {
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
    settled,
    loadMore,
    resetPaging,
  } = useAsyncComboboxOptions<T>({
    open,
    fetchOptions,
    getOptionValue,
    pageSize,
  });

  // Mounting thousands of CommandItems is what makes a large list slow to
  // open, so past the threshold only the visible window renders. The hook
  // also owns the load-more wiring (bottom sentinel + virtualizer-index
  // trigger behind a shared double-fire guard), which is why it runs even
  // below the threshold — with `count: 0` the virtualizer idles and the
  // sentinel alone pulls the next page.
  const shouldVirtualize = options.length > VIRTUALIZE_THRESHOLD;
  const { scrollRef, sentinelRef, virtualItems, totalSize, measureElement } =
    useVirtualizedInfiniteList({
      count: shouldVirtualize ? options.length : 0,
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

  const renderCommandItem = (option: T) => {
    const optionDisabled = isOptionDisabled?.(option) ?? false;
    return (
      <CommandItem
        key={getOptionValue(option)}
        value={String(getOptionValue(option))}
        disabled={optionDisabled}
        onSelect={() => {
          if (optionDisabled) return;
          onValueChange(option);
          setOpen(false);
        }}
      >
        <div className="flex items-center w-full [&_a]:no-underline [&_a]:text-inherit [&_a:hover]:text-inherit">
          {renderOption(option, debouncedSearch)}
          {value && getOptionValue(option) === getOptionValue(value) && (
            <Check className="ms-auto h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CommandItem>
    );
  };

  const fallbackPlaceholder = placeholder ?? "";
  const resolvedTriggerLabel =
    typeof triggerLabel === "undefined" ? fallbackPlaceholder : triggerLabel;

  const defaultContent = value ? (
    renderOption(value, "")
  ) : showUnassigned ? (
    <div className="flex items-center text-start">
      {unassignedIcon ?? <UserX className="me-2 h-4 w-4" />}
      <span>{unassignedLabel || tCommon("labels.unassigned")}</span>
    </div>
  ) : (
    (() => {
      if (
        resolvedTriggerLabel === undefined ||
        resolvedTriggerLabel === null ||
        resolvedTriggerLabel === "" ||
        resolvedTriggerLabel === false
      ) {
        return (
          <span className="text-muted-foreground group-hover:text-accent-foreground text-start transition-colors">
            {fallbackPlaceholder}
          </span>
        );
      }

      if (React.isValidElement(resolvedTriggerLabel)) {
        return resolvedTriggerLabel;
      }

      return (
        <span className="text-muted-foreground group-hover:text-accent-foreground text-start transition-colors">
          {resolvedTriggerLabel as React.ReactNode}
        </span>
      );
    })()
  );

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) resetPaging();
      }}
    >
      <PopoverTrigger asChild>
        {(() => {
          if (renderTrigger) {
            const customTrigger = renderTrigger({
              value,
              open,
              loading,
              placeholder: fallbackPlaceholder,
              triggerLabel: resolvedTriggerLabel,
              defaultContent,
            });

            if (!React.isValidElement(customTrigger)) {
              throw new Error(
                "AsyncCombobox renderTrigger must return a valid React element."
              );
            }

            const isButtonLike =
              typeof customTrigger.type === "string" &&
              (customTrigger.type === "button" ||
                customTrigger.type === "input");

            const props = customTrigger.props as Record<string, any>;

            return React.cloneElement(customTrigger, {
              ref: triggerRef,
              ...(isButtonLike
                ? {
                    type: props.type ?? "button",
                    disabled,
                  }
                : {}),
              role: props.role ?? "combobox",
              "aria-expanded": open,
              "aria-haspopup": "listbox",
              // A custom trigger is usually an icon or a value-only control
              // with no text of its own, so without this it reaches the page
              // as an unnamed combobox (WCAG 4.1.2). The default-Button path
              // below already applies ariaLabel; this path silently dropped
              // it. An aria-label set on the custom element itself wins.
              "aria-label": props["aria-label"] ?? ariaLabel,
              className: cn(className, props.className),
            } as any);
          }

          return (
            <Button
              ref={triggerRef}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={ariaLabel}
              className={cn("justify-start text-start group", className)}
              disabled={disabled}
            >
              {defaultContent}
              {loading && (
                <Spinner
                  className="ms-auto shrink-0"
                  data-testid="async-combobox-trigger-spinner"
                />
              )}
            </Button>
          );
        })()}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className={cn(
          // The popover itself never scrolls, so it has to fit the room Radix
          // reports: anything past the window edge cannot be reached at all.
          "flex max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden",
          dropdownClassName || "p-0 max-w-[800px]"
        )}
        style={{
          width: Math.max(width, minDropdownWidth),
          minWidth: minDropdownWidth,
        }}
      >
        <Command className="w-full min-h-0 flex-1" shouldFilter={false}>
          <CommandInput
            placeholder={fallbackPlaceholder}
            value={search}
            onValueChange={setSearch}
            autoFocus
            className="my-2"
          />
          <div
            className={cn(
              "relative flex min-h-0 flex-1 flex-col",
              // An empty list collapses to zero height, clipping the spinner.
              loading && !options.length && !showUnassigned && "min-h-24"
            )}
          >
            {loading && (
              <div className="absolute inset-0 flex justify-center items-center bg-muted/60 z-10">
                <Spinner />
              </div>
            )}
            {/* The search box and the footer keep their height; the list is
                what gives way once the popover hits its cap. */}
            <CommandList
              ref={scrollRef}
              className="min-h-0 flex-1 max-h-[70vh]"
            >
              {/* Only once the fetch has settled — otherwise "no results"
                  renders under the loading overlay and contradicts it. */}
              {settled && !loading && (
                <CommandEmpty>{tCommon("labels.noResults")}</CommandEmpty>
              )}
              <CommandGroup
                className={cn(loading ? "opacity-50 pointer-events-none" : "")}
              >
                {showUnassigned && (
                  <CommandItem
                    value="unassigned"
                    onSelect={() => {
                      onValueChange(null);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="flex items-center w-full">
                      {unassignedIcon ?? <UserX className="me-2 h-4 w-4" />}
                      <span>
                        {unassignedLabel || tCommon("labels.unassigned")}
                      </span>
                      {!value && (
                        <Check className="ms-auto h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CommandItem>
                )}
                {shouldVirtualize ? (
                  <div
                    className="relative w-full"
                    style={{ height: totalSize }}
                    data-testid="async-combobox-virtual-list"
                  >
                    {virtualItems.map((virtualRow) => {
                      const option = options[virtualRow.index];
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
                  options.map(renderCommandItem)
                )}
              </CommandGroup>
              {loadingMore && (
                <div
                  className="flex items-center justify-center py-2"
                  data-testid="async-combobox-loading-more"
                >
                  <Spinner />
                </div>
              )}
              {/* Load-more sentinel: scrolling it into view pulls the next
                  page. Rendered last so it sits below every row. */}
              <div ref={sentinelRef} aria-hidden="true" />
            </CommandList>
            {showPagination && total != null && (
              <div
                className="flex items-center justify-center border-t px-2 py-1 bg-muted"
                data-testid="async-combobox-count-footer"
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
