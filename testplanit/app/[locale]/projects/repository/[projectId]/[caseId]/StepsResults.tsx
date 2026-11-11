import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  StepLayoutToggle,
  stepLayoutClasses,
} from "@/components/steps/StepLayoutToggle";
import ReadOnlyRichText from "@/components/tiptap/ReadOnlyRichText";
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
> = ({ sharedStepGroupId, parameters, sideBySide }) => {
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
      <p className="ms-8 py-1 text-sm text-muted-foreground">
        {t("loadingSharedStepsItems")}
      </p>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="ms-8 py-1 text-sm text-muted-foreground">
        {t("noStepsInSharedGroup")}
      </p>
    );
  }

  return (
    <div className="ms-8 mt-1 w-full space-y-2 border-s-2 border-dashed border-primary/20 py-1 ps-3 pe-8">
      {items.map((item, itemIndex) => (
        <div
          key={`shared-group-${sharedStepGroupId}-item-${item.id || itemIndex}`}
          className={cn("w-full gap-2", stepLayoutClasses.pair(sideBySide))}
        >
          <div className="flex min-w-0">
            <div className="shrink-0 pt-[0.4rem]">
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary p-2 text-sm font-bold text-primary-foreground">
                {item.order + 1}
              </div>
            </div>
            <div className="-mt-1 min-w-0 grow">
              <ReadOnlyRichText
                content={parseContent(item.step)}
                className="rounded bg-muted/30 p-1"
                parameters={parameters}
              />
            </div>
          </div>
          <Separator
            className={cn("my-0", stepLayoutClasses.stackedOnly(sideBySide))}
          />
          <div className="flex min-w-0">
            <div className="shrink-0 pt-0.5">
              <div className="-mx-1 flex h-8 w-8 items-center justify-center rounded-full text-primary">
                <SearchCheck className="h-7 w-7 shrink-0 text-primary" />
              </div>
            </div>
            <div className="-mt-1 min-w-0 grow">
              <ReadOnlyRichText
                content={parseContent(item.expectedResult)}
                className="rounded bg-muted/30 p-1"
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
        <div className="me-6 -mt-1 mb-1 flex justify-end">
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
                <div className="mb-1 flex min-w-[200px] flex-col items-start rounded-lg bg-muted/50 p-2">
                  <div className="flex w-full items-center pb-1 font-bold">
                    <div
                      className="mt-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary p-1 text-sm font-bold text-primary-foreground"
                      data-testid={`step-badge-${index}`}
                    >
                      {index + 1}
                    </div>
                    <div className="ms-4 mt-2 flex items-center">
                      <Layers className="me-2 h-5 w-5 shrink-0 text-primary" />
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
                  "flex w-full min-w-0 gap-2 rounded-lg bg-primary-foreground p-2 ring-2 ring-primary/50",
                  stepLayoutClasses.stepBlock(isSideBySide)
                )}
              >
                <div
                  className="mt-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary p-1 text-sm font-bold text-primary-foreground"
                  data-testid={`step-badge-${index}`}
                >
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <ReadOnlyRichText
                    content={parseContent(step.step)}
                    className="prose-sm"
                    parameters={parameters}
                  />
                </div>
              </div>
              <div
                className={cn(
                  "flex w-full min-w-0 gap-1 rounded-lg bg-primary-foreground p-2 ring-2 ring-primary/50",
                  stepLayoutClasses.expectedBlock(isSideBySide)
                )}
                data-testid={`expected-result-${index}`}
              >
                <SearchCheck className="mt-1 h-7 w-7 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <ReadOnlyRichText
                    content={parseContent(step.expectedResult)}
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
