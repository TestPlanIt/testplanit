"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";

export interface IterationBulkConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  iterationIds: number[];
  runId: number;
  caseId: number;
  /** How many of the selected iterations already have a result. */
  alreadyCompletedCount: number;
  /** Display name of the Skipped status (typically "Skipped / N/A"). */
  statusName: string;
}

/**
 * UI-SPEC Surface D — Bulk skip confirmation dialog.
 *
 * Used both for the IterationBulkToolbar's "Mark Skipped" action and for
 * the single-iteration "skip" overflow menu item (which calls with a
 * one-element iterationIds array). POSTs to the bulk-skip route which
 * writes one TestRunResults row per iteration in a single transaction
 * and recomputes the case-level rollup + counters once.
 */
export function IterationBulkConfirmDialog({
  open,
  onOpenChange,
  iterationIds,
  runId,
  caseId,
  alreadyCompletedCount,
  statusName,
}: IterationBulkConfirmDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const count = iterationIds.length;
  const hasOverwrites = alreadyCompletedCount > 0;
  const action = t("iterationStatusSkipped");

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/test-runs/${runId}/cases/${caseId}/iterations/bulk-skip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            iterationIds,
            reason: reason.trim() ? reason.trim() : undefined,
          }),
        },
      );
      if (!res.ok) {
        let message: string | undefined;
        try {
          const errBody = await res.json();
          message = errBody?.error;
        } catch {
          message = undefined;
        }
        toast.error(t("iterationBulkError"), { description: message });
        return;
      }
      toast.success(t("iterationBulkSuccess", { count, action }));
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRunCaseIteration"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRunCases"],
      });
      onOpenChange(false);
    } catch {
      toast.error(t("iterationBulkError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="iteration-bulk-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("iterationBulkConfirmTitle", { count, action })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("iterationBulkConfirmDescription", { statusName })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasOverwrites && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="iteration-bulk-overwrite-warning"
          >
            {t("iterationBulkOverwriteWarning", {
              count: alreadyCompletedCount,
            })}
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="iteration-bulk-reason"
            className="text-xs font-medium"
          >
            {t("iterationBulkReasonLabel")}
          </label>
          <Textarea
            id="iteration-bulk-reason"
            data-testid="iteration-bulk-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("iterationBulkReasonHelp")}
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="iteration-bulk-cancel">
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={submitting || count === 0}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            data-testid="iteration-bulk-confirm"
          >
            {hasOverwrites
              ? t("iterationBulkConfirmReplace", { action })
              : t("iterationBulkConfirm", { action })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default IterationBulkConfirmDialog;
