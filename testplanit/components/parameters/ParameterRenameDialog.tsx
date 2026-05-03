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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface ParameterRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  paramId: number;
  oldName: string;
  newName: string;
  currentCaseVersion: number;
  onComplete: () => void;
}

interface ScanCounts {
  stepCount: number;
  expectedCount: number;
  rowCount: number;
}

export function ParameterRenameDialog({
  open,
  onOpenChange,
  caseId,
  paramId,
  oldName,
  newName,
  currentCaseVersion,
  onComplete,
}: ParameterRenameDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<ScanCounts | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const silentPatchFiredRef = useRef(false);

  const handlePatch = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/cases/${caseId}/parameters/${paramId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        }
      );
      if (!res.ok) {
        toast.error(t("addError"));
        return;
      }
      const result = await res.json();
      const version = result?.parameter?.testCase?.currentVersion;
      if (typeof version === "number") {
        toast.message(t("toastVersionBumped", { version }));
      } else {
        toast.success(t("updateSuccess"));
      }
      queryClient.invalidateQueries({ queryKey: ["zenstack", "TestCaseParameter"] });
      queryClient.invalidateQueries({ queryKey: ["zenstack", "RepositoryCases"] });
      onComplete();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!open) {
      silentPatchFiredRef.current = false;
      setCounts(null);
      return;
    }

    let cancelled = false;
    fetch(
      `/api/repository/cases/${caseId}/parameters/${paramId}/scan-references`
    )
      .then((r) => r.json())
      .then(async (d) => {
        if (cancelled) return;
        const scanned: ScanCounts = {
          stepCount: Number(d.stepCount ?? 0),
          expectedCount: Number(d.expectedCount ?? 0),
          rowCount: Number(d.rowCount ?? 0),
        };
        const total =
          scanned.stepCount + scanned.expectedCount + scanned.rowCount;
        if (total === 0 && !silentPatchFiredRef.current) {
          silentPatchFiredRef.current = true;
          // Silent rename: zero-refs path bypasses dialog body entirely.
          await fetch(
            `/api/repository/cases/${caseId}/parameters/${paramId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: newName }),
            }
          );
          if (cancelled) return;
          toast.message(t("renameNoRefsToast"));
          queryClient.invalidateQueries({ queryKey: ["zenstack", "TestCaseParameter"] });
          queryClient.invalidateQueries({ queryKey: ["zenstack", "RepositoryCases"] });
          onComplete();
          onOpenChange(false);
          return;
        }
        setCounts(scanned);
      })
      .catch(() => {
        if (cancelled) return;
        setCounts({ stepCount: 0, expectedCount: 0, rowCount: 0 });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseId, paramId, newName]);

  // Render nothing while we're still scanning OR after we silently fired a PATCH.
  if (!open || counts === null) {
    return null;
  }

  const totalCount =
    counts.stepCount + counts.expectedCount + counts.rowCount;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="parameter-rename-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("renameTitle", { oldName, newName })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {t("renameDescriptionLead", { totalCount })}
              </p>
              <ul className="list-disc pl-5 text-sm">
                <li>
                  {t("renameDescriptionStepCount", {
                    stepCount: counts.stepCount,
                  })}
                </li>
                <li>
                  {t("renameDescriptionExpectedCount", {
                    expectedCount: counts.expectedCount,
                  })}
                </li>
                <li>
                  {t("renameDescriptionRowCount", {
                    rowCount: counts.rowCount,
                  })}
                </li>
              </ul>
              <p>
                {t("renameDescriptionVersion", {
                  nextVersion: currentCaseVersion + 1,
                })}
              </p>
            </div>
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
              onClick={handlePatch}
              disabled={submitting}
              data-testid="parameter-rename-confirm"
            >
              {t("renameConfirm")}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
