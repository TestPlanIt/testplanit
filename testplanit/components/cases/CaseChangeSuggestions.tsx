"use client";

import { WordDiffText } from "@/components/WordDiffText";
import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { WarningAlert } from "@/components/ui/warning-alert";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { ChevronRight, FileClock, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  DeleteCaseModal,
  type DeleteModalTestCase,
} from "~/app/[locale]/projects/repository/[projectId]/DeleteCase";
import { toast } from "sonner";
import { apiFetch } from "~/lib/basePath";
import { isIssueTextNewerThanCase } from "~/lib/services/caseUpkeep/alignment";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";
import { schema } from "~/zenstack/schema";

interface CaseText {
  name: string;
  fieldValues: Record<string, unknown>;
  steps: { step: string; expectedResult: string }[];
}

type SuggestionAction = "apply" | "dismiss" | "regenerate";
const ERROR_CODES = [
  "not_found",
  "gone",
  "not_pending",
  "stale",
  "no_llm",
  "failed",
] as const;

/** A field value as one line of text: option lists joined, the rest as written. */
export function fieldValueText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

/** The proposed case and the case it was suggested for, when both can be read. */
export function readProposal(
  proposed: unknown
): { base: CaseText; next: CaseText } | null {
  const value = proposed as (Partial<CaseText> & { base?: CaseText }) | null;
  if (
    !value ||
    typeof value.name !== "string" ||
    !Array.isArray(value.steps) ||
    !value.base ||
    !Array.isArray(value.base.steps)
  ) {
    return null;
  }
  return {
    base: value.base,
    next: {
      name: value.name,
      fieldValues: value.fieldValues ?? {},
      steps: value.steps,
    },
  };
}

interface Props {
  caseId: number;
  /** The case as the delete confirmation shows it. */
  testcase: DeleteModalTestCase;
  /** The case's version as shown, to tell a suggestion made for an older one. */
  currentVersion: number;
  /** Whether the user may edit the case, and so decide its suggestions. */
  canDecide: boolean;
  /** Called after a suggestion changed the case, so the page can reload it. */
  onCaseChanged?: () => void;
  /** Called after a suggestion deleted the case, so the page can leave it. */
  onCaseDeleted?: () => void;
}

/**
 * The changes AI has suggested for a test case and nobody has decided yet,
 * each shown against the case as it read when the change was suggested, and
 * a notice for every other linked issue whose text has changed since the
 * case was last brought in line with it. Renders nothing when there is
 * neither.
 */
export function CaseChangeSuggestions({
  caseId,
  testcase,
  currentVersion,
  canDecide,
  onCaseChanged,
  onCaseDeleted,
}: Props) {
  const t = useTranslations("repository.suggestions");
  const tCommon = useTranslations("common");
  const [busy, setBusy] = useState<{
    id: number;
    action: SuggestionAction;
  } | null>(null);

  const { data: suggestions, refetch } = useClientQueries(
    schema
  ).caseChangeSuggestion.useFindMany({
    where: { caseId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      rationale: true,
      proposed: true,
      baseCaseVersion: true,
      issue: {
        select: { id: true, name: true, title: true, externalUrl: true },
      },
    },
  });

  const { data: links, refetch: refetchLinks } = useClientQueries(
    schema
  ).repositoryCaseIssue.useFindMany({
    where: { caseId, alignedAt: { not: null } },
    select: {
      issueId: true,
      alignedAt: true,
      issue: {
        select: {
          id: true,
          name: true,
          title: true,
          externalUrl: true,
          contentUpdatedAt: true,
          isDeleted: true,
        },
      },
    },
  });
  const [aligning, setAligning] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  // An issue with a suggestion waiting already says the case is behind it.
  const behind = (links ?? []).filter(
    (link) =>
      !link.issue.isDeleted &&
      isIssueTextNewerThanCase({
        contentUpdatedAt: link.issue.contentUpdatedAt,
        alignedAt: link.alignedAt,
      }) &&
      !(suggestions ?? []).some((item) => item.issue.id === link.issueId)
  );

  async function markAligned(issueId: number) {
    setAligning(issueId);
    try {
      const response = await apiFetch(
        `/api/repository-cases/${caseId}/issue-alignment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueId }),
        }
      );
      if (!response.ok) {
        toast.error(t("markAlignedFailed"));
        return;
      }
      toast.success(t("markedAligned"));
    } catch {
      toast.error(t("markAlignedFailed"));
    } finally {
      setAligning(null);
      await refetchLinks();
    }
  }

  async function decide(id: number, action: SuggestionAction) {
    setBusy({ id, action });
    try {
      const response = await apiFetch(
        `/api/repository/cases/${caseId}/suggestions/${id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
        status?: string;
        outcome?: string;
      };
      if (!response.ok) {
        const code = ERROR_CODES.find((known) => known === body.code);
        toast.error(t(`errors.${code ?? "failed"}`));
        return;
      }
      if (action === "regenerate") {
        toast.success(
          t(body.outcome === "up_to_date" ? "nothingToChange" : "regenerated")
        );
      } else if (action === "dismiss") {
        toast.success(t("dismissed"));
      } else {
        const kind = suggestions?.find((item) => item.id === id)?.kind;
        if (kind === "RETIRE") {
          toast.success(t("retired"));
          onCaseDeleted?.();
        } else {
          toast.success(t("applied"));
          onCaseChanged?.();
        }
      }
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(null);
      await Promise.all([refetch(), refetchLinks()]);
    }
  }

  const pending = suggestions ?? [];
  if (pending.length === 0 && behind.length === 0) return null;

  return (
    <div className="space-y-3 px-6 pb-4" data-testid="case-suggestions">
      {behind.map((link) => (
        <WarningAlert
          key={`behind-${link.issueId}`}
          data-testid={`case-issue-changed-${link.issueId}`}
          className="[&>svg]:top-1/2 [&>svg]:-translate-y-1/2"
        >
          <FileClock className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4 text-sm">
            <span className="min-w-0">
              {t("issueChangedUnchecked", {
                issue: formatIssueDisplayText(link.issue),
              })}
            </span>
            {canDecide && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={aligning === link.issueId}
                onClick={() => void markAligned(link.issueId)}
                data-testid={`case-issue-mark-aligned-${link.issueId}`}
              >
                {t("markAligned")}
              </Button>
            )}
          </AlertDescription>
        </WarningAlert>
      ))}
      {pending.map((suggestion) => {
        const stale = suggestion.baseCaseVersion !== currentVersion;
        const proposal =
          suggestion.kind === "UPDATE"
            ? readProposal(suggestion.proposed)
            : null;
        const fieldNames = proposal
          ? [
              ...new Set([
                ...Object.keys(proposal.base.fieldValues),
                ...Object.keys(proposal.next.fieldValues),
              ]),
            ].filter(
              (name) =>
                fieldValueText(proposal.base.fieldValues[name]) !==
                fieldValueText(proposal.next.fieldValues[name])
            )
          : [];
        const stepCount = proposal
          ? Math.max(proposal.base.steps.length, proposal.next.steps.length)
          : 0;
        const stepText = (step?: { step: string; expectedResult: string }) =>
          step
            ? step.expectedResult
              ? `${step.step}\n${t("expectedResult", { text: step.expectedResult })}`
              : step.step
            : "";
        const working = busy?.id === suggestion.id;
        return (
          <WarningAlert
            key={suggestion.id}
            data-testid={`case-suggestion-${suggestion.id}`}
          >
            <Sparkles className="h-4 w-4" />
            <Collapsible>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <AlertTitle className="mb-0">
                  {t(
                    suggestion.kind === "RETIRE" ? "retireTitle" : "updateTitle"
                  )}
                </AlertTitle>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="group"
                    data-testid={`case-suggestion-toggle-${suggestion.id}`}
                  >
                    <span className="group-data-[state=open]:hidden">
                      {t("review")}
                    </span>
                    <span className="hidden group-data-[state=open]:inline">
                      {t("hide")}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <AlertDescription className="text-sm">
                <p>
                  {t("issueChanged", {
                    issue: formatIssueDisplayText(suggestion.issue),
                  })}
                </p>
                <CollapsibleContent className="space-y-3 pt-3">
                  {suggestion.rationale && <p>{suggestion.rationale}</p>}
                  {suggestion.kind === "RETIRE" && (
                    <p>{t("retireDescription")}</p>
                  )}
                  {stale && (
                    <p
                      className="text-warning-text"
                      data-testid={`case-suggestion-stale-${suggestion.id}`}
                    >
                      {t("stale")}
                    </p>
                  )}
                  {proposal && (
                    <div
                      className="space-y-2"
                      data-testid={`case-suggestion-changes-${suggestion.id}`}
                    >
                      {proposal.base.name !== proposal.next.name && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">
                            {t("name")}
                          </div>
                          <WordDiffText
                            grouped
                            before={proposal.base.name}
                            after={proposal.next.name}
                          />
                        </div>
                      )}
                      {fieldNames.map((name) => (
                        <div className="space-y-1" key={name}>
                          <div className="text-xs font-medium text-muted-foreground">
                            {name}
                          </div>
                          <WordDiffText
                            grouped
                            before={fieldValueText(
                              proposal.base.fieldValues[name]
                            )}
                            after={fieldValueText(
                              proposal.next.fieldValues[name]
                            )}
                          />
                        </div>
                      ))}
                      {Array.from({ length: stepCount }, (_, index) => {
                        const before = stepText(proposal.base.steps[index]);
                        const after = stepText(proposal.next.steps[index]);
                        if (before === after) return null;
                        return (
                          <div className="space-y-1" key={`step-${index}`}>
                            <div className="text-xs font-medium text-muted-foreground">
                              {t("step", { number: index + 1 })}
                            </div>
                            <WordDiffText
                              grouped
                              before={before}
                              after={after}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {canDecide && (
                    <div className="flex flex-wrap gap-2">
                      {stale ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={working}
                          onClick={() =>
                            void decide(suggestion.id, "regenerate")
                          }
                          data-testid={`case-suggestion-regenerate-${suggestion.id}`}
                        >
                          {t("regenerate")}
                        </Button>
                      ) : suggestion.kind === "RETIRE" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={working}
                          onClick={() => setConfirmingDelete(suggestion.id)}
                          data-testid={`case-suggestion-delete-${suggestion.id}`}
                        >
                          {tCommon("actions.delete")}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={working}
                          onClick={() => void decide(suggestion.id, "apply")}
                          data-testid={`case-suggestion-apply-${suggestion.id}`}
                        >
                          {t("apply")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={working}
                        onClick={() => void decide(suggestion.id, "dismiss")}
                        data-testid={`case-suggestion-dismiss-${suggestion.id}`}
                      >
                        {t("dismiss")}
                      </Button>
                    </div>
                  )}
                </CollapsibleContent>
              </AlertDescription>
            </Collapsible>
          </WarningAlert>
        );
      })}
      {confirmingDelete !== null && (
        <DeleteCaseModal
          testcase={testcase}
          open
          onClose={() => setConfirmingDelete(null)}
          onConfirm={() => decide(confirmingDelete, "apply")}
        />
      )}
    </div>
  );
}
