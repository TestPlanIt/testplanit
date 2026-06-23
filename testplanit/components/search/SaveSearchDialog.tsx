"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  auditShareLinkCreation,
  prepareShareLinkData,
} from "@/actions/share-links";
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
import { Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  buildSavedSearchConfig,
  type SavedSearchCriteria,
} from "~/lib/schemas/savedSearch";

interface SaveSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live Unified Search state captured when the dialog is submitted. */
  criteria: SavedSearchCriteria;
  onSaved?: () => void;
}

/**
 * Persists the current Unified Search as a named `ShareLink` (entityType
 * SEARCH), private to the creator. The mode is always AUTHENTICATED — public
 * and password modes don't apply to searches, which only resolve for a
 * signed-in user.
 */
export function SaveSearchDialog({
  open,
  onOpenChange,
  criteria,
  onSaved,
}: SaveSearchDialogProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const { mutateAsync: createShareLink, isPending } = useClientQueries(schema).shareLink.useCreate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Seed the name from the current query each time the dialog opens (editable).
  useEffect(() => {
    if (open) {
      setName(criteria.query.slice(0, 120));
      setDescription("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
  };

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError(t("search.savedSearches.nameRequired"));
      return;
    }
    if (!session?.user?.id) {
      setError(t("search.savedSearches.loginRequired"));
      return;
    }

    try {
      const { shareKey, passwordHash } = await prepareShareLinkData({
        password: null,
      });

      const shareLink = await createShareLink({
        data: {
          shareKey,
          entityType: "SEARCH",
          entityConfig: buildSavedSearchConfig(criteria),
          createdById: session.user.id,
          mode: "AUTHENTICATED",
          passwordHash,
          expiresAt: null,
          notifyOnView: false,
          title: trimmedName,
          description: description.trim() || null,
        },
      });

      if (!shareLink) {
        throw new Error("Failed to save search");
      }

      await auditShareLinkCreation({
        id: shareLink.id,
        shareKey: shareLink.shareKey,
        entityType: shareLink.entityType,
        mode: shareLink.mode,
        title: shareLink.title,
        projectId:
          shareLink.projectId !== null ? shareLink.projectId : undefined,
        expiresAt: shareLink.expiresAt,
        notifyOnView: shareLink.notifyOnView,
        hasPassword: !!passwordHash,
      });

      toast.success(t("search.savedSearches.saved"), {
        description: t("search.savedSearches.savedDescription", {
          name: trimmedName,
        }),
      });

      onSaved?.();
      handleOpenChange(false);
    } catch (err) {
      console.error("Error saving search:", err);
      setError(t("search.savedSearches.saveFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("search.savedSearches.saveTitle")}</DialogTitle>
          <DialogDescription>
            {t("search.savedSearches.saveDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="saved-search-name">
              {t("search.savedSearches.nameLabel")}
            </Label>
            <Input
              id="saved-search-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("search.savedSearches.namePlaceholder")}
              maxLength={120}
              autoFocus
              data-testid="saved-search-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="saved-search-description">
              {t("search.savedSearches.descriptionLabel")}
            </Label>
            <Textarea
              id="saved-search-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("search.savedSearches.descriptionPlaceholder")}
              maxLength={500}
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            data-testid="saved-search-save-button"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("search.savedSearches.saveAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
