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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFindManyStatus } from "~/lib/hooks";

export interface IterationBulkConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  iterationIds: number[];
  runId: number;
  caseId: number;
  /** Project ID — used to fetch available Test Run statuses. */
  projectId: number;
  /** How many of the selected iterations already have a result. */
  alreadyCompletedCount: number;
}

/**
 * UI-SPEC Surface D — Bulk-apply-status confirmation dialog.
 *
 * Used both for the IterationBulkToolbar's "Mark with status…" action and
 * for the single-iteration overflow menu (which calls with a one-element
 * iterationIds array). The user picks any Test-Run-scoped project status;
 * the server validates and applies it to all selected iterations
 * atomically, then recomputes the case-level rollup + counters.
 *
 * No status name is hardcoded — the dialog adapts to whatever statuses
 * the project has configured (admin-defined names + colors).
 */
export function IterationBulkConfirmDialog({
  open,
  onOpenChange,
  iterationIds,
  runId,
  caseId,
  projectId,
  alreadyCompletedCount,
}: IterationBulkConfirmDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedStatusId, setSelectedStatusId] = useState<string>("");
  // Mirrors AddResultModal's pattern: false on first paint so the initial
  // border color appears instantly; flips true on user-driven status change
  // so subsequent changes animate. Reset when the dialog reopens.
  const [animateBorder, setAnimateBorder] = useState(false);

  const { data: statuses } = useFindManyStatus({
    where: {
      AND: [
        { isEnabled: true },
        { isDeleted: false },
        { projects: { some: { projectId: Number(projectId) } } },
        { scope: { some: { scope: { name: "Test Run" } } } },
      ],
    },
    include: { color: { select: { value: true } } },
    orderBy: { order: "asc" },
  });

  // Reset transient UI state on open and default the picker to the first
  // status in the project's configured order. The user can change it before
  // confirming; Confirm stays disabled until a status is selected.
  useEffect(() => {
    if (!open) return;
    setReason("");
    setAnimateBorder(false);
    const first = statuses?.[0];
    setSelectedStatusId(first ? String(first.id) : "");
  }, [open, statuses]);

  const count = iterationIds.length;
  const hasOverwrites = alreadyCompletedCount > 0;
  const chosenStatus =
    statuses?.find((s) => String(s.id) === selectedStatusId) ?? null;
  const action = chosenStatus?.name ?? "";

  const handleConfirm = async () => {
    if (!chosenStatus) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/test-runs/${runId}/cases/${caseId}/iterations/bulk-skip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            iterationIds,
            statusId: chosenStatus.id,
            reason: reason.trim() ? reason.trim() : undefined,
          }),
        }
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
      // Bulk-apply touches multiple models and rolls up the case-level
      // status; broad invalidation matches AddResultModal/IterationResultPanel
      // so every consumer (run page, repository, history) refetches.
      await queryClient.invalidateQueries();
      onOpenChange(false);
    } catch {
      toast.error(t("iterationBulkError"));
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = chosenStatus?.color?.value;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid="iteration-bulk-confirm-dialog"
        className={`border-8 ${animateBorder ? "transition-[border-color] duration-2000" : ""}`}
        style={{
          borderColor: statusColor,
          backgroundColor: "hsl(var(--background))",
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("iterationBulkConfirmTitle", { count, action })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action
              ? t("iterationBulkConfirmDescription", { statusName: action })
              : t("iterationBulkPickStatusPrompt")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="iteration-bulk-status"
            className="text-xs font-medium"
          >
            {t("iterationBulkStatusLabel")}
          </label>
          <Select
            value={selectedStatusId}
            onValueChange={(v) => {
              setSelectedStatusId(v);
              setAnimateBorder(true);
            }}
          >
            <SelectTrigger
              id="iteration-bulk-status"
              data-testid="iteration-bulk-status-trigger"
            >
              <SelectValue placeholder={t("iterationBulkStatusPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(statuses ?? []).map((s) => (
                <SelectItem
                  key={s.id}
                  value={String(s.id)}
                  data-testid={`iteration-bulk-status-${s.id}`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: s.color?.value || "#B1B2B3",
                      }}
                    />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
            disabled={submitting || count === 0 || !chosenStatus}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
            data-testid="iteration-bulk-confirm"
            className={`text-white hover:opacity-90 ${
              animateBorder
                ? "transition-[background-color,border-color] duration-2000"
                : ""
            }`}
            style={
              statusColor
                ? {
                    backgroundColor: statusColor,
                    borderColor: statusColor,
                  }
                : undefined
            }
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
