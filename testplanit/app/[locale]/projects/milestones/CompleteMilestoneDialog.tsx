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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { CalendarDays, AlertTriangle } from "lucide-react";
import type { MilestonesWithTypes } from "~/utils/milestoneUtils";
import { completeMilestoneCascade } from "~/app/actions/milestoneActions";
import { toast } from "sonner";
import { useFindManyWorkflows } from "~/lib/hooks";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";

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
  const [completeTestRuns, setCompleteTestRuns] = useState(true);
  const [completeSessions, setCompleteSessions] = useState(true);
  const [selectedTestRunStateId, setSelectedTestRunStateId] = useState<number | null>(null);
  const [selectedSessionStateId, setSelectedSessionStateId] = useState<number | null>(null);

  const form = useForm<CompleteMilestoneFormValues>({
    defaultValues: {
      completionDate: milestoneToComplete?.completedAt
        ? new Date(milestoneToComplete.completedAt)
        : new Date(),
    },
  });

  // Fetch RUNS workflows
  const { data: runWorkflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      workflowType: "DONE",
      projects: {
        some: {
          projectId: milestoneToComplete?.projectId,
        },
      },
    },
    orderBy: { order: "asc" },
    include: { icon: true, color: true },
  });

  // Fetch SESSIONS workflows
  const { data: sessionWorkflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "SESSIONS",
      workflowType: "DONE",
      projects: {
        some: {
          projectId: milestoneToComplete?.projectId,
        },
      },
    },
    orderBy: { order: "asc" },
    include: { icon: true, color: true },
  });

  // Set default state IDs when workflows load
  useEffect(() => {
    if (runWorkflows && runWorkflows.length > 0) {
      setSelectedTestRunStateId(runWorkflows[0].id);
    }
  }, [runWorkflows]);

  useEffect(() => {
    if (sessionWorkflows && sessionWorkflows.length > 0) {
      setSelectedSessionStateId(sessionWorkflows[0].id);
    }
  }, [sessionWorkflows]);

  useEffect(() => {
    if (milestoneToComplete && open) {
      form.reset({
        completionDate: milestoneToComplete.completedAt
          ? new Date(milestoneToComplete.completedAt)
          : new Date(),
      });
      setShowConfirmation(false);
      setImpactData(null);

      // Fetch impact data when dialog opens to show checkboxes
      const fetchImpactData = async () => {
        try {
          const result = await completeMilestoneCascade({
            milestoneId: milestoneToComplete.id,
            completionDate: milestoneToComplete.completedAt
              ? new Date(milestoneToComplete.completedAt)
              : new Date(),
            isPreview: true,
          });

          if (result.impact) {
            setImpactData(result.impact);
          }
        } catch (error) {
          console.error("Failed to fetch impact data:", error);
        }
      };

      fetchImpactData();
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

      // Handle the preview result
      if (result.impact) {
        // If there are dependencies to complete, show confirmation
        if (
          result.impact.activeTestRuns > 0 ||
          result.impact.activeSessions > 0 ||
          result.impact.descendantMilestonesToComplete > 0
        ) {
          setImpactData(result.impact);
          setShowConfirmation(true);
        } else {
          // No dependencies, complete directly
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
        completeTestRuns: completeTestRuns,
        completeSessions: completeSessions,
        testRunStateId: completeTestRuns ? selectedTestRunStateId : null,
        sessionStateId: completeSessions ? selectedSessionStateId : null,
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
                  <div className="pt-2 text-sm text-muted-foreground">
                    {/* Items being completed */}
                    {((completeTestRuns && impactData.activeTestRuns > 0) ||
                      (completeSessions && impactData.activeSessions > 0) ||
                      impactData.descendantMilestonesToComplete > 0) && (
                      <>
                        <p>{t("milestones.completeDialog.confirmDescription")}</p>
                        <ul className="list-disc pl-5 mt-2 text-sm">
                          {completeTestRuns && impactData.activeTestRuns > 0 && (
                            <li>
                              {t("milestones.completeDialog.impactActiveTestRuns", {
                                count: impactData.activeTestRuns,
                              })}
                            </li>
                          )}
                          {completeSessions && impactData.activeSessions > 0 && (
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
                      </>
                    )}

                    {/* Items remaining active */}
                    {((!completeTestRuns && impactData.activeTestRuns > 0) ||
                      (!completeSessions && impactData.activeSessions > 0)) && (
                      <>
                        <p className="mt-4">{t("milestones.completeDialog.itemsRemaining")}</p>
                        <ul className="list-disc pl-5 mt-2 text-sm">
                          {!completeTestRuns && impactData.activeTestRuns > 0 && (
                            <li>
                              {t("milestones.completeDialog.impactActiveTestRuns", {
                                count: impactData.activeTestRuns,
                              })}
                            </li>
                          )}
                          {!completeSessions && impactData.activeSessions > 0 && (
                            <li>
                              {t("milestones.completeDialog.impactActiveSessions", {
                                count: impactData.activeSessions,
                              })}
                            </li>
                          )}
                        </ul>
                      </>
                    )}
                  </div>
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

                  {impactData && (
                    <div className="space-y-4">
                      {/* Test Runs Checkbox & Selector */}
                      {impactData.activeTestRuns > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="complete-test-runs"
                              checked={completeTestRuns}
                              onCheckedChange={(checked) => setCompleteTestRuns(!!checked)}
                              disabled={isSubmitting}
                            />
                            <label
                              htmlFor="complete-test-runs"
                              className="text-sm font-medium leading-none cursor-pointer"
                            >
                              {t("milestones.completeDialog.completeTestRunsLabel", {
                                count: impactData.activeTestRuns,
                              })}
                            </label>
                          </div>

                          {completeTestRuns && runWorkflows && runWorkflows.length > 0 && (
                            <div className="ml-6 space-y-2">
                              <label className="text-sm font-medium">
                                {t("milestones.completeDialog.testRunStateLabel")}
                              </label>
                              <Select
                                value={selectedTestRunStateId?.toString() || ""}
                                onValueChange={(value) => setSelectedTestRunStateId(Number(value))}
                                disabled={isSubmitting}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={tCommon("placeholders.selectState")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {runWorkflows.map((workflow) => (
                                    <SelectItem key={workflow.id} value={workflow.id.toString()}>
                                      <div className="flex items-center gap-2">
                                        <DynamicIcon
                                          name={workflow.icon?.name as IconName}
                                          color={workflow.color?.value}
                                          className="h-4 w-4"
                                        />
                                        {workflow.name}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Sessions Checkbox & Selector */}
                      {impactData.activeSessions > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="complete-sessions"
                              checked={completeSessions}
                              onCheckedChange={(checked) => setCompleteSessions(!!checked)}
                              disabled={isSubmitting}
                            />
                            <label
                              htmlFor="complete-sessions"
                              className="text-sm font-medium leading-none cursor-pointer"
                            >
                              {t("milestones.completeDialog.completeSessionsLabel", {
                                count: impactData.activeSessions,
                              })}
                            </label>
                          </div>

                          {completeSessions && sessionWorkflows && sessionWorkflows.length > 0 && (
                            <div className="ml-6 space-y-2">
                              <label className="text-sm font-medium">
                                {t("milestones.completeDialog.sessionStateLabel")}
                              </label>
                              <Select
                                value={selectedSessionStateId?.toString() || ""}
                                onValueChange={(value) => setSelectedSessionStateId(Number(value))}
                                disabled={isSubmitting}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={tCommon("placeholders.selectState")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {sessionWorkflows.map((workflow) => (
                                    <SelectItem key={workflow.id} value={workflow.id.toString()}>
                                      <div className="flex items-center gap-2">
                                        <DynamicIcon
                                          name={workflow.icon?.name as IconName}
                                          color={workflow.color?.value}
                                          className="h-4 w-4"
                                        />
                                        {workflow.name}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

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
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? t("milestones.completeDialog.processing")
                    : showConfirmation
                      ? t("milestones.completeDialog.confirmAndCompleteAll")
                      : t("common.actions.complete")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
