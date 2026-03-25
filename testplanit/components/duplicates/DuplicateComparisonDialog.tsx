"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { UserDisplay } from "@/components/search/UserDisplay";
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
import { ExternalLink, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { scoreToConfidence } from "~/lib/utils/similarity";

interface CaseDetails {
  id: number;
  name: string;
  createdAt: string;
  source: string | null;
  automated: boolean;
  creator: { id: string; name: string | null; image: string | null } | null;
  folder: { id: number; name: string } | null;
  steps: {
    id: number;
    step: string;
    expectedResult: string | null;
    order: number;
  }[];
  tags: { id: number; name: string }[];
  template?: {
    caseFields: Array<{
      caseFieldId: number;
      order: number;
      caseField: { type: { type: string } };
    }>;
  } | null;
  caseFieldValues: {
    id: number;
    value: any;
    field: {
      id: number;
      displayName: string;
      type?: { type: string };
      fieldOptions?: Array<{
        fieldOption: {
          id: number;
          name: string;
          icon?: { name: string } | null;
          iconColor?: { value: string } | null;
        };
      }>;
    };
  }[];
  _count: { attachments: number };
  testRuns: {
    id: number;
    status: { id: number; name: string } | null;
    createdAt: string;
    testRun: { name: string } | null;
  }[];
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
  testId,
}: {
  caseDetails: CaseDetails;
  isSelected: boolean;
  onSelect: () => void;
  projectId: number;
  t: ReturnType<typeof useTranslations<"repository.duplicates">>;
  tCommon: ReturnType<typeof useTranslations<"common">>;
  tRepo: ReturnType<typeof useTranslations<"repository">>;
  testId?: string;
}) {
  const { data: session } = useSession();
  const prefs = session?.user.preferences;
  const dateTimeFormat =
    prefs?.dateFormat && prefs?.timeFormat
      ? `${prefs.dateFormat} ${prefs.timeFormat}`
      : prefs?.dateFormat;
  const lastRun = caseDetails.testRuns?.[0];

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
        data-testid={testId}
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
        <div className="mb-1 text-xs text-muted-foreground">
          {tCommon("fields.id")}
          {": "}
          {caseDetails.id}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <CaseDisplay
            id={caseDetails.id}
            name={caseDetails.name}
            source={caseDetails.source as any}
            automated={caseDetails.automated}
            size="large"
          />
          <a
            href={`/projects/repository/${projectId}/${caseDetails.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={t("viewCaseDetails")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* Source + Folder + Created */}
        <div className="space-y-1 mb-3 text-sm">
          {caseDetails.source && (
            <div>
              <span className="font-medium text-muted-foreground">
                {t("sourceLabel")}
                {": "}
              </span>
              <span>{caseDetails.source}</span>
            </div>
          )}
          <div>
            <span className="font-medium text-muted-foreground">
              {tCommon("fields.folder")}
              {": "}
            </span>
            <span>{caseDetails.folder?.name ?? t("noFolder")}</span>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">
              {tCommon("fields.created")}
              {": "}
            </span>
            <DateFormatter
              date={caseDetails.createdAt}
              formatString={dateTimeFormat}
              timezone={prefs?.timezone}
            />
          </div>
          {caseDetails.creator && (
            <div>
              <UserDisplay
                userId={caseDetails.creator.id}
                userName={caseDetails.creator.name ?? undefined}
                userImage={caseDetails.creator.image}
                prefix={tCommon("fields.createdBy")}
                size="small"
              />
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="mb-3">
          <p className="font-medium text-muted-foreground text-sm mb-1">
            {tCommon("fields.tags")}
          </p>
          {caseDetails.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {tRepo("views.noTags")}
            </p>
          ) : (
            <TagsListDisplay tags={caseDetails.tags} projectId={projectId} />
          )}
        </div>

        {/* All fields in template order (including Steps) */}
        <div className="mb-3 space-y-3">
          {(caseDetails.template?.caseFields ?? []).map((templateField) => {
            const fieldType = templateField.caseField.type.type;

            // Steps field — render the case's steps array
            if (fieldType === "Steps") {
              return (
                <div key={`steps-${templateField.caseFieldId}`}>
                  <p className="font-medium text-muted-foreground text-sm mb-1">
                    {tCommon("fields.steps")}
                  </p>
                  {caseDetails.steps.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">
                      {tRepo("fields.noSteps")}
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {caseDetails.steps.map((step, i) => (
                        <div
                          key={step.id ?? i}
                          className="text-sm border-l-2 border-muted pl-2"
                        >
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
              );
            }

            // Regular field — find the value
            const fv = caseDetails.caseFieldValues.find(
              (v) => v.field.id === templateField.caseFieldId
            );
            if (!fv || fv.value == null) return null;

            const options = (fv.field.fieldOptions ?? []).map(
              (a) => a.fieldOption
            );

            return (
              <div key={fv.id} className="text-sm">
                <span className="font-medium text-muted-foreground">
                  {fv.field.displayName}
                  {": "}
                </span>
                {fieldType === "Text Long" ? (
                  <TextFromJson
                    jsonString={fv.value}
                    room={`compare-field-${caseDetails.id}-${fv.id}`}
                  />
                ) : fieldType === "Checkbox" ? (
                  <span>{fv.value ? "✓" : "✗"}</span>
                ) : fieldType === "Dropdown" ? (
                  <span>
                    {options.find((o) => o.id === Number(fv.value))?.name ??
                      String(fv.value)}
                  </span>
                ) : fieldType === "Multi-Select" ? (
                  <span>
                    {(Array.isArray(fv.value) ? fv.value : [])
                      .map(
                        (id: number) =>
                          options.find((o) => o.id === id)?.name ?? String(id)
                      )
                      .join(", ")}
                  </span>
                ) : fieldType === "Link" ? (
                  <a
                    href={String(fv.value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {String(fv.value)}
                  </a>
                ) : fieldType === "Date" ? (
                  <DateFormatter
                    date={String(fv.value)}
                    formatString={dateTimeFormat}
                    timezone={prefs?.timezone}
                  />
                ) : (
                  <span>{String(fv.value)}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Attachments */}
        <div className="mb-3 text-sm">
          <span className="font-medium text-muted-foreground">
            {tCommon("fields.attachments")}
            {": "}
          </span>
          <span>{caseDetails._count.attachments}</span>
        </div>

        {/* Last Run */}
        <div className="text-sm">
          <p className="font-medium text-muted-foreground mb-1">
            {t("lastRunLabel")}
          </p>
          {lastRun ? (
            <div>
              <span className="font-medium">{lastRun.testRun?.name ?? ""}</span>
              <span className="text-muted-foreground ml-2">
                {lastRun.status?.name ?? ""}
                {" — "}
                <DateFormatter
                  date={lastRun.createdAt}
                  formatString={dateTimeFormat}
                  timezone={prefs?.timezone}
                />
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
  const [activeAction, setActiveAction] = useState<
    "merge" | "link" | "dismiss" | null
  >(null);

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
        const victimId =
          primaryId === pair.caseAId ? pair.caseBId : pair.caseAId;
        body = {
          action: "merge",
          survivorId: primaryId,
          victimId,
          projectId: pair.projectId,
        };
      } else if (action === "link") {
        body = {
          action: "link",
          caseAId: pair.caseAId,
          caseBId: pair.caseBId,
          projectId: pair.projectId,
        };
      } else {
        body = {
          action: "dismiss",
          caseAId: pair.caseAId,
          caseBId: pair.caseBId,
          projectId: pair.projectId,
        };
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
      <DialogContent
        data-testid="comparison-dialog"
        className="max-w-5xl max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>
              {pair
                ? t("comparisonTitle", {
                    caseA: pair.caseAName,
                    caseB: pair.caseBName,
                  })
                : ""}
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
          <DialogDescription>{t("comparisonDescription")}</DialogDescription>
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
              <p className="text-xs text-muted-foreground mb-3">
                {t("selectPrimary")}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <CasePanel
                  caseDetails={data.caseA}
                  isSelected={primaryId === data.caseA.id}
                  onSelect={() => setPrimaryId(data.caseA.id)}
                  projectId={pair!.projectId}
                  t={t}
                  tCommon={tCommon}
                  tRepo={tRepo}
                  testId="case-panel-a"
                />
                <CasePanel
                  caseDetails={data.caseB}
                  isSelected={primaryId === data.caseB.id}
                  onSelect={() => setPrimaryId(data.caseB.id)}
                  projectId={pair!.projectId}
                  t={t}
                  tCommon={tCommon}
                  tRepo={tRepo}
                  testId="case-panel-b"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between pt-4 border-t mt-4">
          <Button
            data-testid="dismiss-button"
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
              data-testid="link-button"
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
              data-testid="merge-button"
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
