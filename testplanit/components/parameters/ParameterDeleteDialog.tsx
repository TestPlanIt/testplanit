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
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export interface ParameterDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  paramId: number;
  paramName: string;
  currentCaseVersion: number;
}

interface ScanCounts {
  stepCount: number;
  expectedCount: number;
  rowCount: number;
}

export function ParameterDeleteDialog({
  open,
  onOpenChange,
  caseId,
  paramId,
  paramName,
  currentCaseVersion,
}: ParameterDeleteDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<ScanCounts | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCounts(null);
    fetch(
      `/api/repository/cases/${caseId}/parameters/${paramId}/scan-references`
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCounts({
          stepCount: Number(d.stepCount ?? 0),
          expectedCount: Number(d.expectedCount ?? 0),
          rowCount: Number(d.rowCount ?? 0),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCounts({ stepCount: 0, expectedCount: 0, rowCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [open, caseId, paramId]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/cases/${caseId}/parameters/${paramId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        toast.error(t("addError"));
        return;
      }
      toast.success(t("deleteSuccess", { name: paramName }));
      queryClient.invalidateQueries({ queryKey: ["zenstack", "TestCaseParameter"] });
      queryClient.invalidateQueries({ queryKey: ["zenstack", "RepositoryCases"] });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const totalStepRefs = (counts?.stepCount ?? 0) + (counts?.expectedCount ?? 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="parameter-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("deleteTitle", { name: paramName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteDescription", {
              stepCount: totalStepRefs,
              rowCount: counts?.rowCount ?? 0,
              nextVersion: currentCaseVersion + 1,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="parameter-delete-confirm"
          >
            {t("deleteConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
