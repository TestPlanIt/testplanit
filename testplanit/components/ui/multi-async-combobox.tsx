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
import { Check, X, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function Spinner() {
  return (
    <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-primary rounded-full" />
  );
}

interface MultiAsyncComboboxProps<T> {
  value: T[];
  onValueChange: (value: T[]) => void;
  fetchOptions: (
    query: string,
    page: number,
    pageSize: number
  ) => Promise<{ results: T[]; total: number } | T[]>;
  renderOption: (option: T) => React.ReactNode;
  renderSelectedOption?: (option: T) => React.ReactNode;
  getOptionValue: (option: T) => string | number;
  getOptionLabel: (option: T) => string;
  placeholder?: string;
  disabled?: boolean;
  className?: ClassValue;
  dropdownClassName?: ClassValue;
  pageSize?: number;
  showTotal?: boolean;
  hideSelected?: boolean;
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
  disabled = false,
  className,
  dropdownClassName,
  pageSize = 10,
  showTotal = false,
  hideSelected = false,
}: MultiAsyncComboboxProps<T>) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number>(200);
  const [page, setPage] = useState(0);
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

  const isSelected = (option: T) => {
    return value.some((v) => getOptionValue(v) === getOptionValue(option));
  };

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

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          setSearch("");
          setPage(0);
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
          className={cn(
            "w-full justify-between text-left font-normal min-h-10 h-auto",
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
                  className="mr-1 shrink-0"
                >
                  {renderSelectedOption
                    ? renderSelectedOption(v)
                    : getOptionLabel(v)}
                  <span
                    title={getOptionLabel(v)}
                    role="button"
                    tabIndex={0}
                    className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer"
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
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </span>
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(dropdownClassName || "p-0 min-w-[400px] max-w-[800px]")}
        style={{ width: Math.max(width, 400) }}
      >
        <Command className="w-full" shouldFilter={false}>
          <CommandInput
            placeholder={placeholder || tCommon("search")}
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
                {(() => {
                  const visibleOptions = hideSelected
                    ? options.filter((option) => !isSelected(option))
                    : options;
                  const visibleCount = visibleOptions.length;

                  return (
                    <>
                      {visibleCount > 0 && (
                        <CommandItem
                          value="__select_all__"
                          onSelect={async () => {
                            // Fetch all matching items (use large page size to get all)
                            const allItemsResult = await fetchOptions(
                              search,
                              0,
                              10000
                            );
                            let allItems: T[] = [];
                            if (Array.isArray(allItemsResult)) {
                              allItems = allItemsResult;
                            } else if (
                              allItemsResult &&
                              "results" in allItemsResult
                            ) {
                              allItems = allItemsResult.results;
                            }

                            // Filter out already selected when hideSelected is true
                            const itemsToAdd = hideSelected
                              ? allItems.filter(
                                  (option) =>
                                    !value.some(
                                      (v) =>
                                        getOptionValue(v) ===
                                        getOptionValue(option)
                                    )
                                )
                              : allItems;

                            const newSelections = [...value];
                            itemsToAdd.forEach((option) => {
                              if (
                                !value.some(
                                  (v) =>
                                    getOptionValue(v) === getOptionValue(option)
                                )
                              ) {
                                newSelections.push(option);
                              }
                            });
                            onValueChange(newSelections);
                          }}
                          className="border-b mb-1"
                        >
                          <div className="flex items-center w-full text-primary font-medium">
                            {tCommon("actions.selectAll")} {"("}
                            {visibleCount}
                            {")"}
                          </div>
                        </CommandItem>
                      )}
                      {visibleOptions.map((option) => (
                        <CommandItem
                          key={getOptionValue(option)}
                          value={String(getOptionValue(option))}
                          onSelect={() => toggleOption(option)}
                        >
                          <div className="flex items-center w-full">
                            {renderOption(option)}
                            {!hideSelected && isSelected(option) && (
                              <Check className="ml-auto h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </>
                  );
                })()}
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
                {total != null
                  ? (() => {
                      const visibleOnPage = hideSelected
                        ? options.filter((option) => !isSelected(option)).length
                        : options.length;
                      const totalPages = Math.ceil(total / pageSize);
                      return visibleOnPage > 0
                        ? `${page * pageSize + 1}–${page * pageSize + visibleOnPage} of ${total}`
                        : `Page ${page + 1} of ${totalPages}`;
                    })()
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
