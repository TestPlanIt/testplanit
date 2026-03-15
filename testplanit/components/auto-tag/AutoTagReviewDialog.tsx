"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent, DialogDescription,
  DialogFooter, DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { invalidateModelQueries } from "~/utils/optimistic-updates";
import { EntityList } from "./EntityList";
import { EntitySuggestions } from "./EntitySuggestions";
import type { UseAutoTagJobReturn } from "./types";

interface AutoTagReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: UseAutoTagJobReturn;
  /** Called after tags have been successfully applied */
  onApplied?: () => void;
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
  onApplied,
}: AutoTagReviewDialogProps) {
  const queryClient = useQueryClient();
  const t = useTranslations("autoTag.review");
  const tCommon = useTranslations("common");
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

  const totalSelected = job.summary.assignCount;

  const handleApply = useCallback(async () => {
    try {
      await job.apply();

      // Determine entity type for invalidation
      const entityType = job.suggestions?.[0]?.entityType;
      if (entityType) {
        await invalidateModelQueries(queryClient, getModelName(entityType));
      }
      await invalidateModelQueries(queryClient, "Tags");

      const { assignCount, newCount } = job.summary;
      const entityCount = new Set(
        job.suggestions
          ?.filter((e) => (job.selections.get(e.entityId)?.size ?? 0) > 0)
          .map((e) => e.entityId),
      ).size;

      const tagCount = assignCount;
      toast.success(
        newCount > 0
          ? t("applySuccessNewTags", { tagCount, entityCount, newCount })
          : t("applySuccess", { tagCount, entityCount }),
      );

      onOpenChange(false);
      job.reset();
      onApplied?.();
    } catch (err: any) {
      toast.error(err.message || t("applyError"));
    }
  }, [job, queryClient, onOpenChange, onApplied, t]);

  if (!job.suggestions) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[600px] max-w-[900px] flex-col">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
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
                {t("selectEntity")}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {totalSelected > 0
              ? t("footerSummary", { assignCount: job.summary.assignCount, newCount: job.summary.newCount })
              : t("noTagsSelected")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={handleApply}
              disabled={job.isApplying || totalSelected === 0}
            >
              {job.isApplying && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {job.isApplying ? t("applying") : tCommon("actions.apply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
