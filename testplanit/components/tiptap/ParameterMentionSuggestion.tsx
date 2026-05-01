"use client";

import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { Badge } from "~/components/ui/badge";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import { cn } from "~/utils";

// next-intl strict namespace typing prevents passing "parameters" until messages
// declare that namespace. Cast through never to bypass the union-narrowing.
const useParameterTranslations = useTranslations as (
  ns: string
) => (key: string, params?: Record<string, unknown>) => string;

export interface ParameterMentionSuggestionProps {
  items: ParameterChipMeta[];
  command: (item: ParameterChipMeta) => void;
}

export interface ParameterMentionSuggestionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const ParameterMentionSuggestion = forwardRef<
  ParameterMentionSuggestionRef,
  ParameterMentionSuggestionProps
>(({ items, command }, ref) => {
  const t = useParameterTranslations("parameters");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  const selectItem = (index: number) => {
    const item = items[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div
        className="bg-popover border rounded-md shadow-md p-1 max-h-64 overflow-auto min-w-48"
        data-testid="parameter-mention-suggestion"
      >
        <div
          className="px-2 py-1.5 text-sm text-muted-foreground"
          data-testid="parameter-autocomplete-empty"
        >
          {t("autocompleteEmpty")}
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-popover border rounded-md shadow-md p-1 max-h-64 overflow-auto min-w-48"
      data-testid="parameter-mention-suggestion"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            "w-full text-left px-2 py-1.5 text-sm rounded-sm flex items-center gap-2",
            index === selectedIndex && "bg-accent text-accent-foreground"
          )}
          onClick={() => command(item)}
          onMouseEnter={() => setSelectedIndex(index)}
          data-testid={`parameter-mention-item-${item.name}`}
        >
          <span className="font-mono">{item.name}</span>
          <Badge variant="secondary">{item.type}</Badge>
          {item.defaultValue !== null && (
            <span className="text-xs text-muted-foreground">
              = {item.defaultValue}
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

ParameterMentionSuggestion.displayName = "ParameterMentionSuggestion";
