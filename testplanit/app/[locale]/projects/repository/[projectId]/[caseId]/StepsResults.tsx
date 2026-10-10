import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  StepLayoutToggle,
  stepLayoutClasses,
} from "@/components/steps/StepLayoutToggle";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import type { Steps as DbSteps } from "~/zenstack/models";
import { Layers, SearchCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { emptyEditorContent } from "~/app/constants";
import { Separator } from "~/components/ui/separator";
import { useStepLayout } from "~/hooks/useStepLayout";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import { cn } from "~/utils";

interface DisplayStep extends DbSteps {
  isShared?: boolean;
  sharedStepGroupName?: string | null;
  sharedStepGroup?: { name: string | null } | null;
}

interface StepsResultsProps {
  steps: DisplayStep[];
  projectId?: number;
  parameters?: ParameterChipMeta[];
  /** Set when the surrounding surface renders the toggle on its own header. */
  hideLayoutToggle?: boolean;
}

interface RenderSharedGroupItemsForResultsProps {
  sharedStepGroupId: number;
  projectId?: number;
  parameters?: ParameterChipMeta[];
  sideBySide: boolean;
}

const parseContent = (value: unknown) => {
  try {
    return typeof value === "string"
      ? JSON.parse(value)
      : value || emptyEditorContent;
  } catch {
    return emptyEditorContent;
  }
};

const RenderSharedGroupItemsForResults: React.FC<
  RenderSharedGroupItemsForResultsProps
> = ({ sharedStepGroupId, projectId, parameters, sideBySide }) => {
  const t = useTranslations("repository.steps");
  const { data: items, isLoading } = useClientQueries(
    schema
  ).sharedStepItem.useFindMany(
    {
      where: {
        sharedStepGroupId,
        sharedStepGroup: { isDeleted: false },
      },
      orderBy: { order: "asc" },
    },
    { enabled: !!sharedStepGroupId }
  );

  if (isLoading) {
    return (
      <p className="ms-8 text-sm text-muted-foreground py-1">
        {t("loadingSharedStepsItems")}
      </p>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="ms-8 text-sm text-muted-foreground py-1">
        {t("noStepsInSharedGroup")}
      </p>
    );
  }

  return (
    <div className="ms-8 mt-1 space-y-2 border-s-2 border-dashed border-primary/20 ps-3 py-1 w-full pe-8">
      {items.map((item, itemIndex) => (
        <div
          key={`shared-group-${sharedStepGroupId}-item-${item.id || itemIndex}`}
          className={cn("w-full gap-2", stepLayoutClasses.pair(sideBySide))}
        >
          <div className="flex min-w-0">
            <div className="shrink-0 pt-[0.4rem]">
              <div className="text-sm font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-6 h-6">
                {item.order + 1}
              </div>
            </div>
            <div className="grow min-w-0 -mt-1">
              <TipTapEditor
                content={parseContent(item.step)}
                readOnly={true}
                projectId={projectId?.toString()}
                className="bg-muted/30 p-1 rounded"
                parameters={parameters}
              />
            </div>
          </div>
          <Separator
            className={cn("my-0", stepLayoutClasses.stackedOnly(sideBySide))}
          />
          <div className="flex min-w-0">
            <div className="shrink-0 pt-0.5">
              <div className="flex items-center justify-center text-primary rounded-full w-8 h-8 -mx-1">
                <SearchCheck className="text-primary h-7 w-7 shrink-0" />
              </div>
            </div>
            <div className="grow min-w-0 -mt-1">
              <TipTapEditor
                content={parseContent(item.expectedResult)}
                readOnly={true}
                projectId={projectId?.toString()}
                className="bg-muted/30 p-1 rounded"
                parameters={parameters}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const StepsResults: React.FC<StepsResultsProps> = ({
  steps,
  projectId,
  parameters,
  hideLayoutToggle = false,
}) => {
  const t_repo_steps = useTranslations("repository.steps");
  const { layout, isSideBySide } = useStepLayout();

  if (!steps || steps.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("mt-2", stepLayoutClasses.container)}
      data-testid="steps-results"
      data-step-layout={layout}
    >
      {!hideLayoutToggle && (
        <div className="flex justify-end me-6 -mt-1 mb-1">
          <StepLayoutToggle />
        </div>
      )}
      <ol className="ms-1 me-6 min-w-[200px]">
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
                    <div className="ms-4 flex items-center mt-2">
                      <Layers className="h-5 w-5 me-2 text-primary shrink-0" />
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
                    parameters={parameters}
                    sideBySide={isSideBySide}
                  />
                </div>
              </li>
            );
          }

          return (
            <li
              key={`step-result-${step.id}-${index}`}
              className={cn("mb-4", stepLayoutClasses.pair(isSideBySide))}
              data-testid={`step-container-${index}`}
            >
              <div
                className={cn(
                  "flex gap-2 w-full min-w-0 ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground",
                  stepLayoutClasses.stepBlock(isSideBySide)
                )}
              >
                <div
                  className="mt-2 font-bold flex items-center justify-center p-1 text-primary-foreground bg-primary border-2 border-primary rounded-full w-6 h-6 text-sm"
                  data-testid={`step-badge-${index}`}
                >
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <TipTapEditor
                    content={parseContent(step.step)}
                    readOnly={true}
                    projectId={`step_result_${step.id}`}
                    className="prose-sm"
                    parameters={parameters}
                  />
                </div>
              </div>
              <div
                className={cn(
                  "flex gap-1 w-full min-w-0 ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground",
                  stepLayoutClasses.expectedBlock(isSideBySide)
                )}
                data-testid={`expected-result-${index}`}
              >
                <SearchCheck className="text-primary h-7 w-7 shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <TipTapEditor
                    content={parseContent(step.expectedResult)}
                    readOnly={true}
                    projectId={`step_result_${step.id}_expected`}
                    className="prose-sm"
                    parameters={parameters}
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
