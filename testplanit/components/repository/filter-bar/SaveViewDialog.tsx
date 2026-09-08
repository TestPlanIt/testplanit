"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import {
  SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH,
  SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH,
} from "~/lib/schemas/savedRepositoryView";

export interface SaveViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving?: boolean;
  /**
   * Persists the view. Rejecting keeps the dialog open with an error, so a
   * failed write never looks like a save.
   */
  onSave: (input: { name: string; description: string }) => Promise<void>;
}

/**
 * Names the current repository view (filters + grouping axis) for later reuse.
 * The twin of components/search/SaveSearchDialog.tsx — same shape, same
 * wording — so saved searches and saved views read as one idea.
 */
export function SaveViewDialog({
  open,
  onOpenChange,
  isSaving = false,
  onSave,
}: SaveViewDialogProps) {
  const t = useTranslations();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("repository.savedViews.nameRequired"));
      return;
    }

    try {
      await onSave({ name: trimmedName, description: description.trim() });
      onOpenChange(false);
    } catch (err) {
      console.error("Error saving repository view:", err);
      setError(t("repository.savedViews.saveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="save-view-dialog">
        <DialogHeader>
          <DialogTitle>{t("repository.savedViews.saveTitle")}</DialogTitle>
          <DialogDescription>
            {t("repository.savedViews.saveDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="saved-view-name">{t("common.name")}</Label>
            <Input
              id="saved-view-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("repository.savedViews.namePlaceholder")}
              maxLength={SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
              }}
              data-testid="saved-view-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="saved-view-description">
              {t("search.savedSearches.descriptionLabel")}
            </Label>
            <Textarea
              id="saved-view-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("repository.savedViews.descriptionPlaceholder")}
              maxLength={SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH}
              rows={2}
              data-testid="saved-view-description-input"
            />
          </div>
          {error && (
            <p
              className="text-sm text-destructive"
              data-testid="saved-view-error"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            data-testid="saved-view-save-submit"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
