"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Radio } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { schema } from "~/zenstack/schema";
import { ImpactDialog, type ImpactRepoConfig } from "./ImpactDialog";

export interface ImpactAcceptedInfo {
  analysisId: number;
  acceptedCaseIds: number[];
}

interface ImpactButtonProps {
  projectId: number;
  selectedTestCases: number[];
  onSuggestionsAccepted: (ids: number[]) => void;
  onAnalysisAccepted?: (info: ImpactAcceptedInfo) => void;
  size?: "sm" | "lg";
}

export function ImpactButton({
  projectId,
  selectedTestCases,
  onSuggestionsAccepted,
  onAnalysisAccepted,
  size = "lg",
}: ImpactButtonProps) {
  const t = useTranslations("runs.impact");
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: project, isLoading } = useClientQueries(
    schema
  ).projects.useFindFirst({
    where: { id: projectId },
    select: {
      impactEnabled: true,
      codeRepositoryConfigs: {
        where: { purpose: "IMPACT" },
        select: {
          id: true,
          repositoryId: true,
          branch: true,
          cacheEnabled: true,
        },
      },
    },
  });

  const handleAccept = useCallback(
    (ids: number[], info: { analysisId: number }) => {
      const merged = [...new Set([...selectedTestCases, ...ids])];
      onSuggestionsAccepted(merged);
      onAnalysisAccepted?.({
        analysisId: info.analysisId,
        acceptedCaseIds: ids,
      });
    },
    [selectedTestCases, onSuggestionsAccepted, onAnalysisAccepted]
  );

  if (isLoading || !project || !project.impactEnabled) {
    return null;
  }

  const rawConfig = project.codeRepositoryConfigs?.[0];
  const config: ImpactRepoConfig | null = rawConfig
    ? {
        id: rawConfig.id,
        repositoryId: rawConfig.repositoryId,
        branch: rawConfig.branch ?? null,
      }
    : null;

  if (!config) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              size={size}
              variant="outline"
              disabled
              data-testid="impact-button"
            >
              <Radio className="h-4 w-4" />
              {t("analyzeImpact")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("noRepository")}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        onClick={() => setDialogOpen(true)}
        data-testid="impact-button"
      >
        <Radio className="h-4 w-4" />
        {t("analyzeImpact")}
      </Button>

      {dialogOpen && (
        <ImpactDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={projectId}
          config={config}
          currentSelection={selectedTestCases}
          onAccept={handleAccept}
        />
      )}
    </>
  );
}
