"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sparkles, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  FailureClassification,
  FailureClassificationSource,
  FailureSignatureStatus,
} from "~/zenstack/models";
import { cn } from "~/utils";

const CLASSIFICATION_CLASS: Record<FailureClassification, string> = {
  UNCLASSIFIED: "text-muted-foreground",
  PRODUCT_BUG: "border-destructive/40 text-destructive",
  TEST_BUG: "border-warning/60 text-warning",
  ENVIRONMENT: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  FLAKY: "border-amber-500/40 text-amber-600 dark:text-amber-400",
};

export function ClassificationBadge({
  classification,
  source,
  className,
}: {
  classification: FailureClassification;
  source?: FailureClassificationSource | null;
  className?: string;
}) {
  const t = useTranslations("triage");
  const isAi = source === "AI";
  const label = t(`classification.${classification}`);
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 whitespace-nowrap font-normal",
        CLASSIFICATION_CLASS[classification],
        className
      )}
      data-testid="triage-classification-badge"
    >
      {isAi && <Sparkles className="h-3 w-3" aria-hidden />}
      {label}
    </Badge>
  );
  if (!isAi) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{t("source.AI")}</TooltipContent>
    </Tooltip>
  );
}

const STATUS_VARIANT: Record<
  FailureSignatureStatus,
  "default" | "secondary" | "outline"
> = {
  OPEN: "default",
  RESOLVED: "secondary",
  IGNORED: "outline",
};

export function SignatureStatusBadge({
  status,
  className,
}: {
  status: FailureSignatureStatus;
  className?: string;
}) {
  const t = useTranslations("triage");
  return (
    <Badge
      variant={STATUS_VARIANT[status]}
      className={cn("whitespace-nowrap", className)}
      data-testid="triage-status-badge"
    >
      {t(`status.${status}`)}
    </Badge>
  );
}

export function FlakyCandidateBadge({ className }: { className?: string }) {
  const t = useTranslations("triage");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 whitespace-nowrap font-normal text-amber-600 dark:text-amber-400",
            className
          )}
        >
          <Zap className="h-3 w-3" aria-hidden />
          {t("flakyCandidate")}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t("flakyCandidateHint")}</TooltipContent>
    </Tooltip>
  );
}

export function KnownIssueBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const t = useTranslations("triage");
  if (count === 0) return null;
  return (
    <Badge
      variant="secondary"
      className={cn("whitespace-nowrap font-normal", className)}
      data-testid="triage-known-issue-badge"
    >
      {t("knownIssue")}
      {count > 1 ? ` ×${count}` : ""}
    </Badge>
  );
}
