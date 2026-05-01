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
import { useState } from "react";
import { toast } from "sonner";

export interface SelectSourceSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  paramId: number;
  paramName: string;
  invalidCount: number;
  newSource: {
    allowedValuesJson: string[] | null;
    lookupDataSetId: number | null;
  };
  onComplete?: () => void;
}

export function SelectSourceSwitchDialog({
  open,
  onOpenChange,
  caseId,
  paramId,
  paramName,
  invalidCount,
  newSource,
  onComplete,
}: SelectSourceSwitchDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/cases/${caseId}/parameters/${paramId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allowedValuesJson: newSource.allowedValuesJson,
            lookupDataSetId: newSource.lookupDataSetId,
          }),
        }
      );
      if (!res.ok) {
        toast.error(t("addError"));
        return;
      }
      toast.success(t("updateSuccess"));
      queryClient.invalidateQueries({ queryKey: ["TestCaseParameter"] });
      queryClient.invalidateQueries({ queryKey: ["RepositoryCases"] });
      onComplete?.();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="select-source-switch-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("selectSourceWarningTitle", { name: paramName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("selectSourceWarningDescription", { invalidCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="default"
              onClick={handleConfirm}
              disabled={submitting}
              data-testid="select-source-switch-confirm"
            >
              {t("selectSourceConfirm")}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
