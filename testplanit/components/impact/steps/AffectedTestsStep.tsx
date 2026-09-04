"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import type {
  ImpactAnalysisCaseRow,
  ImpactAnalysisResultPayload,
} from "~/hooks/useImpactAnalysis";
import { Link } from "~/lib/navigation";
import type { AnalysisWarning, CaseTier } from "~/lib/services/impact/types";
import type { ImpactRepoConfig } from "../ImpactDialog";
import {
  groupReasonsByKind,
  ReasonBadges,
  reasonDetailLines,
} from "../ReasonBadges";
import { UncoveredFilesCallout } from "../UncoveredFilesCallout";

const TIER_KEY: Record<CaseTier, string> = {
  pinned: "affected.tierPinned",
  affected: "affected.tierAffected",
  related: "affected.tierRelated",
};

const TIER_VARIANT: Record<CaseTier, "default" | "secondary" | "outline"> = {
  pinned: "default",
  affected: "secondary",
  related: "outline",
};

export function warningCount(warning: AnalysisWarning): number | undefined {
  const detail = warning.detail ?? {};
  if (warning.code === "diff_truncated_by_budget") {
    const value = detail.omittedFileCount ?? detail.count;
    return typeof value === "number" ? value : 0;
  }
  if (warning.code === "ai_truncated") {
    const batches = detail.truncatedBatches;
    if (Array.isArray(batches)) return batches.length;
    const value = detail.count;
    return typeof value === "number" ? value : 0;
  }
  return undefined;
}

interface AffectedTestsStepProps {
  projectId: number;
  config: ImpactRepoConfig;
  cases: ImpactAnalysisCaseRow[];
  result: ImpactAnalysisResultPayload | null;
  selectedCaseIds: number[];
  onToggleCase: (caseId: number) => void;
  onSetSelection: (caseIds: number[]) => void;
  pinnedUncovered: Record<string, number>;
  onPinCreated: (path: string, caseId: number) => void;
}

export function AffectedTestsStep({
  projectId,
  config,
  cases,
  result,
  selectedCaseIds,
  onToggleCase,
  onSetSelection,
  pinnedUncovered,
  onPinCreated,
}: AffectedTestsStepProps) {
  const t = useTranslations("runs.impact");
  const locale = useLocale();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const affectedCount = cases.filter(
    (row) => row.tier === "pinned" || row.tier === "affected"
  ).length;
  const selected = new Set(selectedCaseIds);
  const allSelected =
    cases.length > 0 && cases.every((row) => selected.has(row.caseId));
  const someSelected = cases.some((row) => selected.has(row.caseId));
  const warnings = result?.warnings ?? [];
  const stalePins = result?.stalePins ?? [];
  const uncoveredFiles = result?.uncoveredFiles ?? [];

  const toggleExpanded = (caseId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  };

  return (
    <div className="space-y-4 py-2">
      <div>
        <h3
          className="text-sm font-semibold"
          data-testid="impact-affected-title"
        >
          {t("affected.title", { count: affectedCount })}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("affected.description")}
        </p>
      </div>

      {result?.summary && (
        <div
          className="max-h-32 overflow-y-auto rounded-md bg-muted/50 p-3 text-sm"
          data-testid="impact-summary"
        >
          <Label className="flex items-center gap-1 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5" />
            {t("affected.summary")}
          </Label>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
            {result.summary}
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <Alert data-testid="impact-warnings">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc space-y-0.5 ps-4">
              {warnings.map((warning, index) => {
                const count = warningCount(warning);
                return (
                  <li key={`${warning.code}-${index}`}>
                    {count === undefined
                      ? t(`warnings.${warning.code}`)
                      : t(`warnings.${warning.code}`, { count })}
                  </li>
                );
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {stalePins.length > 0 && (
        <Alert data-testid="impact-stale-pins">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {t("stale.title", { count: stalePins.length })}
          </AlertTitle>
          <AlertDescription>
            <p>{t("stale.description")}</p>
            <ul className="mt-2 space-y-1">
              {stalePins.map((pin) => (
                <li
                  key={pin.pinId}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Badge variant="outline">{pin.pinKind}</Badge>
                  <code className="font-mono text-xs">{pin.filePath}</code>
                  {pin.suggestedPath && (
                    <>
                      <span className="text-muted-foreground">{"→"}</span>
                      <code className="font-mono text-xs">
                        {pin.suggestedPath}
                      </code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {cases.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("noAffected.title")}</AlertTitle>
          <AlertDescription>{t("noAffected.description")}</AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : someSelected
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={() =>
                      onSetSelection(
                        allSelected ? [] : cases.map((row) => row.caseId)
                      )
                    }
                    aria-label={
                      allSelected
                        ? t("affected.selectNone")
                        : t("affected.selectAll")
                    }
                    data-testid="impact-select-all"
                  />
                </TableHead>
                <TableHead>{t("affected.case")}</TableHead>
                <TableHead className="w-20">{t("affected.score")}</TableHead>
                <TableHead className="w-28">
                  {t("affected.tierAffected")}
                </TableHead>
                <TableHead className="w-56">{t("affected.reasons")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((row) => {
                const isExpanded = expanded.has(row.caseId);
                const groups = groupReasonsByKind(row.reasons ?? []);
                return (
                  <Fragment key={row.caseId}>
                    <TableRow
                      data-testid={`impact-recommendation-${row.caseId}`}
                      data-selected={
                        selected.has(row.caseId) ? "true" : undefined
                      }
                    >
                      <TableCell className="py-2">
                        <Checkbox
                          checked={selected.has(row.caseId)}
                          onCheckedChange={() => onToggleCase(row.caseId)}
                          aria-label={row.case.name}
                          data-testid={`impact-recommendation-checkbox-${row.caseId}`}
                        />
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="min-w-0">
                          <Link
                            href={`/projects/repository/${projectId}/${row.caseId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {row.case.name}
                          </Link>
                          {row.case.folder && (
                            <p className="truncate text-xs text-muted-foreground">
                              {row.case.folder.name}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="font-mono">
                          {Math.round(row.score).toLocaleString(locale)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge variant={TIER_VARIANT[row.tier]}>
                          {t(TIER_KEY[row.tier])}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <ReasonBadges reasons={row.reasons ?? []} />
                      </TableCell>
                      <TableCell className="py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleExpanded(row.caseId)}
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? t("affected.hideDetails")
                              : t("affected.showDetails")
                          }
                          data-testid={`impact-recommendation-toggle-${row.caseId}`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow data-testid={`impact-rationale-${row.caseId}`}>
                        <TableCell colSpan={6} className="bg-muted/30 py-3">
                          <div className="space-y-2 text-sm">
                            {[...groups.entries()].map(([kind, reasons]) => {
                              const lines = reasonDetailLines(t, kind, reasons);
                              return (
                                <div
                                  key={kind}
                                  className="flex flex-wrap items-start gap-2"
                                  data-testid={`impact-reason-${row.caseId}-${kind}`}
                                >
                                  <ReasonBadges
                                    reasons={reasons}
                                    className="shrink-0"
                                  />
                                  <ul className="min-w-0 flex-1 space-y-0.5">
                                    {lines.map((line, index) => (
                                      <li
                                        key={index}
                                        className="flex flex-wrap items-center gap-2 break-words"
                                      >
                                        <span>{line.text}</span>
                                        {line.stale && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span>
                                                <Badge variant="destructive">
                                                  {t("stale.badge")}
                                                </Badge>
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-xs">
                                              {t("stale.tooltipAnalysis")}
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
                            {row.coveredFiles.length > 0 && (
                              <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
                                {row.coveredFiles.slice(0, 8).map((path) => (
                                  <li key={path} className="truncate">
                                    {path}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <UncoveredFilesCallout
        projectId={projectId}
        configId={config.id}
        repositoryId={config.repositoryId}
        files={uncoveredFiles}
        pinned={pinnedUncovered}
        onPinned={onPinCreated}
      />
    </div>
  );
}
