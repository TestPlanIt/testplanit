"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { TagChip } from "./TagChip";
import type { AutoTagSelection, AutoTagSuggestionEntity } from "./types";

interface EntitySuggestionsProps {
  entity: AutoTagSuggestionEntity;
  selections: AutoTagSelection;
  onToggle: (entityId: number, tagName: string) => void;
  onEdit: (entityId: number, oldName: string, newName: string) => void;
}

export function EntitySuggestions({
  entity,
  selections,
  onToggle,
  onEdit,
}: EntitySuggestionsProps) {
  const t = useTranslations("autoTag.review");
  const entitySelections = selections.get(entity.entityId);

  if (entity.failed) {
    return (
      <ScrollArea className="h-full">
        <div className="space-y-6 pr-4">
          <h3 className="text-sm font-medium">{entity.entityName}</h3>
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
            <div className="text-sm text-destructive-foreground">
              <p className="font-medium">{t("analysisFailed")}</p>
              {entity.errorMessage && (
                <p className="mt-1 text-xs opacity-80">{entity.errorMessage}</p>
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 pr-4">
        {/* Header */}
        <h3 className="text-sm font-medium">{entity.entityName}</h3>

        {/* Suggested Tags */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("suggestedTags")}
          </h4>
          {entity.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {entity.tags.map((tag) => (
                <TagChip
                  key={tag.tagName}
                  tagName={tag.tagName}
                  isExisting={tag.isExisting}
                  isAccepted={entitySelections?.has(tag.tagName) ?? false}
                  onToggle={() => onToggle(entity.entityId, tag.tagName)}
                  onEdit={(newName) =>
                    onEdit(entity.entityId, tag.tagName, newName)
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("noSuggestions")}
            </p>
          )}
        </div>

        {/* Current Tags */}
        {entity.currentTags.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("alreadyApplied")}
            </h4>
            <div className="flex flex-wrap gap-2">
              {entity.currentTags.map((tagName) => (
                <Badge
                  key={tagName}
                  variant="secondary"
                  className="opacity-50"
                >
                  <Tag className="mr-1 h-3 w-3" />
                  {tagName}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
