import React, { useState } from "react";
import {
  SearchCheck,
  ChevronRightCircle,
  Plus,
  Minus,
  Layers,
} from "lucide-react";
import TextFromJson from "@/components/TextFromJson";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { emptyEditorContent } from "~/app/constants";
import { useFindManySharedStepItem } from "~/lib/hooks";

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
}

interface RenderSharedGroupItemsProps {
  sharedStepGroupId: number;
  sharedStepGroupName: string;
  expandAll: boolean;
}

const RenderSharedGroupItems: React.FC<RenderSharedGroupItemsProps> = ({
  sharedStepGroupId,
  sharedStepGroupName,
  expandAll,
}) => {
  const t_steps = useTranslations("repository.steps");

  // Memoize the query options for useFindManySharedStepItem
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

  const { data: items, isLoading } = useFindManySharedStepItem(
    queryOptions,
    hookOptions
  );

  // console.log("RenderSharedGroupItems data:", {
  //   items,
  //   isLoading,
  //   sharedStepGroupId,
  // });

  if (isLoading) {
    return (
      <p className="ml-6 text-sm text-muted-foreground p-2">
        {t_steps("loadingSharedStepsItems")}
      </p>
    );
  }

  if (!items || items.length === 0) {
    return (
      <p className="ml-6 text-sm text-muted-foreground p-2">
        {t_steps("noStepsInSharedGroup")}
      </p>
    );
  }

  return (
    <div className="ml-6 mt-1 p-2 border-l-2 border-dashed border-primary/20 space-y-2 w-full pr-8">
      {items.map((item, itemIndex) => {
        // console.log("RenderSharedGroupItems mapping item:", {
        //   item,
        //   itemIndex,
        //   sharedStepGroupId,
        // });
        return (
          <div
            key={`shared-group-${sharedStepGroupId}-item-${item.id || itemIndex}`}
            className="border-2 border-primary/20 rounded-lg p-2"
          >
            <div className="font-semibold mb-1 text-foreground/80 flex items-start w-full">
              <div className="mr-2 font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-8 h-8">
                {item.order + 1}
              </div>
              <div className="w-full">
                {renderFieldValue(
                  item.step,
                  undefined,
                  `shared-${sharedStepGroupId}-item-${item.id || itemIndex}-step`,
                  expandAll,
                  false
                )}
              </div>
            </div>
            <div className="font-semibold mb-1 text-foreground/80 flex items-start">
              <SearchCheck className="mr-2 text-primary h-9 w-9 shrink-0" />
              <div className="w-full">
                {renderFieldValue(
                  item.expectedResult,
                  undefined,
                  `shared-${sharedStepGroupId}-item-${item.id || itemIndex}-expected`,
                  expandAll,
                  false
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
  expand: boolean,
  showDiff: boolean
) => {
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
    } catch (error) {
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
          expand={expand}
        />
      </div>
    );
  }

  if (previousFieldValue === undefined) {
    return (
      <div className="relative p-1 rounded">
        <div className="absolute inset-0 bg-green-500/20 rounded pointer-events-none" />
        <span className="relative text-green-600 dark:text-green-400 flex space-x-1 items-center">
          <div>
            <Plus className="w-4 h-4" />
          </div>
          <TextFromJson
            key={key}
            jsonString={fieldValueString}
            room={key}
            format="html"
            expand={expand}
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
        <div className="relative p-1 rounded">
          <div className="absolute inset-0 bg-red-500/20 rounded pointer-events-none" />
          <span className="relative text-red-600 dark:text-red-400 flex space-x-1 items-center">
            <div>
              <Minus className="w-4 h-4" />
            </div>
            <TextFromJson
              key={"prev" + key}
              jsonString={previousFieldValueString}
              room={"prev" + key}
              format="html"
              expand={expand}
            />
          </span>
        </div>
        <div className="relative p-1 rounded">
          <div className="absolute inset-0 bg-green-500/20 rounded pointer-events-none" />
          <span className="relative text-green-600 dark:text-green-400 flex space-x-1 items-center">
            <div>
              <Plus className="w-4 h-4" />
            </div>
            <TextFromJson
              key={key}
              jsonString={fieldValueString}
              room={key}
              format="html"
              expand={expand}
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
          expand={expand}
        />
      </div>
    );
  }
};

export const StepsDisplay: React.FC<StepsProps> = ({
  steps,
  previousSteps,
}) => {
  const [expandAll, setExpandAll] = useState(false);
  const t_repo = useTranslations("repository");
  const t_repo_steps = useTranslations("repository.steps");
  const tGlobal = useTranslations();

  if (!steps || steps.length === 0) {
    return null;
  }

  const showDiff = !!previousSteps;

  return (
    <div>
      <div className="flex items-center">
        <div className="font-bold">{tGlobal("common.fields.steps")}</div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setExpandAll(!expandAll);
                  return false;
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  return false;
                }}
              >
                <ChevronRightCircle
                  className={`h-4 w-4 shrink-0 transition-transform ${
                    expandAll ? "rotate-90" : ""
                  }`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <div>
                {expandAll ? t_repo_steps("collapse") : t_repo_steps("expand")}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {steps.length > 0 && (
        <ol className="ml-1 mr-6 min-w-[200px]">
          {steps.map((step, index) => {
            const previousStep = previousSteps
              ? previousSteps[index]
              : undefined;
            // console.log("StepsDisplay mapping step:", {
            //   step,
            //   index,
            //   isShared: step.isShared,
            //   sharedStepGroupId: step.sharedStepGroupId,
            // });

            if (step.sharedStepGroupId && !step.sharedStepGroup?.isDeleted) {
              // console.log("Rendering shared step group:", {
              //   sharedStepGroupId: step.sharedStepGroupId,
              //   sharedStepGroupName: step.sharedStepGroupName,
              // });
              return (
                <li
                  key={`shared-${step.sharedStepGroupId}-${index}`}
                  className="mb-4"
                >
                  <div className="flex flex-col items-start min-w-[200px] bg-muted/60 p-2 rounded-lg mb-2 border-2 border-primary/20">
                    <div className="flex items-center justify-between pb-2 space-x-2 cursor-default w-full">
                      <div className="flex items-center font-bold">
                        <div className="mr-2 font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-8 h-8">
                          {index + 1}
                        </div>
                        <Layers className="h-5 w-5 ml-1 mr-2 text-primary" />
                        {t_repo_steps("sharedStepGroupTitle", {
                          name:
                            step.sharedStepGroup?.name ||
                            step.sharedStepGroupName ||
                            "",
                        })}
                      </div>
                    </div>
                    <RenderSharedGroupItems
                      sharedStepGroupId={step.sharedStepGroupId}
                      sharedStepGroupName={
                        step.sharedStepGroup?.name ||
                        step.sharedStepGroupName ||
                        "Shared Steps"
                      }
                      expandAll={expandAll}
                    />
                  </div>
                </li>
              );
            } else if (step.sharedStepGroupId) {
              return null;
            }

            // Regular step rendering (existing logic)
            // console.log("Rendering regular step:", { step, index });
            return (
              <li key={`step-${step.id}-${index}`} className="mb-4">
                <div className="">
                  <div className="flex gap-2 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-b-none">
                    <div className="font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-8 h-8">
                      {index + 1}
                    </div>
                    <div>
                      {renderFieldValue(
                        step.step || "",
                        previousStep ? previousStep.step || "" : undefined,
                        step.id.toString(),
                        expandAll,
                        showDiff
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-t-none">
                    <SearchCheck className="text-primary h-9 w-9 shrink-0" />
                    {renderFieldValue(
                      step.expectedResult || "",
                      previousStep
                        ? previousStep.expectedResult || ""
                        : undefined,
                      step.id.toString() + "-expected",
                      expandAll,
                      showDiff
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {previousSteps && previousSteps.length > steps.length && (
            <li key="deleted-steps" className="mb-4">
              {previousSteps.slice(steps.length).map((step, index) => {
                const ensureValidJsonString = (value: any): string => {
                  if (!value) return JSON.stringify(emptyEditorContent);

                  try {
                    if (typeof value === "string") {
                      JSON.parse(value);
                      return value;
                    } else {
                      return JSON.stringify(value);
                    }
                  } catch (error) {
                    try {
                      const textContent = String(value);
                      if (textContent.startsWith('{"type":"doc","content":[')) {
                        try {
                          JSON.parse(textContent);
                          return textContent;
                        } catch {
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
                      return JSON.stringify(emptyEditorContent);
                    }
                  }
                };

                return (
                  <div key={`deleted-step-${step.id}-${index}`} className="">
                    <div className="flex gap-2 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-b-none">
                      <div className="font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-8 h-8">
                        {steps.length + index + 1}
                      </div>
                      <div className="relative p-1 rounded">
                        <div className="absolute inset-0 bg-red-500/20 rounded pointer-events-none" />
                        <span className="relative text-red-600 dark:text-red-400 flex space-x-1 items-center">
                          <div>
                            <Minus className="w-4 h-4" />
                          </div>
                          <TextFromJson
                            key={"prev" + step.id.toString()}
                            jsonString={ensureValidJsonString(step.step)}
                            room={"prev" + step.id.toString()}
                            format="html"
                            expand={expandAll}
                          />
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-t-none">
                      <SearchCheck className="text-primary h-9 w-9 shrink-0" />
                      <div className="relative p-1 rounded">
                        <div className="absolute inset-0 bg-red-500/20 rounded pointer-events-none" />
                        <span className="relative text-red-600 dark:text-red-400 flex space-x-1 items-center">
                          <div>
                            <Minus className="w-4 h-4" />
                          </div>
                          <TextFromJson
                            key={"prev" + step.id.toString() + "-expected"}
                            jsonString={ensureValidJsonString(step.expectedResult)}
                            room={"prev" + step.id.toString() + "-expected"}
                            format="html"
                            expand={expandAll}
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </li>
          )}
        </ol>
      )}
    </div>
  );
};
