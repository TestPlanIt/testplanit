"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { CustomFieldDisplay } from "@/components/search/CustomFieldDisplay";
import { TagsListDisplay } from "@/components/tables/TagListDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TextFromJson from "@/components/TextFromJson";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { scoreToConfidence } from "~/lib/utils/similarity";

interface CaseDetails {
  id: number;
  name: string;
  createdAt: string;
  source: string | null;
  folder: { id: number; name: string } | null;
  steps: { id: number; step: string; expectedResult: string | null; order: number }[];
  tags: { id: number; name: string }[];
  caseFieldValues: { id: number; value: string; field: { id: number; displayName: string; fieldType?: string } }[];
  _count: { attachments: number };
  testRuns: { id: number; status: { id: number; name: string }; createdAt: string; testRun: { name: string } }[];
  projectId?: number;
}

interface CaseDetailsResponse {
  caseA: CaseDetails;
  caseB: CaseDetails;
}

export interface DuplicateComparisonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pair: {
    id: number;
    caseAId: number;
    caseBId: number;
    caseAName: string;
    caseBName: string;
    projectId: number;
    score: number;
    matchedFields: string[];
  } | null;
  onResolved: () => void;
}

function CasePanel({
  caseDetails,
  isSelected,
  onSelect,
  projectId,
  t,
  tCommon,
  tRepo,
}: {
  caseDetails: CaseDetails;
  isSelected: boolean;
  onSelect: () => void;
  projectId: number;
  t: ReturnType<typeof useTranslations<"repository.duplicates">>;
  tCommon: ReturnType<typeof useTranslations<"common">>;
  tRepo: ReturnType<typeof useTranslations<"repository">>;
}) {
  const lastRun = caseDetails.testRuns?.[0];

  // Map field values to CustomFieldDisplay format
  const customFields = caseDetails.caseFieldValues.map((fv) => ({
    fieldId: fv.field.id,
    fieldName: fv.field.displayName,
    fieldType: fv.field.fieldType ?? "Text String",
    value: fv.value,
  }));

  return (
    <div className="flex flex-col gap-2">
      {/* Primary badge outside the card */}
      <div className="h-6">
        {isSelected && (
          <Badge variant="default" className="text-xs">
            {t("selectedAsPrimary")}
          </Badge>
        )}
      </div>

      {/* Case card */}
      <div
        className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
          isSelected
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        }`}
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect();
        }}
      >
        <h3 className="font-bold text-base mb-3 break-words">{caseDetails.name}</h3>

        {/* Source + Folder + Created */}
        <div className="space-y-1 mb-3 text-sm">
          {caseDetails.source && (
            <div>
              <span className="font-medium text-muted-foreground">{t("sourceLabel")}{": "}</span>
              <span>{caseDetails.source}</span>
            </div>
          )}
          <div>
            <span className="font-medium text-muted-foreground">{tCommon("fields.folder")}{": "}</span>
            <span>{caseDetails.folder?.name ?? t("noFolder")}</span>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">{tCommon("fields.created")}{": "}</span>
            <DateFormatter date={caseDetails.createdAt} />
          </div>
        </div>

        {/* Steps */}
        <div className="mb-3">
          <p className="font-medium text-muted-foreground text-sm mb-1">{tCommon("fields.steps")}</p>
          {caseDetails.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{tRepo("fields.noSteps")}</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {caseDetails.steps.map((step, i) => (
                <div key={step.id ?? i} className="text-sm border-l-2 border-muted pl-2">
                  <div className="font-medium">
                    {`${i + 1}. `}
                    <TextFromJson
                      jsonString={step.step}
                      room={`compare-step-${caseDetails.id}-${step.id}`}
                    />
                  </div>
                  {step.expectedResult && (
                    <div className="text-muted-foreground text-xs mt-0.5">
                      <TextFromJson
                        jsonString={step.expectedResult}
                        room={`compare-er-${caseDetails.id}-${step.id}`}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="mb-3">
          <p className="font-medium text-muted-foreground text-sm mb-1">{tCommon("fields.tags")}</p>
          {caseDetails.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{tRepo("views.noTags")}</p>
          ) : (
            <TagsListDisplay tags={caseDetails.tags} projectId={projectId} />
          )}
        </div>

        {/* Field Values */}
        <div className="mb-3">
          <p className="font-medium text-muted-foreground text-sm mb-1">{t("fieldValuesLabel")}</p>
          {customFields.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">{t("noFieldValues")}</p>
          ) : (
            <CustomFieldDisplay customFields={customFields} maxItems={10} />
          )}
        </div>

        {/* Attachments */}
        <div className="mb-3 text-sm">
          <span className="font-medium text-muted-foreground">{tCommon("fields.attachments")}{": "}</span>
          <span>{caseDetails._count.attachments}</span>
        </div>

        {/* Last Run */}
        <div className="text-sm">
          <p className="font-medium text-muted-foreground mb-1">{t("lastRunLabel")}</p>
          {lastRun ? (
            <div>
              <span className="font-medium">{lastRun.testRun.name}</span>
              <span className="text-muted-foreground ml-2">
                {t("runStatusDate", { status: lastRun.status.name, date: new Date(lastRun.createdAt).toLocaleDateString() })}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground italic">{t("noLastRun")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DuplicateComparisonDialog({
  open,
  onOpenChange,
  pair,
  onResolved,
}: DuplicateComparisonDialogProps) {
  const t = useTranslations("repository.duplicates");
  const tCommon = useTranslations("common");
  const tRepo = useTranslations("repository");
  const [primaryId, setPrimaryId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeAction, setActiveAction] = useState<"merge" | "link" | "dismiss" | null>(null);

  const { data, isLoading, isError } = useQuery<CaseDetailsResponse>({
    queryKey: ["duplicate-case-details", pair?.caseAId, pair?.caseBId],
    queryFn: async () => {
      const res = await fetch(
        `/api/duplicate-scan/case-details?caseAId=${pair!.caseAId}&caseBId=${pair!.caseBId}`
      );
      if (!res.ok) throw new Error("Failed to fetch case details");
      return res.json();
    },
    enabled: open && pair !== null,
  });

  const confidence = pair ? scoreToConfidence(pair.score) : null;

  const handleResolve = async (action: "merge" | "link" | "dismiss") => {
    if (!pair) return;
    if (action === "merge" && primaryId === null) return;

    setIsSubmitting(true);
    setActiveAction(action);

    try {
      let body: Record<string, unknown>;
      if (action === "merge") {
        const victimId = primaryId === pair.caseAId ? pair.caseBId : pair.caseAId;
        body = { action: "merge", survivorId: primaryId, victimId, projectId: pair.projectId };
      } else if (action === "link") {
        body = { action: "link", caseAId: pair.caseAId, caseBId: pair.caseBId, projectId: pair.projectId };
      } else {
        body = { action: "dismiss", caseAId: pair.caseAId, caseBId: pair.caseBId, projectId: pair.projectId };
      }

      const res = await fetch("/api/duplicate-scan/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to resolve duplicate pair");
      }

      const result = await res.json();

      if (action === "merge") {
        toast.success(
          t("mergeSuccess", {
            runsTransferred: result.summary?.runsTransferred ?? 0,
            stepsAppended: result.summary?.stepsAppended ?? 0,
          })
        );
      } else if (action === "link") {
        toast.success(t("linkSuccess"));
      } else {
        toast.success(t("dismissSuccess"));
      }

      setPrimaryId(null);
      onResolved();
      onOpenChange(false);
    } catch {
      toast.error(t("resolveError"));
    } finally {
      setIsSubmitting(false);
      setActiveAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>
              {pair ? t("comparisonTitle", { caseA: pair.caseAName, caseB: pair.caseBName }) : ""}
            </span>
            {confidence && (
              <Badge
                variant={
                  confidence === "HIGH"
                    ? "destructive"
                    : confidence === "MEDIUM"
                      ? "default"
                      : "secondary"
                }
              >
                {confidence}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {t("comparisonDescription")}
          </DialogDescription>
          {pair && pair.matchedFields.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {pair.matchedFields.map((field) => (
                <Badge key={field} variant="outline" className="text-xs">
                  {field}
                </Badge>
              ))}
            </div>
          )}
        </DialogHeader>

        {/* Content area */}
        <div className="flex-1">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t("loadingDetails")}</span>
            </div>
          )}

          {isError && (
            <div className="text-center py-12 text-destructive text-sm">
              {t("caseDetailsError")}
            </div>
          )}

          {!isLoading && !isError && data && (
            <>
              <p className="text-xs text-muted-foreground mb-3">{t("selectPrimary")}</p>
              <div className="grid grid-cols-2 gap-4">
                <CasePanel
                  caseDetails={data.caseA}
                  isSelected={primaryId === data.caseA.id}
                  onSelect={() => setPrimaryId(data.caseA.id)}
                  projectId={pair!.projectId}
                  t={t}
                  tCommon={tCommon}
                  tRepo={tRepo}
                />
                <CasePanel
                  caseDetails={data.caseB}
                  isSelected={primaryId === data.caseB.id}
                  onSelect={() => setPrimaryId(data.caseB.id)}
                  projectId={pair!.projectId}
                  t={t}
                  tCommon={tCommon}
                  tRepo={tRepo}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between pt-4 border-t mt-4">
          <Button
            variant="outline"
            onClick={() => handleResolve("dismiss")}
            disabled={isSubmitting || isLoading}
          >
            {isSubmitting && activeAction === "dismiss" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("dismissing")}
              </>
            ) : (
              t("dismissButton")
            )}
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleResolve("link")}
              disabled={isSubmitting || isLoading}
            >
              {isSubmitting && activeAction === "link" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("linking")}
                </>
              ) : (
                t("linkButton")
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleResolve("merge")}
              disabled={isSubmitting || isLoading || primaryId === null}
            >
              {isSubmitting && activeAction === "merge" ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("merging")}
                </>
              ) : (
                t("mergeButton")
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
