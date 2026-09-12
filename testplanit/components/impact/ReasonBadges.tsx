"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  History,
  Link2,
  Pin,
  SearchCode,
  Sparkles,
  Ticket,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import type {
  IssueReason,
  PathReason,
  PinReason,
  ReasonKind,
  SelectionReason,
} from "~/lib/services/impact/types";
import { cn } from "~/utils";

type Translator = (
  key: string,
  values?: Record<string, string | number | Date>
) => string;

export const REASON_KIND_ORDER: ReasonKind[] = [
  "PIN",
  "ISSUE",
  "PATH",
  "HISTORY",
  "AI",
  "LINKED",
];

const REASON_LABEL_KEY: Record<ReasonKind, string> = {
  PIN: "reasons.pin",
  ISSUE: "reasons.issue",
  PATH: "reasons.path",
  HISTORY: "reasons.history",
  AI: "reasons.ai",
  LINKED: "reasons.linked",
};

const REASON_ICON: Record<ReasonKind, ComponentType<{ className?: string }>> = {
  PIN: Pin,
  ISSUE: Ticket,
  PATH: SearchCode,
  HISTORY: History,
  AI: Sparkles,
  LINKED: Link2,
};

const REASON_VARIANT: Record<ReasonKind, "default" | "secondary" | "outline"> =
  {
    PIN: "default",
    ISSUE: "secondary",
    PATH: "secondary",
    HISTORY: "outline",
    AI: "outline",
    LINKED: "outline",
  };

function pathFieldKey(field: PathReason["matchedField"]): string {
  switch (field) {
    case "es.searchableContent":
      return "reasons.fieldContent";
    case "db.tag":
      return "reasons.fieldTag";
    case "db.folder":
      return "reasons.fieldFolder";
    default:
      return "reasons.fieldName";
  }
}

function pinDetail(t: Translator, reason: PinReason): string {
  switch (reason.pinKind) {
    case "RANGE":
      return reason.lines
        ? t("reasons.pinRange", {
            path: reason.filePath,
            start: reason.lines[0],
            end: reason.lines[1],
          })
        : t("reasons.pinFile", { path: reason.filePath });
    case "GLOB":
      return t("reasons.pinGlob", { pattern: reason.filePath });
    case "SYMBOL":
      return t("reasons.pinSymbol", {
        path: reason.filePath,
        symbol: reason.symbol ?? "",
      });
    default:
      return t("reasons.pinFile", { path: reason.filePath });
  }
}

export function groupReasonsByKind(
  reasons: SelectionReason[]
): Map<ReasonKind, SelectionReason[]> {
  const groups = new Map<ReasonKind, SelectionReason[]>();
  for (const kind of REASON_KIND_ORDER) {
    const matching = reasons.filter((reason) => reason.kind === kind);
    if (matching.length > 0) groups.set(kind, matching);
  }
  return groups;
}

export interface ReasonDetailLine {
  text: string;
  stale?: boolean;
}

export function reasonDetailLines(
  t: Translator,
  kind: ReasonKind,
  reasons: SelectionReason[]
): ReasonDetailLine[] {
  switch (kind) {
    case "PIN":
      return reasons
        .filter((reason): reason is PinReason => reason.kind === "PIN")
        .map((reason) => ({
          text: pinDetail(t, reason),
          stale: reason.stale === true,
        }));
    case "ISSUE":
      return reasons
        .filter((reason): reason is IssueReason => reason.kind === "ISSUE")
        .map((reason) => ({
          text: t("reasons.issueDetail", {
            key: reason.issueKey,
            count: reason.commits.length,
            sha: reason.commits[0]?.shortSha ?? "",
          }),
        }));
    case "PATH":
      return reasons
        .filter((reason): reason is PathReason => reason.kind === "PATH")
        .map((reason) => ({
          text: t("reasons.pathDetail", {
            term: reason.term,
            field: t(pathFieldKey(reason.matchedField)),
          }),
        }));
    case "HISTORY": {
      const history = reasons.filter((reason) => reason.kind === "HISTORY");
      const lines: ReasonDetailLine[] = [];
      if (history.some((reason) => reason.failed)) {
        lines.push({ text: t("reasons.historyFailed") });
      }
      lines.push({
        text: t("reasons.historyDetail", { count: history.length }),
      });
      return lines;
    }
    case "AI":
      return reasons
        .filter((reason) => reason.kind === "AI")
        .map((reason) => ({ text: reason.rationale }));
    case "LINKED":
      return reasons
        .filter((reason) => reason.kind === "LINKED")
        .map((reason) => ({
          text: t("reasons.linkedDetail", { caseId: reason.viaCaseId }),
        }));
    default:
      return [];
  }
}

interface ReasonBadgesProps {
  reasons: SelectionReason[];
  className?: string;
}

export function ReasonBadges({ reasons, className }: ReasonBadgesProps) {
  const t = useTranslations("runs.impact");
  const groups = groupReasonsByKind(reasons);

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {[...groups.entries()].map(([kind, kindReasons]) => {
        const Icon = REASON_ICON[kind];
        const lines = reasonDetailLines(t, kind, kindReasons).slice(0, 3);
        const stale =
          kind === "PIN" &&
          kindReasons.some((r) => r.kind === "PIN" && r.stale);
        return (
          <Tooltip key={kind}>
            <TooltipTrigger asChild>
              <span>
                <Badge
                  variant={REASON_VARIANT[kind]}
                  className="gap-1 whitespace-nowrap"
                  data-testid={`impact-reason-badge-${kind}`}
                >
                  <Icon className="h-3 w-3" />
                  {t(REASON_LABEL_KEY[kind])}
                  {stale && (
                    <span className="text-[10px] uppercase opacity-80">
                      {t("stale.badge")}
                    </span>
                  )}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <ul className="space-y-0.5">
                {lines.map((line, index) => (
                  <li key={index} className="break-words">
                    {line.text}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
