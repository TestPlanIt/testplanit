"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  executionScopeBodyFields,
  isExecutionScopeSelectionActive,
  type RequirementExecutionScopeSelection,
} from "~/utils/requirementExecutionScope";

export interface SavedRequirementSnapshot {
  id: number;
  name: string;
  capturedAt: string;
}

/**
 * Names and captures a requirement traceability snapshot through
 * `POST /api/projects/[projectId]/requirements/snapshots`. Shared by the
 * Reports page (beside the snapshot picker) and the Requirements page
 * header, so the capture reads identically wherever it is launched.
 * `requirementIds` carries the report's scope when one is selected —
 * the dialog says so, since a scoped capture is a smaller record.
 */
export function RequirementSnapshotSaveDialog({
  projectId,
  open,
  onOpenChange,
  requirementIds,
  executionScope,
  onSaved,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirementIds?: number[];
  /** The launching surface's coverage execution scope — frozen onto the
   *  capture, and said out loud in the dialog (a scoped baseline can only
   *  ever be compared within the same frame). */
  executionScope?: RequirementExecutionScopeSelection;
  onSaved?: (snapshot: SavedRequirementSnapshot) => void;
}) {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCommon = useTranslations("common");
  const tRequirements = useTranslations("requirements.scope");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // A fresh dialog every time it opens — a stale name from the last
  // capture is exactly the kind of thing that mislabels audit evidence.
  useEffect(() => {
    if (open) {
      setName("");
      setNote("");
      setIsSaving(false);
    }
  }, [open]);

  const scoped = (requirementIds?.length ?? 0) > 0;
  const executionScoped = isExecutionScopeSelectionActive(executionScope);
  const trimmedName = name.trim();

  const handleSave = async () => {
    if (!trimmedName || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/requirements/snapshots`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            note: note.trim() ? note.trim() : null,
            ...(scoped ? { requirementIds } : {}),
            ...executionScopeBodyFields(executionScope),
          }),
        }
      );
      if (!response.ok) {
        throw new Error(
          `Snapshot capture failed with status ${response.status}`
        );
      }
      const snapshot = (await response.json()) as SavedRequirementSnapshot;
      // The snapshot list is a ZenStack query; the predicate matches its
      // key content rather than assuming a prefix (the recorded rule).
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "zenstack",
      });
      toast.success(t("snapshotSaved", { name: snapshot.name }));
      onOpenChange(false);
      onSaved?.(snapshot);
    } catch (error) {
      console.error("Requirement traceability snapshot capture failed:", error);
      toast.error(t("snapshotSaveFailed"));
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="requirement-snapshot-save-dialog">
        <DialogHeader>
          <DialogTitle>{t("saveSnapshotTitle")}</DialogTitle>
          <DialogDescription>
            {t("saveSnapshotDescription")}
            {scoped ? ` ${t("saveSnapshotScoped")}` : null}
            {executionScoped ? ` ${tRequirements("snapshotScoped")}` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="requirement-snapshot-name">
              {t("snapshotName")}
            </Label>
            <Input
              id="requirement-snapshot-name"
              value={name}
              maxLength={200}
              placeholder={t("snapshotNamePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              data-testid="requirement-snapshot-name"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="requirement-snapshot-note">
              {t("snapshotNote")}
            </Label>
            <Textarea
              id="requirement-snapshot-note"
              value={note}
              maxLength={4000}
              placeholder={t("snapshotNotePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              data-testid="requirement-snapshot-note"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid="requirement-snapshot-cancel"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!trimmedName || isSaving}
            data-testid="requirement-snapshot-submit"
          >
            {t("saveSnapshot")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
