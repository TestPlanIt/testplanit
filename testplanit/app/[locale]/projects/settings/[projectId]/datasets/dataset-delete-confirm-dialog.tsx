"use client";

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
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface DatasetDeleteConfirmDialogProps {
  projectId: number;
  dataSetId: number;
  dataSetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

type Stage = "stage1" | "stage2";

/**
 * Two-stage delete confirmation:
 *   - Stage 1 always: simple AlertDialog confirmation.
 *   - Stage 2 (if 409 with `has_assignments`): re-render with the assignment
 *     count and require an explicit second confirmation. The user must see
 *     the impact before any data linkage is removed.
 *
 * RESEARCH.md Pitfall 6 — never auto-confirm; always surface the count and
 * require an explicit second confirmation.
 *
 * Per `feedback_no_native_dialogs`, this NEVER uses window.confirm.
 */
export function DatasetDeleteConfirmDialog({
  projectId,
  dataSetId,
  dataSetName,
  open,
  onOpenChange,
  onDeleted,
}: DatasetDeleteConfirmDialogProps) {
  const t = useTranslations("projects.settings.datasets");
  const tDelete = useTranslations("projects.settings.datasets.delete");
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<Stage>("stage1");
  const [assignmentCount, setAssignmentCount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStage("stage1");
      setAssignmentCount(0);
    }
  }, [open]);

  const performDelete = async (confirm: boolean) => {
    setSubmitting(true);
    try {
      const url = confirm
        ? `/api/projects/${projectId}/datasets/${dataSetId}?confirm=true`
        : `/api/projects/${projectId}/datasets/${dataSetId}`;
      const res = await fetch(url, { method: "DELETE" });
      if (res.status === 409 && !confirm) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          assignmentCount?: number;
        };
        if (json.error === "has_assignments") {
          setAssignmentCount(json.assignmentCount ?? 0);
          setStage("stage2");
          setSubmitting(false);
          return;
        }
      }
      if (!res.ok) {
        toast.error(tDelete("error"));
        setSubmitting(false);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        deletedAssignments?: number;
      };
      void queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSet"] });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSetVersion"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "CaseSharedDataSetAssignment"],
      });
      const deleted = json.deletedAssignments ?? 0;
      toast.success(
        deleted > 0
          ? t("deleteSuccessWithAssignments", {
              name: dataSetName,
              count: deleted,
            })
          : t("deleteSuccess", { name: dataSetName })
      );
      onOpenChange(false);
      onDeleted?.();
    } catch {
      toast.error(tDelete("error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        data-testid="dataset-delete-confirm-dialog"
        data-stage={stage}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {tDelete("title", { name: dataSetName })}
          </AlertDialogTitle>
          <AlertDialogDescription
            data-testid={
              stage === "stage2"
                ? "dataset-delete-confirm-stage2"
                : "dataset-delete-confirm-stage1"
            }
          >
            {stage === "stage2"
              ? tDelete("descriptionStage2", { count: assignmentCount })
              : tDelete("descriptionStage1")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {tDelete("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="dataset-delete-confirm-button"
            onClick={(e) => {
              e.preventDefault();
              void performDelete(stage === "stage2");
            }}
            disabled={submitting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {stage === "stage2"
              ? tDelete("confirmAnyway", { count: assignmentCount })
              : tDelete("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
