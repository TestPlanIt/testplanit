"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { schema } from "~/zenstack/schema";

interface QuarantineDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Repository cases to quarantine; already-quarantined ones are skipped by the caller. */
  caseIds: number[];
  /** The signature the quarantine was decided from, if any. */
  signatureId?: number | null;
  onDone?: () => void;
}

/**
 * Quarantines one or more test cases with an optional reason. A quarantined
 * case keeps running; its failures stop counting against run pass/fail.
 */
export function QuarantineDialog({
  open,
  onClose,
  projectId,
  caseIds,
  signatureId,
  onDone,
}: QuarantineDialogProps) {
  const t = useTranslations("triage.quarantine");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const [reason, setReason] = useState("");
  const [keepUntilReleased, setKeepUntilReleased] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { mutateAsync: createMany } =
    useClientQueries(schema).caseQuarantine.useCreateMany();

  useEffect(() => {
    if (open) {
      setReason("");
      setKeepUntilReleased(false);
    }
  }, [open]);

  const submit = async () => {
    if (!session?.user?.id || caseIds.length === 0) return;
    setSubmitting(true);
    try {
      const trimmed = reason.trim();
      await createMany({
        data: caseIds.map((caseId) => ({
          caseId,
          projectId,
          signatureId: signatureId ?? null,
          reason: trimmed || null,
          keepUntilReleased,
          createdById: session.user.id,
        })),
      });
      toast.success(t("quarantinedToast", { count: caseIds.length }));
      onDone?.();
      onClose();
    } catch (error) {
      console.error("Failed to quarantine cases:", error);
      toast.error(t("failedToast"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent data-testid="quarantine-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("dialogTitle", { count: caseIds.length })}
          </DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="quarantine-reason">{t("reasonLabel")}</Label>
          <Textarea
            id="quarantine-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("reasonPlaceholder")}
            rows={3}
            data-testid="quarantine-reason"
          />
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="quarantine-keep"
            checked={keepUntilReleased}
            onCheckedChange={(value) => setKeepUntilReleased(value === true)}
            data-testid="quarantine-keep"
          />
          <div className="space-y-1">
            <Label htmlFor="quarantine-keep" className="font-normal">
              {t("keepLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("keepHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || caseIds.length === 0}
            data-testid="quarantine-confirm"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="h-4 w-4" />
            )}
            {t("action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
