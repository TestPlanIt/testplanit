"use client";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Compass, ListTree, PlayCircle, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";
import { cn } from "~/utils";
import type { AutoTagSelection, AutoTagSuggestionEntity } from "./types";

const ENTITY_TYPE_ICONS: Record<EntityType, typeof ListTree> = {
  repositoryCase: ListTree,
  testRun: PlayCircle,
  session: Compass,
};

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
  const t = useTranslations("autoTag.review");
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
          placeholder={t("filterEntities")}
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
            const isFailed = entity.failed === true;

            return (
              <button
                key={entity.entityId}
                type="button"
                onClick={() => onSelectEntity(entity.entityId)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50",
                  selectedEntityId === entity.entityId && "bg-accent",
                  isFailed && "border border-red-500/30 bg-red-500/5",
                  !hasSuggestions && !isFailed && "opacity-50",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {isFailed ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  ) : (() => {
                    const Icon = ENTITY_TYPE_ICONS[entity.entityType];
                    return Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null;
                  })()}
                  <span className={cn("truncate", isFailed && "text-red-600 dark:text-red-400")}>{entity.entityName}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {isFailed
                    ? t("failed")
                    : acceptedCount > 0
                      ? t("tagCount", { count: acceptedCount })
                      : hasSuggestions
                        ? t("noTags")
                        : "--"}
                </span>
              </button>
            );
          })}
          {filteredEntities.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {t("noEntitiesMatch")}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
