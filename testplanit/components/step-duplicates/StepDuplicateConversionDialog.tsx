"use client";

import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { useUpdateStepSequenceMatch } from "~/lib/hooks/step-sequence-match";
import { useFindManySteps } from "~/lib/hooks/steps";
import type { RepositoryCaseSource } from "@prisma/client";
import type { StepFormField } from "@/[locale]/projects/repository/[projectId]/StepsForm";
import StepsForm from "@/[locale]/projects/repository/[projectId]/StepsForm";
import { emptyEditorContent } from "~/app/constants";

interface MatchMember {
  id: number;
  caseId: number;
  startStepId: number;
  endStepId: number;
  case: {
    id: number;
    name: string;
    source: RepositoryCaseSource;
    automated: boolean;
  };
}

interface StepDuplicateConversionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: {
    id: number;
    fingerprint: string;
    stepCount: number;
    projectId: number;
    members: MatchMember[];
  } | null;
  onResolved: () => void;
}

function parseTipTapJson(value: unknown): object {
  if (typeof value === "object" && value !== null) return value as object;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return emptyEditorContent;
    }
  }
  return emptyEditorContent;
}

interface StepsFormValues {
  steps: StepFormField[];
}

export function StepDuplicateConversionDialog({
  open,
  onOpenChange,
  match,
  onResolved,
}: StepDuplicateConversionDialogProps) {
  const t = useTranslations("sharedSteps.stepDuplicates.dialog");

  const [name, setName] = useState("");
  const [checkedCaseIds, setCheckedCaseIds] = useState<Set<number>>(new Set());
  const [isConverting, setIsConverting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const form = useForm<StepsFormValues>({
    defaultValues: { steps: [] },
  });

  const updateMatch = useUpdateStepSequenceMatch();

  // Initialize state when match changes
  useEffect(() => {
    if (match) {
      setCheckedCaseIds(new Set(match.members.map((m) => m.caseId)));
    }
  }, [match]);

  const firstMember = match?.members?.[0];

  // Fetch steps for preview from the first member's range
  const { data: stepsData, isLoading: stepsLoading } = useFindManySteps(
    firstMember
      ? {
          where: {
            id: { gte: firstMember.startStepId, lte: firstMember.endStepId },
            testCaseId: firstMember.caseId,
            isDeleted: false,
          },
          orderBy: { order: "asc" },
        }
      : undefined,
    { enabled: open && !!firstMember }
  );

  // Initialize form steps from fetched data
  useEffect(() => {
    if (stepsData && stepsData.length > 0) {
      const formSteps: StepFormField[] = stepsData.map((s: any) => ({
        step: parseTipTapJson(s.step),
        expectedResult: parseTipTapJson(s.expectedResult),
      }));
      form.reset({ steps: formSteps });

      // Auto-suggest name from first step's text
      if (!name) {
        const firstText = extractTextFromNode(stepsData[0].step) || "";
        if (firstText) {
          setName(firstText.substring(0, 50));
        }
      }
    }
  }, [stepsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCaseToggle = (caseId: number, checked: boolean) => {
    setCheckedCaseIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(caseId);
      } else {
        next.delete(caseId);
      }
      return next;
    });
  };

  const handleDismiss = async () => {
    if (!match) return;
    setIsDismissing(true);
    try {
      await updateMatch.mutateAsync({
        where: { id: match.id },
        data: { status: "DISMISSED" },
      });
      toast.success(t("dismissSuccess"));
      onResolved();
      onOpenChange(false);
    } catch {
      toast.error(t("dismissError"));
    } finally {
      setIsDismissing(false);
    }
  };

  const handleConvert = async () => {
    if (!match) return;
    if (!name.trim() || checkedCaseIds.size === 0) return;

    setIsConverting(true);
    try {
      // Read current steps from the form
      const currentSteps = form.getValues("steps");

      // Always send the full step set as TipTap JSON — the user may have
      // edited, added, or deleted steps via the StepsForm editor.
      const editedStepsPayload = currentSteps.map((s) => ({
        step: s.step ? JSON.stringify(s.step) : null,
        expectedResult: s.expectedResult
          ? JSON.stringify(s.expectedResult)
          : null,
      }));

      const res = await fetch("/api/step-scan/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          sharedStepGroupName: name.trim(),
          affectedCaseIds: Array.from(checkedCaseIds),
          editedSteps: editedStepsPayload,
        }),
      });

      if (!res.ok) {
        throw new Error("Conversion failed");
      }

      const result = await res.json();

      if (result.skippedCaseIds?.length > 0) {
        toast.warning(
          t("skippedWarning", { count: result.skippedCaseIds.length })
        );
      }

      toast.success(t("convertSuccess"), {
        action: {
          label: t("viewSharedStep"),
          onClick: () => {
            window.open(
              `/projects/shared-steps/${match.projectId}?groupId=${result.sharedStepGroupId}`,
              "_blank"
            );
          },
        },
      });

      onResolved();
      onOpenChange(false);
    } catch {
      toast.error(t("convertError"));
    } finally {
      setIsConverting(false);
    }
  };

  const canConvert = name.trim().length > 0 && checkedCaseIds.size > 0;
  const isProcessing = isConverting || isDismissing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl overflow-y-auto"
        data-testid="step-conversion-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {/* Step editor section — reuses the existing StepsForm */}
        <div>
          <h3 className="font-semibold text-sm mb-2">{t("previewTitle")}</h3>
          {stepsLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <Form {...form}>
              <StepsForm
                control={form.control}
                name="steps"
                projectId={match?.projectId ?? 0}
                hideSharedStepsButtons
              />
            </Form>
          )}
        </div>

        {/* Affected cases section */}
        <div>
          <h3 className="font-semibold text-sm mb-1">{t("casesTitle")}</h3>
          <p className="text-xs text-muted-foreground mb-2">
            {t("casesDescription")}
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
            {match && match.members.length > 1 && (
              <Label className="flex items-center gap-2 px-1 py-0.5 border-b pb-2 mb-1 cursor-pointer w-fit">
                <Checkbox
                  id="select-all-cases"
                  checked={
                    checkedCaseIds.size === match.members.length
                      ? true
                      : checkedCaseIds.size > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setCheckedCaseIds(
                        new Set(match.members.map((m) => m.caseId))
                      );
                    } else {
                      setCheckedCaseIds(new Set());
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {t("selectAll")}
                </span>
              </Label>
            )}
            {match?.members.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 hover:bg-muted/50 rounded px-1 py-0.5"
              >
                <Checkbox
                  checked={checkedCaseIds.has(member.caseId)}
                  onCheckedChange={(checked) =>
                    handleCaseToggle(member.caseId, !!checked)
                  }
                />
                <CaseDisplay
                  id={member.case.id}
                  name={member.case.name}
                  source={member.case.source}
                  automated={member.case.automated}
                  link={`/projects/repository/${match.projectId}/${member.caseId}`}
                  linkTarget="_blank"
                  maxLines={2}
                />
              </div>
            ))}
          </div>
          {checkedCaseIds.size === 0 && (
            <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              <span>{t("noCasesSelected")}</span>
            </div>
          )}
        </div>

        {/* Name input section */}
        <div>
          <Label htmlFor="shared-step-name" className="text-sm font-semibold">
            {t("nameLabel")}
          </Label>
          <Input
            id="shared-step-name"
            className="mt-1"
            data-testid="shared-step-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
          />
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={handleDismiss}
            disabled={isProcessing}
            data-testid="step-dismiss-button"
          >
            {isDismissing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("dismissing")}
              </>
            ) : (
              t("dismissMatch")
            )}
          </Button>
          <Button
            variant="default"
            onClick={handleConvert}
            disabled={isProcessing || !canConvert}
            data-testid="step-convert-button"
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("converting")}
              </>
            ) : (
              t("title")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
