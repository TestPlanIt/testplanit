"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface CreateRequirementDialogProps {
  projectId: string;
  parentId: number | null;
  /** Display-only — the parent's name for the read-only "Parent" row. The
   *  create payload only ever needs `parentId`; this is purely presentational
   *  so the dialog never has to look the parent back up itself. */
  parentName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: number) => void;
}

/**
 * HIER-02's native create surface. Forked from `create-issue-dialog.tsx`'s
 * no-tracker branch (`25-PATTERNS.md`'s <interfaces> block, lines 71-95) —
 * the only additions to that verbatim payload shape are `isRequirement:
 * true` and, for a child create, a `parent: { connect: { id } }`. This
 * dialog never sets a tracker-link field (no external id/key/url, no
 * integration reference) — a natively created requirement has no tracker
 * link at all, which is what makes it PROV-03's native state.
 *
 * The parent comes from the tree's own selection (the node whose "Add
 * child" action opened this dialog, or `null` from the toolbar's "Add
 * root"), never from a picker — nothing in this phase calls for one.
 */
export function CreateRequirementDialog({
  projectId,
  parentId,
  parentName,
  open,
  onOpenChange,
  onCreated,
}: CreateRequirementDialogProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createIssue = useClientQueries(schema).issue.useCreate();

  // Start every open with a blank field — this dialog is reused across every
  // "Add root" / "Add child" invocation rather than being remounted per
  // target, so a stale name from a previous create must never survive.
  useEffect(() => {
    if (open) {
      setName("");
    }
  }, [open]);

  const trimmedName = name.trim();
  // Single source of truth for "Return/click would submit" -- the hint below
  // renders from this exact expression, so it can never promise Return works
  // while the button itself stays disabled.
  const canSubmit = Boolean(trimmedName) && !isSubmitting;

  const handleSubmit = async () => {
    if (!trimmedName || !session?.user?.id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const createData: any = {
        name: trimmedName,
        title: trimmedName,
        description: "",
        status: "open",
        priority: "medium",
        project: { connect: { id: Number(projectId) } },
        createdBy: { connect: { id: session.user.id } },
        isRequirement: true,
      };
      if (parentId != null) {
        createData.parent = { connect: { id: parentId } };
      }
      const created = await createIssue.mutateAsync({ data: createData });
      toast.success(t("requirements.create.success"));
      onOpenChange(false);
      if (created?.id) {
        onCreated?.(created.id);
      }
    } catch (error) {
      console.error("Failed to create requirement:", error);
      toast.error(t("requirements.create.failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-requirement-dialog">
        <DialogHeader>
          <DialogTitle>{t("requirements.create.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("requirements.create.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("requirements.create.parentLabel")}</Label>
            <div
              className="text-sm text-muted-foreground"
              data-testid="create-requirement-parent"
            >
              {parentId != null
                ? (parentName ?? "")
                : t("requirements.create.parentNone")}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-requirement-name">
              {t("requirements.create.nameLabel")}
            </Label>
            <Input
              id="create-requirement-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmedName) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={t("requirements.create.namePlaceholder")}
              autoFocus
              data-testid="create-requirement-name-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            title={canSubmit ? t("requirements.create.submitHint") : undefined}
            data-testid="create-requirement-submit"
          >
            {t("requirements.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
