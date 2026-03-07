"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "~/utils";
import type { AutoTagSuggestionEntity, AutoTagSelection } from "./types";

interface EntityListProps {
  entities: AutoTagSuggestionEntity[];
  selectedEntityId: number | null;
  onSelectEntity: (entityId: number) => void;
  selections: AutoTagSelection;
}

export function EntityList({
  entities,
  selectedEntityId,
  onSelectEntity,
  selections,
}: EntityListProps) {
  const [search, setSearch] = useState("");

  const filteredEntities = useMemo(() => {
    if (!search.trim()) return entities;
    const query = search.trim().toLowerCase();
    return entities.filter((e) => e.entityName.toLowerCase().includes(query));
  }, [entities, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Filter entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5">
          {filteredEntities.map((entity) => {
            const acceptedCount = selections.get(entity.entityId)?.size ?? 0;
            const hasSuggestions = entity.tags.length > 0;

            return (
              <button
                key={entity.entityId}
                type="button"
                onClick={() => onSelectEntity(entity.entityId)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50",
                  selectedEntityId === entity.entityId && "bg-accent",
                  !hasSuggestions && "opacity-50",
                )}
              >
                <span className="truncate pr-2">{entity.entityName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {acceptedCount > 0
                    ? `${acceptedCount} tag${acceptedCount !== 1 ? "s" : ""}`
                    : hasSuggestions
                      ? "none"
                      : "--"}
                </span>
              </button>
            );
          })}
          {filteredEntities.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              No entities match your search.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
