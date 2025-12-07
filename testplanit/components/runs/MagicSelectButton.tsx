"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Wand2 } from "lucide-react";
import { MagicSelectDialog } from "./MagicSelectDialog";
import { useFindFirstProjects } from "~/lib/hooks";

interface MagicSelectButtonProps {
  projectId: number;
  testRunMetadata: {
    name: string;
    description: string | null;
    docs: string | null;
    linkedIssueIds: number[];
    tags?: string[];
  };
  selectedTestCases: number[];
  onSuggestionsAccepted: (suggestedCaseIds: number[]) => void;
}

export function MagicSelectButton({
  projectId,
  testRunMetadata,
  selectedTestCases,
  onSuggestionsAccepted,
}: MagicSelectButtonProps) {
  const t = useTranslations("runs.magicSelect");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Check if project has an active LLM integration
  const { data: project, isLoading } = useFindFirstProjects({
    where: { id: projectId },
    include: {
      projectLlmIntegrations: {
        where: { isActive: true },
        take: 1,
      },
    },
  });

  const hasLlmIntegration =
    project?.projectLlmIntegrations &&
    project.projectLlmIntegrations.length > 0;

  const handleAccept = useCallback(
    (suggestedCaseIds: number[]) => {
      // Merge suggested cases with existing selection
      const merged = [...new Set([...selectedTestCases, ...suggestedCaseIds])];
      onSuggestionsAccepted(merged);
    },
    [selectedTestCases, onSuggestionsAccepted]
  );

  // Show disabled button with tooltip if no LLM integration
  if (!isLoading && !hasLlmIntegration) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="lg" variant="outline" disabled>
                <Wand2 className="h-4 w-4" />
                {t("button")}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("noLlmIntegration")}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      <Button
        size="lg"
        onClick={() => setDialogOpen(true)}
        disabled={isLoading || !testRunMetadata.name}
      >
        <Wand2 className="h-4 w-4" />
        {t("button")}
      </Button>

      <MagicSelectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        testRunMetadata={testRunMetadata}
        currentSelection={selectedTestCases}
        onAccept={handleAccept}
      />
    </>
  );
}
