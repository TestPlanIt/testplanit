"use client";

import React, { useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/forms/DatePickerField";
import { Form } from "@/components/ui/form";
import { useTranslations } from "next-intl";
import { CalendarDays, AlertTriangle } from "lucide-react";
import type { MilestonesWithTypes } from "~/utils/milestoneUtils";
import { completeMilestoneCascade } from "~/app/actions/milestoneActions";
import { toast } from "sonner";

interface CompleteMilestoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milestoneToComplete: MilestonesWithTypes;
  onCompleteSuccess: () => void;
}

interface CompleteMilestoneFormValues {
  completionDate: Date;
}

interface CompletionImpact {
  activeTestRuns: number;
  activeSessions: number;
  descendantMilestonesToComplete: number;
}

export function CompleteMilestoneDialog({
  open,
  onOpenChange,
  milestoneToComplete,
  onCompleteSuccess,
}: CompleteMilestoneDialogProps) {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [impactData, setImpactData] = useState<CompletionImpact | null>(null);

  const form = useForm<CompleteMilestoneFormValues>({
    defaultValues: {
      completionDate: milestoneToComplete?.completedAt
        ? new Date(milestoneToComplete.completedAt)
        : new Date(),
    },
  });

  useEffect(() => {
    if (milestoneToComplete && open) {
      form.reset({
        completionDate: milestoneToComplete.completedAt
          ? new Date(milestoneToComplete.completedAt)
          : new Date(),
      });
      setShowConfirmation(false);
      setImpactData(null);
    } else if (!open) {
      setShowConfirmation(false);
      setImpactData(null);
    }
  }, [milestoneToComplete, form, open]);

  const handleInitialSubmit = async (data: CompleteMilestoneFormValues) => {
    if (!milestoneToComplete) return;
    setIsSubmitting(true);
    try {
      const result = await completeMilestoneCascade({
        milestoneId: milestoneToComplete.id,
        completionDate: data.completionDate,
        isPreview: true,
      });

      if (result.status === "success" && result.impact) {
        if (
          result.impact.activeTestRuns > 0 ||
          result.impact.activeSessions > 0 ||
          result.impact.descendantMilestonesToComplete > 0
        ) {
          setImpactData(result.impact);
          setShowConfirmation(true);
        } else {
          await handleForceComplete(data.completionDate);
        }
      } else if (result.status === "error") {
        toast.error(result.message || "An unknown error occurred.");
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Failed to preview milestone completion:", error);
      toast.error("An unknown error occurred.");
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForceComplete = async (completionDate: Date) => {
    if (!milestoneToComplete) return;
    setIsSubmitting(true);
    try {
      const result = await completeMilestoneCascade({
        milestoneId: milestoneToComplete.id,
        completionDate: completionDate,
        forceCompleteDependencies: true,
      });

      if (result.status === "success") {
        toast.success(
          result.message || `Milestone "${milestoneToComplete.name}" completed.`
        );
        onCompleteSuccess();
        onOpenChange(false);
      } else {
        toast.error(result.message || "An unknown error occurred.");
        if (result.status === "error") onOpenChange(false);
      }
    } catch (error) {
      console.error("Failed to complete milestone with force:", error);
      toast.error("An unknown error occurred.");
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!milestoneToComplete) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (isSubmitting) return;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <FormProvider {...form}>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(
                showConfirmation
                  ? () => handleForceComplete(form.getValues("completionDate"))
                  : handleInitialSubmit
              )}
            >
              <DialogHeader>
                <DialogTitle className="flex items-center">
                  {!showConfirmation ? (
                    <CalendarDays className="w-6 h-6 mr-2" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 mr-2 text-destructive" />
                  )}
                  {showConfirmation
                    ? t("milestones.completeDialog.confirmTitle")
                    : t("milestones.dates.pickCompletionDate")}
                </DialogTitle>
                {showConfirmation && impactData && (
                  <DialogDescription className="pt-2">
                    {t("milestones.completeDialog.confirmDescription")}
                    <ul className="list-disc pl-5 mt-2 text-sm">
                      {impactData.activeTestRuns > 0 && (
                        <li>
                          {t("milestones.completeDialog.impactActiveTestRuns", {
                            count: impactData.activeTestRuns,
                          })}
                        </li>
                      )}
                      {impactData.activeSessions > 0 && (
                        <li>
                          {t("milestones.completeDialog.impactActiveSessions", {
                            count: impactData.activeSessions,
                          })}
                        </li>
                      )}
                      {impactData.descendantMilestonesToComplete > 0 && (
                        <li>
                          {t(
                            "milestones.completeDialog.impactDescendantMilestones",
                            { count: impactData.descendantMilestonesToComplete }
                          )}
                        </li>
                      )}
                    </ul>
                  </DialogDescription>
                )}
              </DialogHeader>

              {!showConfirmation && (
                <div className="space-y-4 my-4">
                  <DatePickerField
                    control={form.control}
                    name="completionDate"
                    placeholder={t("milestones.dates.selectDate")}
                    disabled={isSubmitting}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("milestones.dates.completionWarning")}
                  </p>
                </div>
              )}

              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  {tCommon("actions.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? t("milestones.completeDialog.processing")
                    : showConfirmation
                      ? t("milestones.completeDialog.confirmAndCompleteAll")
                      : t("milestones.completeDialog.completeButton")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
