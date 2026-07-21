"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { PackagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { emptyEditorContent } from "~/app/constants";
import { MilestoneFormDialog } from "./MilestoneFormDialog";
import { ProjectSelectionDialog } from "./ProjectSelectionDialog";

export interface MilestoneFormData {
  name: string;
  milestoneTypeId: number;
  note: object;
  docs: object;
  isStarted: boolean;
  isCompleted: boolean;
  startedAt?: Date;
  completedAt?: Date;
  automaticCompletion: boolean;
  notifyDaysBefore: number;
}

const AddMilestonesToProjectsWizard = (): React.ReactElement => {
  const [step, setStep] = useState(0);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: createMilestones } =
    useClientQueries(schema).milestones.useCreate();
  const t = useTranslations("admin.milestones");

  const handleNextProjects = (projectIds: number[]) => {
    setSelectedProjectIds(projectIds);
    setStep(2);
  };

  const handlePrevious = () => {
    setStep((prev) => prev - 1);
  };

  const handleClose = () => {
    setStep(0);
    setSelectedProjectIds([]);
    setIsSubmitting(false);
  };

  const handleSubmit = async (formData: MilestoneFormData, userId: string) => {
    setIsSubmitting(true);
    try {
      // Create milestone in each selected project
      for (const projectId of selectedProjectIds) {
        await createMilestones({
          data: {
            project: {
              connect: { id: projectId },
            },
            name: formData.name,
            note: formData.note
              ? JSON.stringify(formData.note)
              : emptyEditorContent,
            docs: formData.docs
              ? JSON.stringify(formData.docs)
              : emptyEditorContent,
            isStarted: formData.isStarted,
            isCompleted: formData.isCompleted,
            startedAt: formData.startedAt,
            completedAt: formData.completedAt,
            automaticCompletion: formData.automaticCompletion,
            notifyDaysBefore: formData.notifyDaysBefore,
            createdAt: new Date(),
            creator: {
              connect: { id: userId },
            },
            milestoneType: {
              connect: { id: formData.milestoneTypeId },
            },
          },
        });
      }
      handleClose();
    } catch (error) {
      console.error("Error creating milestones:", error);
      setIsSubmitting(false);
      throw error;
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setStep(1)}
        type="button"
        aria-label={t("addMilestones")}
        className="group gap-0 transition-all duration-200 hover:gap-2"
      >
        <PackagePlus className="h-4 w-4" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
          {t("addMilestones")}
        </span>
      </Button>
      <ProjectSelectionDialog
        open={step === 1}
        onClose={handleClose}
        onNext={handleNextProjects}
      />
      <MilestoneFormDialog
        open={step === 2}
        onClose={handleClose}
        onPrevious={handlePrevious}
        onSubmit={handleSubmit}
        selectedProjectIds={selectedProjectIds}
        isSubmitting={isSubmitting}
      />
    </>
  );
};

export default AddMilestonesToProjectsWizard;
