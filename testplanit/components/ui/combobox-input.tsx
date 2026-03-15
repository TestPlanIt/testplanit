"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { cn } from "~/utils";

interface ComboboxInputProps {
  options: string[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function ComboboxInput({
  options,
  value,
  onValueChange,
  placeholder,
  emptyMessage,
  className,
  disabled = false,
  "data-testid": testId,
}: ComboboxInputProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [width, setWidth] = React.useState<number>(0);

  React.useEffect(() => {
    if (open) {
      setInputValue("");
    } else {
      setInputValue(value);
    }
  }, [open, value]);

  React.useEffect(() => {
    if (!triggerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(triggerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const filtered = React.useMemo(() => {
    if (!inputValue) return options;
    const lower = inputValue.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(lower));
  }, [options, inputValue]);

  const handleInputChange = (val: string) => {
    setInputValue(val);
    onValueChange(val);
  };

  const handleSelect = (selected: string) => {
    setInputValue(selected);
    onValueChange(selected);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-controls={testId ? `${testId}-listbox` : undefined}
          aria-expanded={open}
          disabled={disabled}
          data-testid={testId}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="p-0"
        style={{ width: width > 0 ? width : undefined }}
      >
        <Command shouldFilter={false}>
          <input
            className="flex h-9 w-full border-b bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
            placeholder={placeholder}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList>
            {filtered.length === 0 && inputValue && (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => handleSelect(opt)}
                >
                  {opt}
                  {value === opt && (
                    <Check className="ml-auto h-4 w-4 text-muted-foreground" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
