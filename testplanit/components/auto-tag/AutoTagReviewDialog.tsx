"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { invalidateModelQueries } from "~/utils/optimistic-updates";
import { EntityList } from "./EntityList";
import { EntitySuggestions } from "./EntitySuggestions";
import type { UseAutoTagJobReturn } from "./types";

interface AutoTagReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: UseAutoTagJobReturn;
}

/** Map entity type to the React Query model name for invalidation */
function getModelName(entityType: string): string {
  switch (entityType) {
    case "repositoryCase":
      return "RepositoryCases";
    case "testRun":
      return "TestRuns";
    case "session":
      return "Sessions";
    default:
      return entityType;
  }
}

export function AutoTagReviewDialog({
  open,
  onOpenChange,
  job,
}: AutoTagReviewDialogProps) {
  const queryClient = useQueryClient();
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);

  // Auto-select first entity when suggestions load or dialog opens
  useEffect(() => {
    if (job.suggestions && job.suggestions.length > 0) {
      setSelectedEntityId(job.suggestions[0].entityId);
    }
  }, [job.suggestions]);

  const selectedEntity = job.suggestions?.find(
    (e) => e.entityId === selectedEntityId,
  );

  const totalSelected = job.summary.existingCount + job.summary.newCount;

  const handleApply = useCallback(async () => {
    try {
      await job.apply();

      // Determine entity type for invalidation
      const entityType = job.suggestions?.[0]?.entityType;
      if (entityType) {
        await invalidateModelQueries(queryClient, getModelName(entityType));
      }
      await invalidateModelQueries(queryClient, "Tags");

      const { existingCount, newCount } = job.summary;
      const entityCount = new Set(
        job.suggestions
          ?.filter((e) => (job.selections.get(e.entityId)?.size ?? 0) > 0)
          .map((e) => e.entityId),
      ).size;

      toast.success(
        `${existingCount + newCount} tags applied to ${entityCount} ${entityCount === 1 ? "entity" : "entities"}${newCount > 0 ? `, ${newCount} new tags created` : ""}`,
      );

      onOpenChange(false);
      job.reset();
    } catch (err: any) {
      toast.error(err.message || "Failed to apply tags. Please try again.");
    }
  }, [job, queryClient, onOpenChange]);

  if (!job.suggestions) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-w-[900px] flex-col">
        <DialogHeader>
          <DialogTitle>Review Tag Suggestions</DialogTitle>
          <DialogDescription>
            Click tags to toggle acceptance. Double-click to edit a tag name.
          </DialogDescription>
        </DialogHeader>

        {/* Two-column layout */}
        <div className="grid min-h-0 flex-1 grid-cols-[35%_1fr] gap-4">
          {/* Left column: Entity list */}
          <div className="min-h-0 border-r pr-4">
            <EntityList
              entities={job.suggestions}
              selectedEntityId={selectedEntityId}
              onSelectEntity={setSelectedEntityId}
              selections={job.selections}
            />
          </div>

          {/* Right column: Suggestions for selected entity */}
          <div className="min-h-0">
            {selectedEntity ? (
              <EntitySuggestions
                entity={selectedEntity}
                selections={job.selections}
                onToggle={job.toggleTag}
                onEdit={job.editTag}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select an entity to view tag suggestions.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {totalSelected > 0
              ? `${job.summary.existingCount} existing tag${job.summary.existingCount !== 1 ? "s" : ""}, ${job.summary.newCount} new tag${job.summary.newCount !== 1 ? "s" : ""} will be created`
              : "No tags selected"}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={job.isApplying || totalSelected === 0}
            >
              {job.isApplying && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {job.isApplying ? "Applying..." : "Apply"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
