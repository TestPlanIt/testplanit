"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShieldAlert, Sparkles, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
  FailureClassificationSource,
  FailureSignatureStatus,
} from "~/zenstack/models";
import { cn } from "~/utils";

/** A catalogue entry as the badges need it (the `classification` relation). */
export interface ClassificationRef {
  id: number;
  name: string;
  color?: { value: string } | null;
  isDeleted?: boolean;
}

export function ClassificationBadge({
  classification,
  source,
  className,
}: {
  classification: ClassificationRef | null | undefined;
  source?: FailureClassificationSource | null;
  className?: string;
}) {
  const t = useTranslations("triage");
  const live =
    classification && !classification.isDeleted ? classification : null;
  const isAi = !!live && source === "AI";
  const color = live?.color?.value;
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 whitespace-nowrap font-normal",
        !live && "text-muted-foreground",
        className
      )}
      style={color ? { borderColor: color, color } : undefined}
      data-testid="triage-classification-badge"
    >
      {isAi && <Sparkles className="h-3 w-3" aria-hidden />}
      {live ? live.name : t("unclassified")}
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

/** Swatch + name, for pickers and the admin catalogue. */
export function ClassificationOption({
  classification,
  className,
}: {
  classification: ClassificationRef;
  className?: string;
}) {
  const color = classification.color?.value;
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        className="h-3 w-3 shrink-0 rounded-full border"
        style={
          color ? { backgroundColor: color, borderColor: color } : undefined
        }
        aria-hidden
      />
      <span className="min-w-0 truncate" title={classification.name}>
        {classification.name}
      </span>
    </span>
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
            "gap-1 whitespace-nowrap font-normal text-amber-700 dark:text-amber-400",
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

export function QuarantinedBadge({ className }: { className?: string }) {
  const t = useTranslations("triage");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ShieldAlert
          className={cn(
            "inline h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400",
            className
          )}
          aria-label={t("quarantine.label")}
          data-testid="triage-quarantined-badge"
        />
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{t("quarantine.label")}</div>
        {t("quarantine.hint")
          .split(/(?<=\.)\s+/)
          .map((sentence) => (
            <div key={sentence} className="text-xs opacity-90">
              {sentence}
            </div>
          ))}
      </TooltipContent>
    </Tooltip>
  );
}
