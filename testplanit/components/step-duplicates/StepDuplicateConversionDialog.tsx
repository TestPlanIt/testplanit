"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import type { RepositoryCaseSource } from "~/zenstack/models";
import type { StepFormField } from "@/[locale]/projects/repository/[projectId]/StepsForm";
import StepsForm from "@/[locale]/projects/repository/[projectId]/StepsForm";

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

  const updateMatch = useClientQueries(schema).stepSequenceMatch.useUpdate();

  const matchId = match?.id ?? null;
  const firstMember = match?.members?.[0];

  // Every open starts from a clean slate: React Query hands back cached steps
  // by the same reference on a reopen, so state left over from the previous
  // visit would otherwise survive into this one.
  useEffect(() => {
    if (!open || !match) return;
    setCheckedCaseIds(new Set(match.members.map((m) => m.caseId)));
    setName("");
  }, [open, matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the canonical case's steps; the matched range is resolved below.
  const { data: caseSteps, isLoading: stepsLoading } = useClientQueries(
    schema
  ).steps.useFindMany(
    firstMember
      ? {
          where: { testCaseId: firstMember.caseId, isDeleted: false },
          orderBy: { order: "asc" },
        }
      : undefined,
    { enabled: open && !!firstMember }
  );

  // `startStepId`/`endStepId` mark the ends of the matched run in `order`
  // sequence, not in id sequence — a case whose steps were reordered or
  // inserted into can hold an end id lower than its start id. Slice by position
  // in the ordered list, the way the conversion endpoint resolves the range.
  const matchedSteps = useMemo(() => {
    if (!caseSteps || !firstMember) return null;
    const startIdx = caseSteps.findIndex(
      (s: { id: number }) => s.id === firstMember.startStepId
    );
    const endIdx = caseSteps.findIndex(
      (s: { id: number }) => s.id === firstMember.endStepId
    );
    if (startIdx < 0 || endIdx < 0) return [];
    const [from, to] =
      startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    return caseSteps.slice(from, to + 1);
  }, [caseSteps, firstMember?.startStepId, firstMember?.endStepId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The editor itself is loaded by StepsForm from the `steps` prop below —
  // it owns the field array and clears it on mount when that prop is absent,
  // so initialising it from here with form.reset() only races that clear.
  useEffect(() => {
    if (!open || !matchedSteps || matchedSteps.length === 0) return;
    const firstText = extractTextFromNode(matchedSteps[0].step) || "";
    if (firstText) {
      setName((prev) => prev || firstText.substring(0, 50));
    }
  }, [open, matchId, matchedSteps]);

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
          ) : matchedSteps && matchedSteps.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{t("stepsUnavailable")}</span>
            </div>
          ) : (
            <Form {...form}>
              <StepsForm
                control={form.control}
                name="steps"
                steps={matchedSteps ?? []}
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
                  hasParameters={(member.case as any).hasParameters}
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
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
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
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
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
