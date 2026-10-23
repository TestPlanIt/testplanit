"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { parseRiskReasons } from "~/lib/schemas/riskReasons";
import { RISK_COMPONENT_KEYS } from "~/lib/schemas/riskWeights";
import { cn } from "~/utils";

function scoreClasses(score: number): string {
  if (score >= 70) return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (score >= 40) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
}

/**
 * The repository list's Risk Score cell: the number, colored by band, with
 * the persisted per-component breakdown (riskReasons) in a popover.
 */
export function RiskScoreCell({
  score,
  reasons,
}: {
  score: number | null;
  reasons: unknown;
}) {
  const t = useTranslations("risk");

  if (score == null) {
    return (
      <span
        className="text-muted-foreground"
        title={t("notScored")}
        data-testid="risk-score-empty"
      >
        {"—"}
      </span>
    );
  }

  const parsed = parseRiskReasons(reasons);
  const components = new Map(
    (parsed?.components ?? []).map((component) => [component.key, component])
  );
  const facts = parsed?.facts ?? null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-w-9 cursor-pointer items-center justify-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
            scoreClasses(score)
          )}
          aria-label={t("score")}
          data-testid="risk-score-badge"
        >
          {Math.round(score)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t("breakdown.title")}</p>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
                scoreClasses(score)
              )}
            >
              {Math.round(score)}
            </span>
          </div>
          <div className="space-y-2">
            {RISK_COMPONENT_KEYS.map((key) => {
              const component = components.get(key);
              const raw = component?.raw ?? 0;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span>{t(`breakdown.components.${key}`)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {t("breakdown.pointsOfWeight", {
                        points: component?.points ?? 0,
                        weight: component?.weight ?? 0,
                      })}
                    </span>
                  </div>
                  <Progress value={Math.round(raw * 100)} className="h-1.5" />
                </div>
              );
            })}
          </div>
          {facts && (
            <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
              <p>
                {facts.lastExecutedAt ? (
                  <>
                    {t("breakdown.lastExecuted")}{" "}
                    <DateFormatter
                      date={facts.lastExecutedAt}
                      tooltip={false}
                    />
                  </>
                ) : (
                  t("breakdown.neverExecuted")
                )}
              </p>
              {facts.verdictsSampled > 0 && (
                <p>
                  {t("breakdown.verdicts", {
                    failed: facts.failCount,
                    sampled: facts.verdictsSampled,
                    flips: facts.flips,
                  })}
                </p>
              )}
              {facts.requirementCount > 0 && (
                <p>
                  {t("breakdown.requirements", {
                    count: facts.requirementCount,
                    priority:
                      facts.topRequirementPriority ?? t("breakdown.noPriority"),
                  })}
                </p>
              )}
              {facts.suspectLinkCount > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  {t("breakdown.suspect", { count: facts.suspectLinkCount })}
                </p>
              )}
              {facts.defectCount > 0 && (
                <p>
                  {t("breakdown.defects", {
                    count: facts.defectCount,
                    priority:
                      facts.topDefectPriority ?? t("breakdown.noPriority"),
                  })}
                </p>
              )}
              {facts.caseCriticality && (
                <p>
                  {t("breakdown.caseCriticality", {
                    value: facts.caseCriticality,
                  })}
                </p>
              )}
              {facts.quarantined && (
                <Badge variant="outline" className="text-xs">
                  {t("breakdown.quarantined")}
                </Badge>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
