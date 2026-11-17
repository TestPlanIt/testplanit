"use client";

import {
  ImpactDialog,
  type ImpactRepoConfig,
} from "@/components/impact/ImpactDialog";
import type { ImpactAcceptedInfo } from "@/components/impact/ImpactDialog";
import { RiskDialog } from "@/components/risk/RiskDialog";
import {
  ActionOverflow,
  type OverflowAction,
} from "@/components/ui/action-bar";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Gauge, Radio, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { schema } from "~/zenstack/schema";
import { MagicSelectDialog } from "./MagicSelectDialog";

type SelectionSource = "magic" | "impact" | "risk";

interface CaseSelectionActionsProps {
  projectId: number;
  testRunMetadata: {
    name: string;
    description: string | null;
    docs: string | null;
    linkedIssueIds: number[];
    tags?: string[];
  };
  selectedTestCases: number[];
  onSuggestionsAccepted: (ids: number[]) => void;
  onAnalysisAccepted?: (info: ImpactAcceptedInfo) => void;
  /**
   * Collapse the sources into one menu. The caller measures the header it
   * sits in, so there is room for three icon buttons on a wide dialog and a
   * single menu when there is not. Defaults to the menu.
   */
  compact?: boolean;
}

/**
 * The run's case-selection sources — Magic Select, Impact and Risk — behind
 * one menu. The menu only raises callbacks: each dialog is rendered beside
 * it, never inside, so closing the menu cannot unmount an open dialog.
 *
 * A source the project does not run is left out entirely; one that is on but
 * not yet configured stays visible and disabled, saying what it needs.
 */
export function CaseSelectionActions({
  projectId,
  testRunMetadata,
  selectedTestCases,
  onSuggestionsAccepted,
  onAnalysisAccepted,
  compact = true,
}: CaseSelectionActionsProps) {
  const t = useTranslations("runs");
  const [activeSource, setActiveSource] = useState<SelectionSource | null>(
    null
  );

  // One query for all three gates; each button used to ask on its own.
  const { data: project, isLoading } = useClientQueries(
    schema
  ).projects.useFindFirst({
    where: { id: projectId },
    select: {
      impactEnabled: true,
      riskScoringEnabled: true,
      projectLlmIntegrations: {
        where: { isActive: true },
        take: 1,
        select: { id: true },
      },
      codeRepositoryConfigs: {
        where: { purpose: "IMPACT" },
        orderBy: { id: "asc" },
        select: {
          id: true,
          repositoryId: true,
          branch: true,
          cacheEnabled: true,
          repository: { select: { name: true } },
        },
      },
    },
  });

  // Stable: the Impact dialog keys its compare fetch on the chosen config, so
  // a fresh array every render would abort and restart that fetch.
  const configs = useMemo<ImpactRepoConfig[]>(
    () =>
      (project?.codeRepositoryConfigs ?? []).map((row) => ({
        id: row.id,
        repositoryId: row.repositoryId,
        branch: row.branch ?? null,
        name: row.repository?.name ?? "",
      })),
    [project?.codeRepositoryConfigs]
  );

  const merge = useCallback(
    (ids: number[]) => {
      onSuggestionsAccepted([...new Set([...selectedTestCases, ...ids])]);
    },
    [selectedTestCases, onSuggestionsAccepted]
  );

  const handleImpactAccept = useCallback(
    (ids: number[], info: { analysisId: number }) => {
      merge(ids);
      onAnalysisAccepted?.({
        analysisId: info.analysisId,
        acceptedCaseIds: ids,
      });
    },
    [merge, onAnalysisAccepted]
  );

  const hasLlm = (project?.projectLlmIntegrations?.length ?? 0) > 0;

  const actions = useMemo<OverflowAction[]>(
    () => [
      {
        key: "magic",
        icon: Wand2,
        label: hasLlm
          ? t("magicSelect.title")
          : `${t("magicSelect.title")} — ${t("magicSelect.noLlmIntegration")}`,
        onClick: () => setActiveSource("magic"),
        disabled: isLoading || !hasLlm || !testRunMetadata.name,
        testId: "magic-select-action",
      },
      {
        key: "impact",
        icon: Radio,
        label:
          configs.length > 0
            ? t("impact.analyzeImpact")
            : `${t("impact.analyzeImpact")} — ${t("impact.noRepository")}`,
        onClick: () => setActiveSource("impact"),
        disabled: isLoading || configs.length === 0,
        hidden: !project?.impactEnabled,
        testId: "impact-button",
      },
      {
        key: "risk",
        icon: Gauge,
        label: t("risk.prioritizeByRisk"),
        onClick: () => setActiveSource("risk"),
        disabled: isLoading,
        hidden: !project?.riskScoringEnabled,
        testId: "risk-button",
      },
    ],
    [
      t,
      hasLlm,
      isLoading,
      testRunMetadata.name,
      configs.length,
      project?.impactEnabled,
      project?.riskScoringEnabled,
    ]
  );

  return (
    <>
      <ActionOverflow
        compact={compact}
        preserveMenuOrder
        actions={actions}
        menuLabel={t("caseSelection.menuLabel")}
        menuTestId="case-selection-actions"
      />

      <MagicSelectDialog
        open={activeSource === "magic"}
        onOpenChange={(open) => setActiveSource(open ? "magic" : null)}
        projectId={projectId}
        testRunMetadata={testRunMetadata}
        currentSelection={selectedTestCases}
        onAccept={merge}
      />

      {activeSource === "impact" && configs.length > 0 && (
        <ImpactDialog
          open
          onOpenChange={(open) => setActiveSource(open ? "impact" : null)}
          projectId={projectId}
          configs={configs}
          currentSelection={selectedTestCases}
          onAccept={handleImpactAccept}
        />
      )}

      {activeSource === "risk" && (
        <RiskDialog
          open
          onOpenChange={(open) => setActiveSource(open ? "risk" : null)}
          projectId={projectId}
          currentSelection={selectedTestCases}
          onAccept={merge}
        />
      )}
    </>
  );
}
