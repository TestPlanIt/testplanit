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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import TextFromJson from "@/components/TextFromJson";
import { useUpdateStepSequenceMatch } from "~/lib/hooks/step-sequence-match";
import { useFindManySteps } from "~/lib/hooks/steps";

interface MatchMember {
  id: number;
  caseId: number;
  startStepId: number;
  endStepId: number;
  case: {
    id: number;
    name: string;
    source: string | null;
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

export function StepDuplicateConversionDialog({
  open,
  onOpenChange,
  match,
  onResolved,
}: StepDuplicateConversionDialogProps) {
  const t = useTranslations("sharedSteps.stepDuplicates.dialog");

  const autoName = useMemo(() => {
    if (!match) return "";
    return match.fingerprint.split("\n")[0].substring(0, 50);
  }, [match]);

  const [name, setName] = useState(autoName);
  const [checkedCaseIds, setCheckedCaseIds] = useState<Set<number>>(new Set());
  const [isConverting, setIsConverting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const updateMatch = useUpdateStepSequenceMatch();

  // Initialize state when match changes
  useEffect(() => {
    if (match) {
      setName(match.fingerprint.split("\n")[0].substring(0, 50));
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
      const res = await fetch("/api/step-scan/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          sharedStepGroupName: name.trim(),
          affectedCaseIds: Array.from(checkedCaseIds),
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {/* Step preview section */}
        <div>
          <h3 className="font-semibold text-sm mb-2">{t("previewTitle")}</h3>
          {stepsLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : stepsData && stepsData.length > 0 ? (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-2 w-8 font-medium text-muted-foreground">
                      #
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      {t("stepHeader")}
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                      {t("expectedResultHeader")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stepsData.map((step, i) => (
                    <tr key={step.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-muted-foreground font-medium">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2">
                        {step.step ? (
                          <TextFromJson
                            jsonString={step.step as string}
                            room={`conv-step-${step.id}`}
                          />
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {step.expectedResult ? (
                          <TextFromJson
                            jsonString={step.expectedResult as string}
                            room={`conv-er-${step.id}`}
                          />
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Affected cases section */}
        <div>
          <h3 className="font-semibold text-sm mb-1">{t("casesTitle")}</h3>
          <p className="text-xs text-muted-foreground mb-2">
            {t("casesDescription")}
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-2">
            {match?.members.map((member) => (
              <label
                key={member.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
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
                  source={member.case.source as any}
                  automated={member.case.automated}
                />
              </label>
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
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("converting")}
              </>
            ) : (
              t("convert")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
