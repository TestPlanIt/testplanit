import React from "react";
import { SearchCheck, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { Steps as PrismaSteps } from "@prisma/client";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { useFindManySharedStepItem } from "~/lib/hooks";
import { Separator } from "~/components/ui/separator";

interface DisplayStep extends PrismaSteps {
  isShared?: boolean;
  sharedStepGroupName?: string | null;
  sharedStepGroup?: { name: string | null } | null;
}

interface StepsResultsProps {
  steps: DisplayStep[];
  projectId?: number;
}

interface RenderSharedGroupItemsForResultsProps {
  sharedStepGroupId: number;
  projectId?: number;
}

const RenderSharedGroupItemsForResults: React.FC<
  RenderSharedGroupItemsForResultsProps
> = ({ sharedStepGroupId, projectId }) => {
  const t = useTranslations("repository.steps");
  const { data: items, isLoading } = useFindManySharedStepItem(
    {
      where: { sharedStepGroupId },
      orderBy: { order: "asc" },
    },
    { enabled: !!sharedStepGroupId }
  );

  if (isLoading) {
    return (
      <p className="ml-8 text-sm text-muted-foreground py-1">
        {t("loadingSharedStepsItems")}
      </p>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="ml-8 text-sm text-muted-foreground py-1">
        {t("noStepsInSharedGroup")}
      </p>
    );
  }

  return (
    <div className="ml-8 mt-1 space-y-2 border-l-2 border-dashed border-primary/20 pl-3 py-1 w-full pr-8">
      {items.map((item, itemIndex) => {
        let stepContent, expectedResultContent;
        try {
          stepContent =
            typeof item.step === "string"
              ? JSON.parse(item.step)
              : item.step || emptyEditorContent;
        } catch (e) {
          stepContent = emptyEditorContent;
        }
        try {
          expectedResultContent =
            typeof item.expectedResult === "string"
              ? JSON.parse(item.expectedResult)
              : item.expectedResult || emptyEditorContent;
        } catch (e) {
          expectedResultContent = emptyEditorContent;
        }

        return (
          <div key={`shared-group-${sharedStepGroupId}-item-${item.id || itemIndex}`} className="space-y-2 w-full">
            <div className="flex">
              <div className="shrink-0 pt-[0.4rem]">
                <div className="text-sm font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-6 h-6">
                  {item.order + 1}
                </div>
              </div>
              <div className="grow min-w-0 -mt-1">
                <TipTapEditor
                  content={stepContent}
                  readOnly={true}
                  projectId={projectId?.toString()}
                  className="bg-muted/30 p-1 rounded"
                />
              </div>
            </div>
            <Separator className="my-2" />
            <div className="flex">
              <div className="shrink-0 pt-0.5">
                <div className="flex items-center justify-center text-primary rounded-full w-8 h-8 -mx-1">
                  <SearchCheck className="text-primary h-7 w-7 shrink-0" />
                </div>
              </div>
              <div className="grow min-w-0 -mt-1">
                <TipTapEditor
                  content={expectedResultContent}
                  readOnly={true}
                  projectId={projectId?.toString()}
                  className="bg-muted/30 p-1 rounded"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const StepsResults: React.FC<StepsResultsProps> = ({
  steps,
  projectId,
}) => {
  const t_repo_steps = useTranslations("repository.steps");

  if (!steps || steps.length === 0) {
    return null;
  }

  return (
    <div className="mt-2" data-testid="steps-results">
      <ol className="ml-1 mr-6 min-w-[200px]">
        {steps.map((step, index) => {
          if (step.sharedStepGroupId) {
            return (
              <li
                key={`shared-result-${step.sharedStepGroupId}-${index}`}
                className="mb-4"
                data-testid={`step-container-${index}`}
              >
                <div className="flex flex-col items-start min-w-[200px] bg-muted/50 p-2 rounded-lg mb-1">
                  <div className="flex items-center font-bold pb-1 w-full">
                    <div
                      className="mt-2 font-bold flex items-center justify-center p-1 text-primary-foreground bg-primary border-2 border-primary rounded-full w-6 h-6 text-sm"
                      data-testid={`step-badge-${index}`}
                    >
                      {index + 1}
                    </div>
                    <div className="ml-4 flex items-center mt-2">
                      <Layers className="h-5 w-5 mr-2 text-primary shrink-0" />
                      <span className="text-sm">
                        {t_repo_steps("sharedStepGroupTitle", {
                          name:
                            step.sharedStepGroup?.name ||
                            step.sharedStepGroupName ||
                            "Shared Steps",
                        })}
                      </span>
                    </div>
                  </div>
                  <RenderSharedGroupItemsForResults
                    sharedStepGroupId={step.sharedStepGroupId}
                    projectId={projectId}
                  />
                </div>
              </li>
            );
          }

          let stepContent;
          try {
            stepContent =
              typeof step.step === "string" ? JSON.parse(step.step) : step.step;
          } catch (error) {
            stepContent = emptyEditorContent;
          }

          let expectedResultContent;
          try {
            expectedResultContent =
              typeof step.expectedResult === "string"
                ? JSON.parse(step.expectedResult)
                : step.expectedResult || emptyEditorContent;
          } catch (error) {
            expectedResultContent = emptyEditorContent;
          }

          return (
            <li
              key={`step-result-${step.id}-${index}`}
              className="mb-4"
              data-testid={`step-container-${index}`}
            >
              <div className="flex gap-2 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-b-none">
                <div
                  className="mt-2 font-bold flex items-center justify-center p-1 text-primary-foreground bg-primary border-2 border-primary rounded-full w-6 h-6 text-sm"
                  data-testid={`step-badge-${index}`}
                >
                  {index + 1}
                </div>
                <div className="flex-1">
                  <TipTapEditor
                    content={stepContent}
                    readOnly={true}
                    projectId={`step_result_${step.id}`}
                    className="prose-sm"
                  />
                </div>
              </div>
              <div className="flex gap-1 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-t-none">
                <SearchCheck className="text-primary h-7 w-7 shrink-0 mt-1" />
                <div className="flex-1">
                  <TipTapEditor
                    content={expectedResultContent}
                    readOnly={true}
                    projectId={`step_result_${step.id}_expected`}
                    className="prose-sm"
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
