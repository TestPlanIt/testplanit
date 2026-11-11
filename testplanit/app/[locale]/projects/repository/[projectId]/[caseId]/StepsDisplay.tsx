import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import TextFromJson from "@/components/TextFromJson";
import {
  StepLayoutToggle,
  stepLayoutClasses,
} from "@/components/steps/StepLayoutToggle";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import { Layers, Minus, Plus, SearchCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { emptyEditorContent } from "~/app/constants";
import { useStepLayout } from "~/hooks/useStepLayout";
import { cn } from "~/utils";

interface DisplayStep {
  id: number;
  step: any;
  expectedResult: any;
  order: number;
  sharedStepGroupId: number | null;
  isShared?: boolean;
  sharedStepGroupName?: string | null;
  sharedStepGroup?: { name: string | null; isDeleted: boolean } | null;
  isDeleted?: boolean;
  testCaseId?: number;
}

interface StepsProps {
  steps: DisplayStep[];
  previousSteps?: DisplayStep[];
  parameters?: ParameterChipMeta[];
}

interface RenderSharedGroupItemsProps {
  sharedStepGroupId: number;
  sharedStepGroupName: string;
  parameters?: ParameterChipMeta[];
  sideBySide: boolean;
}

// Ensure we have a valid JSON string for the TipTapEditor
const ensureValidJsonString = (value: any): string => {
  if (!value) return JSON.stringify(emptyEditorContent);

  try {
    // If it's already a string, try to parse it to validate it's JSON
    if (typeof value === "string") {
      // Try to parse it to make sure it's valid JSON
      JSON.parse(value);
      return value;
    } else {
      // If it's an object, stringify it
      return JSON.stringify(value);
    }
  } catch {
    // If parsing fails, it might be a plain string or invalid JSON
    // Try to wrap it in a document structure
    try {
      const textContent = String(value);
      // Basic check to see if it might already be a tiptap JSON structure
      if (textContent.startsWith('{"type":"doc","content":[')) {
        // It looks like a tiptap document, but parsing failed.
        // This might mean it's corrupted or a string representation of a tiptap doc.
        // Let's try to parse it as if it is, and if not, wrap it.
        try {
          JSON.parse(textContent);
          return textContent; // It was a stringified valid JSON
        } catch {
          // It's a string that looks like JSON but isn't, or some other string.
          // Wrap it as a paragraph.
          return JSON.stringify({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: textContent }],
              },
            ],
          });
        }
      }
      return JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: textContent }],
          },
        ],
      });
    } catch {
      // Last resort fallback
      return JSON.stringify(emptyEditorContent);
    }
  }
};

const StepNumberBadge: React.FC<{ number: number; testId?: string }> = ({
  number,
  testId,
}) => (
  <div
    className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary p-2 font-bold text-primary-foreground"
    data-testid={testId}
  >
    {number}
  </div>
);

interface StepPairProps {
  badge: React.ReactNode;
  step: React.ReactNode;
  expectedResult: React.ReactNode;
  sideBySide: boolean;
  expectedResultTestId?: string;
}

/**
 * A step and its expected result: stacked, or in two columns when the user
 * chose side by side and the container is wide enough for both to stay
 * readable.
 */
const StepPair: React.FC<StepPairProps> = ({
  badge,
  step,
  expectedResult,
  sideBySide,
  expectedResultTestId,
}) => (
  <div className={stepLayoutClasses.pair(sideBySide)}>
    <div
      className={cn(
        "flex w-full min-w-0 gap-2 rounded-lg bg-primary-foreground p-2 ring-2 ring-primary/50",
        stepLayoutClasses.stepBlock(sideBySide)
      )}
    >
      {badge}
      <div className="min-w-0 flex-1">{step}</div>
    </div>
    <div
      className={cn(
        "flex w-full min-w-0 gap-1 rounded-lg bg-primary-foreground p-2 ring-2 ring-primary/50",
        stepLayoutClasses.expectedBlock(sideBySide)
      )}
      data-testid={expectedResultTestId}
    >
      <SearchCheck className="mt-2 h-6 w-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">{expectedResult}</div>
    </div>
  </div>
);

const RenderSharedGroupItems: React.FC<RenderSharedGroupItemsProps> = ({
  sharedStepGroupId,
  sharedStepGroupName: _sharedStepGroupName,
  parameters,
  sideBySide,
}) => {
  const t_steps = useTranslations("repository.steps");

  // Memoize the query options for useClientQueries(schema).sharedStepItem.useFindMany
  const queryOptions = React.useMemo(
    () => ({
      where: {
        sharedStepGroupId,
        sharedStepGroup: { isDeleted: false },
      },
      orderBy: { order: "asc" as const },
    }),
    [sharedStepGroupId]
  );

  // Memoize the hook options
  const hookOptions = React.useMemo(
    () => ({
      enabled: !!sharedStepGroupId,
    }),
    [sharedStepGroupId]
  );

  const { data: items, isLoading } = useClientQueries(
    schema
  ).sharedStepItem.useFindMany(queryOptions, hookOptions);

  if (isLoading) {
    return (
      <p className="ms-6 p-2 text-sm text-muted-foreground">
        {t_steps("loadingSharedStepsItems")}
      </p>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="ms-6 p-2 text-sm text-muted-foreground">
        {t_steps("noStepsInSharedGroup")}
      </p>
    );
  }

  return (
    <div className="ms-6 mt-1 w-full space-y-2 border-s-2 border-dashed border-primary/20 p-2 pe-8">
      {items.map((item, itemIndex) => {
        const itemKey = `shared-${sharedStepGroupId}-item-${item.id || itemIndex}`;
        return (
          <div
            key={`shared-group-${sharedStepGroupId}-item-${item.id || itemIndex}`}
            className={cn(
              "rounded-lg border-2 border-primary/20 p-2",
              stepLayoutClasses.pair(sideBySide)
            )}
          >
            <div className="mb-1 flex w-full min-w-0 items-start font-semibold text-foreground/80">
              <div className="me-2 mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary p-2 font-bold text-primary-foreground">
                {item.order + 1}
              </div>
              <div className="w-full min-w-0">
                {renderFieldValue(
                  item.step,
                  undefined,
                  `${itemKey}-step`,
                  false,
                  parameters
                )}
              </div>
            </div>
            <div className="mb-1 flex min-w-0 items-start font-semibold text-foreground/80">
              <SearchCheck className="me-2 mt-2 h-6 w-6 shrink-0 text-primary" />
              <div className="w-full min-w-0">
                {renderFieldValue(
                  item.expectedResult,
                  undefined,
                  `${itemKey}-expected`,
                  false,
                  parameters
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const renderFieldValue = (
  fieldValue: any,
  previousFieldValue: any | undefined,
  key: string,
  showDiff: boolean,
  parameters?: ParameterChipMeta[]
) => {
  // Process the field values
  const fieldValueString = ensureValidJsonString(fieldValue);

  if (!showDiff) {
    return (
      <div>
        <TextFromJson
          key={key}
          jsonString={fieldValueString}
          room={key}
          format="html"
          parameters={parameters}
        />
      </div>
    );
  }

  if (previousFieldValue === undefined) {
    return (
      <div className="relative rounded p-1">
        <div className="pointer-events-none absolute inset-0 rounded bg-green-500/20" />
        <span className="relative flex items-center space-x-1 text-green-700 dark:text-green-400">
          <div>
            <Plus className="h-4 w-4" />
          </div>
          <TextFromJson
            key={key}
            jsonString={fieldValueString}
            room={key}
            format="html"
            parameters={parameters}
          />
        </span>
      </div>
    );
  }

  // Process previous field value
  const previousFieldValueString = ensureValidJsonString(previousFieldValue);

  // Compare the values to determine if they're different
  const areValuesDifferent = fieldValueString !== previousFieldValueString;

  if (areValuesDifferent) {
    return (
      <div>
        <div className="relative rounded p-1">
          <div className="pointer-events-none absolute inset-0 rounded bg-red-500/20" />
          <span className="relative flex items-center space-x-1 text-destructive">
            <div>
              <Minus className="h-4 w-4" />
            </div>
            <TextFromJson
              key={"prev" + key}
              jsonString={previousFieldValueString}
              room={"prev" + key}
              format="html"
              parameters={parameters}
            />
          </span>
        </div>
        <div className="relative rounded p-1">
          <div className="pointer-events-none absolute inset-0 rounded bg-green-500/20" />
          <span className="relative flex items-center space-x-1 text-green-700 dark:text-green-400">
            <div>
              <Plus className="h-4 w-4" />
            </div>
            <TextFromJson
              key={key}
              jsonString={fieldValueString}
              room={key}
              format="html"
              parameters={parameters}
            />
          </span>
        </div>
      </div>
    );
  } else {
    return (
      <div>
        <TextFromJson
          key={key}
          jsonString={fieldValueString}
          room={key}
          format="html"
          parameters={parameters}
        />
      </div>
    );
  }
};

const renderDeletedValue = (
  value: any,
  key: string,
  parameters?: ParameterChipMeta[]
) => (
  <div className="relative rounded p-1">
    <div className="pointer-events-none absolute inset-0 rounded bg-red-500/20" />
    <span className="relative flex items-center space-x-1 text-red-600 dark:text-red-400">
      <div>
        <Minus className="h-4 w-4" />
      </div>
      <TextFromJson
        key={key}
        jsonString={ensureValidJsonString(value)}
        room={key}
        format="html"
        parameters={parameters}
      />
    </span>
  </div>
);

export const StepsDisplay: React.FC<StepsProps> = ({
  steps,
  previousSteps,
  parameters,
}) => {
  const t_repo_steps = useTranslations("repository.steps");
  const tGlobal = useTranslations();
  const { layout, isSideBySide } = useStepLayout();

  if (!steps || steps.length === 0) {
    return null;
  }

  const showDiff = !!previousSteps;

  return (
    <div
      data-testid="steps-display"
      data-step-layout={layout}
      className={stepLayoutClasses.container}
    >
      <div className="flex items-center justify-between pb-2">
        <div className="font-bold">{tGlobal("common.fields.steps")}</div>
        <StepLayoutToggle />
      </div>
      {steps.length > 0 && (
        <ol className="ms-1 me-6 min-w-[200px]">
          {steps.map((step, index) => {
            const previousStep = previousSteps
              ? previousSteps[index]
              : undefined;

            if (step.sharedStepGroupId && !step.sharedStepGroup?.isDeleted) {
              return (
                <li
                  key={`shared-${step.sharedStepGroupId}-${index}`}
                  className="mb-4"
                  data-testid={`step-container-${index}`}
                >
                  <div
                    className="mb-2 flex min-w-[200px] flex-col items-start rounded-lg border-2 border-primary/20 bg-muted/60 p-2"
                    data-testid="shared-step-group"
                  >
                    <div className="flex w-full cursor-default items-center justify-between space-x-2 pb-2">
                      <div className="flex items-center font-bold">
                        <div
                          className="me-2 mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary p-2 font-bold text-primary-foreground"
                          data-testid={`step-badge-${index}`}
                        >
                          {index + 1}
                        </div>
                        <Layers className="ms-1 me-2 h-5 w-5 text-primary" />
                        {t_repo_steps("sharedStepGroupTitle", {
                          name:
                            step.sharedStepGroup?.name ||
                            step.sharedStepGroupName ||
                            "",
                        })}
                      </div>
                    </div>
                    <div data-testid="expand-shared-steps" className="w-full">
                      <RenderSharedGroupItems
                        sharedStepGroupId={step.sharedStepGroupId}
                        sharedStepGroupName={
                          step.sharedStepGroup?.name ||
                          step.sharedStepGroupName ||
                          "Shared Steps"
                        }
                        parameters={parameters}
                        sideBySide={isSideBySide}
                      />
                    </div>
                  </div>
                </li>
              );
            } else if (step.sharedStepGroupId) {
              return null;
            }

            return (
              <li
                key={`step-${step.id}-${index}`}
                className="mb-4"
                data-testid={`step-container-${index}`}
              >
                <StepPair
                  sideBySide={isSideBySide}
                  badge={
                    <StepNumberBadge
                      number={index + 1}
                      testId={`step-badge-${index}`}
                    />
                  }
                  step={renderFieldValue(
                    step.step || "",
                    previousStep ? previousStep.step || "" : undefined,
                    step.id.toString(),
                    showDiff,
                    parameters
                  )}
                  expectedResult={renderFieldValue(
                    step.expectedResult || "",
                    previousStep
                      ? previousStep.expectedResult || ""
                      : undefined,
                    step.id.toString() + "-expected",
                    showDiff,
                    parameters
                  )}
                  expectedResultTestId={`expected-result-${index}`}
                />
              </li>
            );
          })}
          {previousSteps && previousSteps.length > steps.length && (
            <li key="deleted-steps" className="mb-4">
              {previousSteps.slice(steps.length).map((step, index) => (
                <StepPair
                  key={`deleted-step-${step.id}-${index}`}
                  sideBySide={isSideBySide}
                  badge={<StepNumberBadge number={steps.length + index + 1} />}
                  step={renderDeletedValue(
                    step.step,
                    "prev" + step.id.toString(),
                    parameters
                  )}
                  expectedResult={renderDeletedValue(
                    step.expectedResult,
                    "prev" + step.id.toString() + "-expected",
                    parameters
                  )}
                />
              ))}
            </li>
          )}
        </ol>
      )}
    </div>
  );
};
