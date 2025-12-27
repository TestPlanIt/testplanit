"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateSharedStepGroup,
  useCreateManySharedStepItem,
} from "~/lib/hooks";
import { useSession } from "next-auth/react";
import { FormProvider, useForm } from "react-hook-form";
import StepsForm from "~/app/[locale]/projects/repository/[projectId]/StepsForm";
import type { StepFormField } from "~/app/[locale]/projects/repository/[projectId]/StepsForm";
import { emptyEditorContent } from "~/app/constants";

interface ManualSharedStepsDialogProps {
  onComplete?: () => void;
}

export function ManualSharedStepsDialog({
  onComplete,
}: ManualSharedStepsDialogProps) {
  const t = useTranslations("sharedSteps");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { data: session } = useSession();

  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const createSharedStepGroupMutation = useCreateSharedStepGroup();
  const createManySharedStepItemMutation = useCreateManySharedStepItem();

  // Initialize form with one empty step
  const form = useForm<{ steps: StepFormField[] }>({
    defaultValues: {
      steps: [
        {
          id: "step-1",
          step: JSON.stringify(emptyEditorContent),
          expectedResult: JSON.stringify(emptyEditorContent),
        },
      ],
    },
  });

  const handleSave = async () => {
    if (!groupName.trim()) {
      toast.error(t("manualEntry.errors.groupNameRequired"));
      return;
    }

    const steps = form.getValues("steps");
    if (!steps || steps.length === 0) {
      toast.error(t("manualEntry.errors.stepsRequired"));
      return;
    }

    if (!session?.user?.id) {
      toast.error(tCommon("errors.unauthorized"));
      return;
    }

    setIsSaving(true);
    try {
      // Create the shared step group
      const newGroup = await createSharedStepGroupMutation.mutateAsync({
        data: {
          name: groupName,
          projectId: projectId,
          createdById: session.user.id,
        },
      });

      if (!newGroup || !newGroup.id) {
        throw new Error("Failed to create shared step group");
      }

      // Create the shared step items
      const itemsToCreate = steps.map((step, index) => ({
        step:
          typeof step.step === "string"
            ? step.step
            : JSON.stringify(step.step || emptyEditorContent),
        expectedResult:
          typeof step.expectedResult === "string"
            ? step.expectedResult
            : JSON.stringify(step.expectedResult || emptyEditorContent),
        order: index,
        sharedStepGroupId: newGroup.id,
      }));

      await createManySharedStepItemMutation.mutateAsync({
        data: itemsToCreate,
      });

      toast.success(t("manualEntry.success"));

      // Reset form
      setGroupName("");
      form.reset({
        steps: [
          {
            id: "step-1",
            step: JSON.stringify(emptyEditorContent),
            expectedResult: JSON.stringify(emptyEditorContent),
          },
        ],
      });

      setOpen(false);

      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error("Error creating shared steps:", error);
      toast.error(t("manualEntry.errors.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setGroupName("");
    form.reset({
      steps: [
        {
          id: "step-1",
          step: JSON.stringify(emptyEditorContent),
          expectedResult: JSON.stringify(emptyEditorContent),
        },
      ],
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full"
          data-testid="manual-shared-steps-btn"
        >
          <PlusCircle className="h-4 w-4" />
          {t("manualEntry.buttonLabel")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {tGlobal("repository.steps.addSharedSteps")}
          </DialogTitle>
          <DialogDescription>{t("manualEntry.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">
              {t("manualEntry.groupNameLabel")}
            </Label>
            <Input
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t("manualEntry.groupNamePlaceholder")}
              data-testid="manual-group-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label>{tGlobal("common.fields.steps")}</Label>
            <FormProvider {...form}>
              <StepsForm
                control={form.control}
                name="steps"
                steps={form.getValues("steps")}
                readOnly={false}
                projectId={projectId}
                onSharedStepCreated={undefined}
                hideSharedStepsButtons={true}
              />
            </FormProvider>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !groupName.trim()}
            data-testid="save-manual-shared-steps-btn"
          >
            {isSaving ? tCommon("actions.saving") : tCommon("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
