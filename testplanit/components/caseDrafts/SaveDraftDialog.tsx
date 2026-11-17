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
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";

export interface SaveDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Name the field starts with: the draft's current name, or a suggestion. */
  defaultName: string;
  /** Title of the dialog: saving a new draft or renaming an existing one. */
  mode: "save" | "rename";
  onSubmit: (name: string) => Promise<void> | void;
}

/**
 * Asks for a draft's name. Shared by the Add Case form, the Add Multiple
 * Cases grid, and the rename action in the My Drafts list.
 */
export function SaveDraftDialog({
  open,
  onOpenChange,
  defaultName,
  mode,
  onSubmit,
}: SaveDraftDialogProps) {
  const t = useTranslations("repository.savedDrafts");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-testid="save-draft-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === "rename" ? t("renameTitle") : t("saveTitle")}
          </DialogTitle>
          <DialogDescription>{t("saveDescription")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-2"
        >
          <Label htmlFor="save-draft-name">
            {tGlobal("repository.addCase.name")}
          </Label>
          <Input
            id="save-draft-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
            data-testid="save-draft-name"
          />
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!trimmed || busy}
            data-testid="save-draft-submit"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "rename"
              ? tGlobal("repository.savedViews.rename")
              : t("saveDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
