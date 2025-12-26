import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandGroup,
  CommandEmpty,
  CommandList,
} from "@/components/ui/command";
import { useTranslations } from "next-intl";
import { cn, type ClassValue } from "~/utils";
import { UserX, Check } from "lucide-react";

// Minimal spinner (replace with your Spinner if you have one)
function Spinner() {
  return (
    <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-primary rounded-full" />
  );
}

interface AsyncComboboxProps<T> {
  value: T | null;
  onValueChange: (value: T | null) => void;
  fetchOptions: (
    query: string,
    page: number,
    pageSize: number
  ) => Promise<{ results: T[]; total: number } | T[]>;
  renderOption: (option: T) => React.ReactNode;
  getOptionValue: (option: T) => string | number;
  placeholder?: string;
  triggerLabel?: React.ReactNode;
  disabled?: boolean;
  className?: ClassValue;
  dropdownClassName?: ClassValue;
  pageSize?: number;
  showTotal?: boolean;
  showUnassigned?: boolean;
  unassignedLabel?: string;
  renderTrigger?: (args: {
    value: T | null;
    open: boolean;
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
  disabled = false,
  className,
  dropdownClassName,
  pageSize = 10,
  showTotal = false,
  showUnassigned = false,
  unassignedLabel,
  renderTrigger,
}: AsyncComboboxProps<T>) {
  const tCommon = useTranslations("common");
  const tRepository = useTranslations("repository.columns");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number>(200);
  const [page, setPage] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

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

  // Debounce search
  useEffect(() => {
    if (!open) return;
    let ignore = false;
    setLoading(true);
    fetchOptions(search, page, pageSize)
      .then((result) => {
        if (ignore) return;
        if (Array.isArray(result)) {
          setOptions(result);
          setTotal(null);
        } else if (
          result &&
          typeof result === "object" &&
          "results" in result &&
          "total" in result
        ) {
          setOptions(result.results);
          setTotal(result.total);
        } else {
          setOptions([]);
          setTotal(null);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [search, page, pageSize, open, fetchOptions]);

  // Fetch initial options when opened
  useEffect(() => {
    if (open && !touched) {
      setLoading(true);
      fetchOptions("", page, pageSize)
        .then((result) => {
          if (Array.isArray(result)) {
            setOptions(result);
            setTotal(null);
          } else if (
            result &&
            typeof result === "object" &&
            "results" in result &&
            "total" in result
          ) {
            setOptions(result.results);
            setTotal(result.total);
          } else {
            setOptions([]);
            setTotal(null);
          }
        })
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset page when search changes
  useEffect(() => {
    setPage(0);
  }, [search]);

  const fallbackPlaceholder = placeholder ?? "";
  const resolvedTriggerLabel =
    typeof triggerLabel === "undefined" ? fallbackPlaceholder : triggerLabel;

  const defaultContent = value ? (
    renderOption(value)
  ) : showUnassigned ? (
    <div className="flex items-center text-start">
      <UserX className="mr-2 h-4 w-4" />
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
          <span className="text-muted-foreground text-start">
            {fallbackPlaceholder}
          </span>
        );
      }

      if (React.isValidElement(resolvedTriggerLabel)) {
        return resolvedTriggerLabel;
      }

      return (
        <span className="text-muted-foreground text-start">
          {resolvedTriggerLabel as React.ReactNode}
        </span>
      );
    })()
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {(() => {
          if (renderTrigger) {
            const customTrigger = renderTrigger({
              value,
              open,
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
              className={cn("justify-start text-left", className)}
              disabled={disabled}
            >
              {defaultContent}
            </Button>
          );
        })()}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(dropdownClassName || "p-0 min-w-[400px] max-w-[800px]")}
        style={{ width: Math.max(width, 400) }}
      >
        <Command className="w-full" shouldFilter={false}>
          <CommandInput
            placeholder={fallbackPlaceholder}
            value={search}
            onValueChange={setSearch}
            autoFocus
          />
          <div className="relative">
            {loading && (
              <div className="absolute inset-0 flex justify-center items-center bg-muted/60 z-10">
                <Spinner />
              </div>
            )}
            <CommandList className="max-h-[300px]">
              <CommandEmpty>{tCommon("labels.noResults")}</CommandEmpty>
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
                      <UserX className="mr-2 h-4 w-4" />
                      <span>
                        {unassignedLabel || tCommon("labels.unassigned")}
                      </span>
                      {!value && (
                        <Check className="ml-auto h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CommandItem>
                )}
                {options.map((option) => (
                  <CommandItem
                    key={getOptionValue(option)}
                    value={String(getOptionValue(option))}
                    onSelect={() => {
                      onValueChange(option);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-center w-full">
                      {renderOption(option)}
                      {value &&
                        getOptionValue(option) === getOptionValue(value) && (
                          <Check className="ml-auto h-4 w-4 text-muted-foreground" />
                        )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="flex items-center justify-between gap-2 border-t px-2 py-1 bg-muted">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPage((p) => Math.max(0, p - 1));
                }}
                disabled={page === 0 || loading}
              >
                {tCommon("actions.previous")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {showTotal && total != null
                  ? `Showing ${page * pageSize + 1}–${page * pageSize + options.length} of ${total}`
                  : `Page ${page + 1}`}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPage((p) => p + 1);
                }}
                disabled={
                  loading ||
                  (total != null
                    ? (page + 1) * pageSize >= total
                    : options.length < pageSize)
                }
              >
                {tCommon("actions.next")}
              </Button>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
