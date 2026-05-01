"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export interface DatasetRowActionsProps {
  caseId: number;
  selectedRowIds: number[];
  onClear: () => void;
}

/**
 * Dataset Surface D.7 bulk-action toolbar shown when ≥1 row is selected.
 * Replaces the standard toolbar text with selected-count + Delete + Clear
 * actions. The Delete action opens a shadcn AlertDialog per
 * `feedback_no_native_dialogs` (no native dialogs allowed).
 */
export function DatasetRowActions({
  caseId,
  selectedRowIds,
  onClear,
}: DatasetRowActionsProps) {
  const tCommon = useTranslations("common");
  const tActions = useTranslations("common.actions");
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/cases/${caseId}/dataset/rows`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowIds: selectedRowIds }),
        }
      );
      if (!res.ok) {
        toast.error(t("datasetSaveError"));
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["DataSetRow"] });
      onClear();
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-3" data-testid="dataset-row-actions">
      <span
        className="text-sm font-medium"
        data-testid="dataset-row-actions-count"
      >
        {t("datasetSelectedCount", { count: selectedRowIds.length })}
      </span>
      <div className="flex gap-2 ml-auto">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          data-testid="dataset-row-actions-delete"
        >
          {t("datasetDeleteSelected")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          data-testid="dataset-row-actions-clear"
        >
          {t("datasetClearSelection")}
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="dataset-row-actions-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("datasetBulkDeleteTitle", { count: selectedRowIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("datasetBulkDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={submitting}
              data-testid="dataset-row-actions-confirm-delete"
            >
              {tActions("delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
