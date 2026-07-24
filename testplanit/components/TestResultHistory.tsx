import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { DateFormatter } from "@/components/DateFormatter";
import { formatSeconds } from "@/components/DurationDisplay";
import LoadingSpinner from "@/components/LoadingSpinner";
import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import { AttachmentsListDisplay } from "@/components/tables/AttachmentsListDisplay";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import TextFromJson from "@/components/TextFromJson";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Attachments, Issue } from "~/zenstack/models";
import type { JsonValue } from "@zenstackhq/orm";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Combine,
  History,
  Layers,
  LinkIcon,
  ListOrdered,
  Lock,
  Pencil,
  PlayCircle,
  PlusSquare,
  SearchCheck,
  Trash2,
  SquareStack,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useCallback, useState } from "react";
import { toast } from "sonner";
import { emptyEditorContent } from "~/app/constants";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { EditResultModal } from "~/app/[locale]/projects/repository/[projectId]/EditResultModal";
import FieldValueRenderer from "~/app/[locale]/projects/repository/[projectId]/[caseId]/FieldValueRenderer";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { resolveEffectiveWindowSeconds } from "~/lib/services/editWindow";
import { Link } from "~/lib/navigation";
import { getDateFnsLocale } from "~/utils/locales";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import TipTapEditor from "./tiptap/TipTapEditor";

// Define unified result types
interface UnifiedTestResultBase {
  displayId: string; // For UI keys, e.g., "manual-123", "junit-456", "pending-789"
  sourceType: "manual" | "junit" | "pending";
  executedAt: Date; // Key for sorting
  status: { name: string; color?: { value: string } };
  elapsed?: number | null; // Total duration for display
  attachments?: Attachments[];
  issues?: Issue[];
  isPending: boolean;
  associatedTestRun?: {
    id: number;
    name: string;
    milestone?: { name: string } | null;
    isCompleted: boolean;
    isDeleted: boolean;
    configurationGroupId?: number | null;
    configuration?: { id: number; name: string } | null;
  };
  associatedTestRunCaseId?: number; // TestRunCases.id, for manual/pending
}

interface ManualTestResult extends UnifiedTestResultBase {
  sourceType: "manual";
  originalDbId: number; // TestRunResults.id
  testRunCaseVersion: number;
  executedBy: { id: string; name: string };
  editedBy?: { id: string; name: string } | null;
  editedAt?: Date | null;
  notes?: JsonValue; // Tiptap content
  attempt: number;
  resultFieldValues?: { id: number }[];
  /**
   * The iteration this result was recorded against. `null` for
   * non-parameterized test cases. The row-level icon column shows the
   * SquareStack icon when this is non-null; the expanded panel renders the
   * parameter values block from `valuesJson` against the snapshot's
   * parameter schema.
   */
  iteration?: {
    id: number;
    label: string | null;
    rowIndex: number;
    valuesJson: JsonValue;
    parameterSchema: Array<{
      name: string;
      type: string;
      sensitive: boolean;
    }>;
  } | null;
  stepResults?: Array<{
    id: number;
    status: { name: string; color: { value: string } };
    notes: JsonValue;
    evidence: JsonValue;
    elapsed: number | null;
    sharedStepItemId?: number | null;
    step: {
      id: number;
      step: JsonValue;
      expectedResult: JsonValue;
      sharedStepGroupId?: number | null;
      sharedStepGroup?: { name: string | null } | null;
    };
    issues?: Issue[];
  }>;
}

interface JUnitTestResultInfo extends UnifiedTestResultBase {
  sourceType: "junit";
  originalDbId: number; // JUnitTestResult.id
  executedBy: { id: string; name: string }; // from JUnitTestResult.createdBy
  content?: string; // JUnitTestResult.content (raw string)
  systemOut?: string;
  systemErr?: string;
  file?: string;
  line?: number;
  assertions?: number;
  message?: string;
  type?: string;
  testSuiteName?: string; // from JUnitTestResult.testSuite.name
}

interface PendingTestResult extends UnifiedTestResultBase {
  sourceType: "pending";
  executedBy: { id: string; name: string }; // Placeholder
}

type UnifiedTestResult =
  ManualTestResult | JUnitTestResultInfo | PendingTestResult;

interface TestResultHistoryProps {
  caseId: number;
  projectId?: number;
  session?: any; // We'll use any for now since we don't have the full session type
}

const AddToTestRunDropdown = React.memo(function AddToTestRunDropdown({
  caseId,
  projectId,
}: {
  caseId: number;
  projectId: number;
}) {
  const tCommon = useTranslations("common");
  const tRunComposition = useTranslations("runs.composition");
  const queryClient = useQueryClient();
  const { data: testRuns } = useClientQueries(schema).testRuns.useFindMany({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isCompleted: false },
        { isDeleted: false },
        {
          NOT: {
            testCases: {
              some: {
                repositoryCaseId: caseId,
                isDeleted: false,
              },
            },
          },
        },
      ],
    },
    include: {
      configuration: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const { mutateAsync: createTestRunCase } =
    useClientQueries(schema).testRunCases.useCreate();

  const handleAddToTestRun = async (testRunId: number, isLocked: boolean) => {
    // A composition-locked run's case set is frozen — the create would be
    // rejected by the policy/DB guard (422). Stop early with a clear message.
    if (isLocked) {
      toast.error(tRunComposition("addBlocked"));
      return;
    }
    try {
      // Just add the test case to the end
      await createTestRunCase({
        data: {
          testRunId,
          repositoryCaseId: caseId,
          order: 999, // High number to ensure it's at the end
        },
      });

      // Invalidate the queries to refresh the data
      await queryClient.invalidateQueries({ queryKey: ["testRuns"] });
      toast.success(tCommon("actions.addedToTestRun"), {
        description: tCommon("actions.addedToTestRunDescription"),
      });
    } catch (error) {
      console.error("Error adding test case to test run:", error);
      toast.error(tCommon("errors.error"), {
        description: tCommon("errors.somethingWentWrong"),
      });
    }
  };

  if (!testRuns?.length) {
    return (
      <DropdownMenuLabel>
        {tCommon("actions.noAvailableTestRuns")}
      </DropdownMenuLabel>
    );
  }

  return (
    <>
      {testRuns.map((testRun) => (
        <DropdownMenuItem
          key={testRun.id}
          onClick={() =>
            handleAddToTestRun(
              testRun.id,
              !!(testRun as any).compositionLockedAt
            )
          }
          className="flex items-center"
        >
          <PlayCircle className="me-1 h-4 w-4 shrink-0" />
          <span className="truncate">{testRun.name}</span>
          {(testRun as any).configurationGroupId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ms-1 shrink-0">
                  <Combine className="w-3 h-3 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-background/50">
                  {tCommon("labels.multiConfiguration")}
                </p>
                {testRun.configuration && (
                  <p className="flex text-xs text-background">
                    <Combine className="w-3 h-3 shrink-0 me-1" />
                    {testRun.configuration.name}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
          {(testRun as any).compositionLockedAt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ms-1 shrink-0">
                  <Lock className="w-3 h-3 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {tCommon("labels.compositionLocked")}
              </TooltipContent>
            </Tooltip>
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
});

// Component to display result field values
const ResultFieldValuesDisplay = ({
  // Renamed to avoid conflict if original is kept
  resultId,
  result, // Expecting ManualTestResult here
  session,
}: {
  resultId: number;
  result: ManualTestResult;
  session: any;
}) => {
  const tCommon = useTranslations("common");

  const { data: fieldValues, isLoading } = useClientQueries(
    schema
  ).resultFieldValues.useFindMany(
    {
      where: {
        testRunResultsId: resultId,
      },
      include: {
        field: {
          include: {
            type: true,
            fieldOptions: {
              include: {
                fieldOption: {
                  include: {
                    icon: true,
                    iconColor: true,
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      enabled: !!resultId,
    }
  );

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <LoadingSpinner className="h-6" />
      </div>
    );
  }

  if (!fieldValues || fieldValues.length === 0) {
    // The check against stepResults length is removed as this component is now only for manual results
    // which might or might not have step results, but custom fields are independent.
    if (!result.stepResults || result.stepResults.length === 0) {
      return (
        <div className="px-4 py-2 text-sm text-muted-foreground">
          {tCommon("status.noCustomFieldData")}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="px-4 py-2 space-y-4">
      {fieldValues.map((fieldValue) => (
        <div key={fieldValue.id} className="flex flex-col">
          <span className="text-xs font-medium text-muted-foreground">
            {fieldValue.field.displayName}
          </span>
          <div className="text-sm mt-1">
            <FieldValueRenderer
              fieldValue={fieldValue.value}
              fieldType={fieldValue.field.type.type}
              caseId={resultId.toString()} // resultId is numeric, convert to string for caseId prop
              template={{
                caseFields: [
                  {
                    caseField: {
                      ...fieldValue.field,
                      fieldOptions: fieldValue.field.fieldOptions.map((fo) => ({
                        fieldOption: fo.fieldOption,
                      })),
                    },
                  },
                ],
              }}
              fieldId={fieldValue.field.id}
              session={session} // Pass session along
              isEditMode={false}
              isSubmitting={false}
              control={null}
              errors={null}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

// Add a component to display step results
const StepResultsDisplay = ({
  stepResults,
  projectId,
  resultId,
}: {
  stepResults: NonNullable<ManualTestResult["stepResults"]>;
  projectId: number;
  resultId: number;
}) => {
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const tRepository = useTranslations("repository"); // For repository level translations

  if (!stepResults || stepResults.length === 0) {
    return null;
  }

  const renderedSharedGroupIds = new Set<number>();
  let stepCounter = 0; // Initialize step counter

  return (
    <div className="px-4 py-2">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        {tCommon("fields.steps")}
      </div>
      <div className="space-y-4">
        {stepResults.map((stepResult, index) => {
          // Handle shared step group
          if (stepResult.step.sharedStepGroupId) {
            if (
              !renderedSharedGroupIds.has(stepResult.step.sharedStepGroupId)
            ) {
              // This specific shared group's header hasn't been rendered yet.
              // Render the header and the list of its items.
              renderedSharedGroupIds.add(stepResult.step.sharedStepGroupId);
              stepCounter++; // Increment for shared group header
              return (
                <div
                  key={`result-${resultId}-shared-group-${stepResult.step.sharedStepGroupId}`}
                >
                  <div className="font-bold truncate flex items-center mb-1">
                    <div className="flex items-center">
                      <Layers
                        size={16}
                        className="me-2 text-primary shrink-0"
                      />
                      {tCommon("fields.step")} {stepCounter} -{" "}
                      {stepResult.step.sharedStepGroup?.name ||
                        tCommon("fields.steps")}
                      <span className="text-xs text-muted-foreground ms-1">
                        {tRepository("steps.sharedGroupSuffix")}
                      </span>
                    </div>
                  </div>
                  <RenderSharedGroupInHistoryList
                    sharedStepGroupId={stepResult.step.sharedStepGroupId}
                    placeholderStepId={stepResult.step.id} // ID of the Step that is the placeholder
                    testRunResultId={resultId}
                    allStepResultsForRun={stepResults}
                    projectId={projectId}
                  />
                </div>
              );
            } else {
              // This shared group's header was already rendered.
              // Individual item results are handled by RenderSharedGroupInHistoryList.
              // Don't render anything additional for this stepResult in the main loop.
              return null;
            }
          } else {
            // This is a regular step (not part of any shared group). Render it.
            stepCounter++; // Increment for regular step
            let stepContent;
            try {
              stepContent =
                typeof stepResult.step.step === "string"
                  ? JSON.parse(stepResult.step.step)
                  : stepResult.step.step;
            } catch {
              // console.warn("Error parsing step content:", error);
              stepContent = emptyEditorContent;
            }

            let expectedResultContent;
            try {
              expectedResultContent = stepResult.step.expectedResult
                ? typeof stepResult.step.expectedResult === "string"
                  ? JSON.parse(stepResult.step.expectedResult)
                  : stepResult.step.expectedResult
                : emptyEditorContent;
            } catch {
              expectedResultContent = emptyEditorContent;
            }

            return (
              <div
                key={`result-${resultId}-step-${stepResult.id}-${index}`}
                className="space-y-2 border rounded-lg p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm flex items-center gap-2">
                    <ListOrdered className="h-4 w-4 shrink-0" />
                    {tCommon("fields.step")} {stepCounter}
                  </div>
                  <Badge
                    variant="outline"
                    style={{
                      backgroundColor: stepResult.status.color.value,
                      color: "white",
                      borderColor: stepResult.status.color.value,
                    }}
                    className="shrink-0"
                  >
                    {stepResult.status.name}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="bg-muted/30 rounded-lg p-2">
                    <TipTapEditor
                      content={stepContent as object}
                      readOnly={true}
                      projectId={projectId ? String(projectId) : undefined}
                      className="prose-sm"
                    />
                  </div>
                  <div className="bg-muted/30 rounded-lg p-2">
                    <div className="text-xs text-muted-foreground mb-1">
                      {tCommon("fields.expectedResult")}
                    </div>
                    <TipTapEditor
                      content={expectedResultContent as object}
                      readOnly={true}
                      projectId={projectId ? String(projectId) : undefined}
                      className="prose-sm"
                    />
                  </div>
                  {stepResult.notes && !isTiptapEmpty(stepResult.notes) && (
                    <div className="bg-muted/30 rounded-lg p-2">
                      <div className="text-xs text-muted-foreground mb-1">
                        {tCommon("actions.resultDetails")}
                      </div>
                      <TipTapEditor
                        content={stepResult.notes as object}
                        readOnly={true}
                        projectId={projectId ? String(projectId) : undefined}
                        className="prose-sm"
                      />
                    </div>
                  )}
                  {stepResult.elapsed && stepResult.elapsed > 0 && (
                    <div className="text-xs text-muted-foreground mt-2">
                      {tCommon("fields.elapsed")}:{" "}
                      {formatSeconds(stepResult.elapsed, locale)}
                    </div>
                  )}
                  {/* Display issues for the step */}
                  {stepResult.issues && stepResult.issues.length > 0 && (
                    <div className="mt-2">
                      <IssuesListDisplay
                        issues={stepResult.issues.map((issue) => ({
                          ...issue,
                          projectIds: [projectId],
                        }))}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          }
        })}
      </div>
    </div>
  );
};

// New component to render items of a shared step group in history
const RenderSharedGroupInHistoryList: React.FC<{
  sharedStepGroupId: number;
  placeholderStepId: number;
  testRunResultId: number;
  allStepResultsForRun: NonNullable<ManualTestResult["stepResults"]>;
  projectId: number;
}> = ({
  sharedStepGroupId,
  placeholderStepId,
  testRunResultId,
  allStepResultsForRun,
  projectId,
}) => {
  const tRepository = useTranslations("repository");
  const tCommon = useTranslations("common");
  const locale = useLocale();

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
      <div className="ms-4 ps-4 py-4 border-s border-dashed">
        <LoadingSpinner className="h-6" />
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="ms-4 ps-4 text-sm text-muted-foreground py-1 border-s border-dashed">
        {tRepository("steps.noStepsInSharedGroup")}
      </div>
    );
  }

  return (
    <ol className="list-decimal overflow-hidden w-full ps-8 border-s border-dashed ms-4 pe-4">
      {items.map((item, itemIndex) => {
        const stepContentString = item.step
          ? typeof item.step === "string"
            ? item.step
            : JSON.stringify(item.step)
          : JSON.stringify(emptyEditorContent);

        const expectedResultString = item.expectedResult
          ? typeof item.expectedResult === "string"
            ? item.expectedResult
            : JSON.stringify(item.expectedResult)
          : JSON.stringify(emptyEditorContent);

        // Find the result for this specific shared item within this specific test run result
        const itemResult = allStepResultsForRun.find(
          (sr) =>
            sr.sharedStepItemId === item.id &&
            sr.step.id === placeholderStepId &&
            sr.id !== 0 // sr.id !==0 is a temporary fix for a potential data issue
        );

        return (
          <li
            key={`result-${testRunResultId}-shared-${sharedStepGroupId}-item-${item.id || itemIndex}`}
            className="mb-4 p-4 border rounded-md bg-muted/20"
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="truncate font-semibold">
                  <TextFromJson
                    jsonString={stepContentString}
                    room={`shared-history-list-${sharedStepGroupId}-item-${item.id || itemIndex}-step`}
                  />
                </div>
                <div className="text-sm flex items-center gap-1 truncate mt-1 text-muted-foreground">
                  <SearchCheck className="h-4 w-4 shrink-0" />
                  <TextFromJson
                    jsonString={expectedResultString}
                    room={`shared-history-list-${sharedStepGroupId}-item-${item.id || itemIndex}-expected`}
                  />
                </div>
              </div>
              {itemResult && (
                <Badge
                  variant="outline"
                  style={{
                    backgroundColor: itemResult.status.color.value,
                    color: "white",
                    borderColor: itemResult.status.color.value,
                  }}
                  className="ms-2 shrink-0"
                >
                  {itemResult.status.name}
                </Badge>
              )}
            </div>
            {itemResult?.notes && !isTiptapEmpty(itemResult.notes) && (
              <div className="mt-2 p-2 bg-background rounded-md">
                <div className="text-xs text-muted-foreground mb-1">
                  {tCommon("actions.resultDetails")}
                </div>
                <TipTapEditor
                  content={itemResult.notes as object}
                  readOnly={true}
                  projectId={projectId ? String(projectId) : undefined}
                  className="prose-sm"
                />
              </div>
            )}
            {itemResult?.elapsed && itemResult.elapsed > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {tCommon("fields.elapsed")}:{" "}
                {formatSeconds(itemResult.elapsed, locale)}
              </div>
            )}
            {/* Display issues for the shared step item */}
            {itemResult?.issues && itemResult.issues.length > 0 && (
              <div className="mt-2">
                <IssuesListDisplay
                  issues={itemResult.issues.map((issue) => ({
                    ...issue,
                    projectIds: [projectId],
                  }))}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default function TestResultHistory({
  caseId,
  projectId,
  session,
}: TestResultHistoryProps) {
  const tCommon = useTranslations("common");
  const tCases = useTranslations("repository.cases");
  const tParams = useTranslations("parameters");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const [expandedResults, setExpandedResults] = useState<
    Set<string>
  > // Changed to Set<string>
  (new Set());
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [editingResult, setEditingResult] = useState<{
    id: number; // This is originalDbId of a ManualTestResult
    testRunId: number;
    testRunCaseId: number;
  } | null>(null);

  // Fetch app config for edit duration
  const { data: appConfigData } = useClientQueries(
    schema
  ).appConfig.useFindMany({
    where: { key: "edit_results_duration" },
  });

  const editResultsDurationSeconds = appConfigData?.find(
    (config) => config.key === "edit_results_duration"
  )?.value as number | undefined;

  // Per-project edit-window override, resolved against the system ceiling so
  // the Edit button matches the server guard in submit-result's sibling path.
  const { data: editWindowProject } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      select: { editResultsDurationSeconds: true },
    },
    { enabled: Boolean(projectId) }
  );
  const projectEditWindowSeconds =
    editWindowProject?.editResultsDurationSeconds ?? null;

  // Fetch test case data
  const { data: fetchedTestCase, isLoading: isLoadingTestCase } =
    useClientQueries(schema).repositoryCases.useFindFirst(
      {
        where: { id: Number(caseId), isDeleted: false },
        select: {
          id: true,
          name: true, // Added name for EditResultModal
          project: { select: { id: true, name: true } },
          steps: {
            // Added steps for EditResultModal
            orderBy: { order: "asc" },
          },
          testRuns: {
            // These are TestRunCases records
            select: {
              id: true, // TestRunCases.id
              testRun: {
                // The actual TestRun
                select: {
                  id: true,
                  name: true,
                  milestone: { select: { name: true } },
                  isCompleted: true,
                  isDeleted: true,
                  configurationGroupId: true,
                  configuration: { select: { id: true, name: true } },
                },
              },
              results: {
                // TestRunResult records for this TestRunCases
                select: {
                  id: true,
                  testRunCaseId: true, // This is TestRunCases.id
                  testRunCaseVersion: true,
                  // Iteration this result was recorded against (if any).
                  // Drives the SquareStack-icon row indicator + the Parameter
                  // Values block in the expanded panel. Non-parameterized
                  // results have iteration: null.
                  iteration: {
                    select: {
                      id: true,
                      label: true,
                      rowIndex: true,
                      valuesJson: true,
                      testRunCase: {
                        select: {
                          dataSetSnapshot: {
                            select: { parametersJson: true },
                          },
                        },
                      },
                    },
                  },
                  status: {
                    select: { name: true, color: { select: { value: true } } },
                  },
                  executedBy: { select: { id: true, name: true } },
                  executedAt: true,
                  editedBy: { select: { id: true, name: true } },
                  editedAt: true,
                  elapsed: true,
                  notes: true,
                  attempt: true,
                  resultFieldValues: { select: { id: true }, take: 1 }, // For hasCustomFields check
                  attachments: {
                    where: { isDeleted: false },
                    select: {
                      id: true,
                      name: true,
                      url: true,
                      note: true,
                      mimeType: true,
                      size: true,
                      createdAt: true,
                      createdById: true,
                      isDeleted: true,
                      testCaseId: true,
                      sessionId: true,
                      sessionResultsId: true,
                      testRunsId: true,
                      testRunResultsId: true,
                      testRunStepResultId: true,
                    },
                  },
                  stepResults: {
                    select: {
                      id: true,
                      sharedStepItemId: true,
                      stepStatus: {
                        // This will be mapped to 'status'
                        select: {
                          name: true,
                          color: { select: { value: true } },
                        },
                      },
                      notes: true,
                      evidence: true,
                      elapsed: true,
                      step: {
                        select: {
                          id: true,
                          step: true,
                          expectedResult: true,
                          sharedStepGroupId: true,
                          sharedStepGroup: {
                            select: {
                              name: true,
                            },
                          },
                        },
                      },
                      issues: {
                        include: {
                          integration: {
                            select: {
                              id: true,
                              provider: true,
                              name: true,
                            },
                          },
                        },
                      },
                    },
                    orderBy: [
                      { step: { order: "asc" } },
                      { sharedStepItem: { order: "asc" } },
                    ],
                    where: { isDeleted: false },
                  },
                  issues: {
                    include: {
                      integration: {
                        select: {
                          id: true,
                          provider: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          junitResults: {
            select: {
              id: true,
              type: true,
              message: true,
              content: true,
              executedAt: true,
              time: true,
              assertions: true,
              file: true,
              line: true,
              systemOut: true,
              systemErr: true,
              status: {
                select: { name: true, color: { select: { value: true } } },
              },
              createdBy: { select: { id: true, name: true } },
              testSuite: {
                // For linking to a TestRun if applicable
                select: {
                  name: true,
                  testRunId: true,
                  testRun: {
                    select: {
                      id: true,
                      name: true,
                      milestone: { select: { name: true } },
                      isCompleted: true,
                      isDeleted: true,
                      configurationGroupId: true,
                      configuration: { select: { id: true, name: true } },
                    },
                  },
                },
              },
              attachments: {
                where: { isDeleted: false },
                select: {
                  id: true,
                  name: true,
                  url: true,
                  note: true,
                  mimeType: true,
                  size: true,
                  createdAt: true,
                  createdById: true,
                  isDeleted: true,
                  testCaseId: true,
                  sessionId: true,
                  sessionResultsId: true,
                  testRunsId: true,
                  testRunResultsId: true,
                  testRunStepResultId: true,
                  junitTestResultId: true,
                },
              },
            },
            orderBy: { executedAt: "desc" },
          },
          source: true,
        },
      },
      { enabled: !!caseId }
    ) as any; // Cast to any to handle complex select/include types for now

  const activeProjectId = projectId || fetchedTestCase?.project?.id;

  const {
    permissions: testRunPermissions,
    isLoading: isLoadingTestRunPermissions,
  } = useProjectPermissions(activeProjectId ?? -1, "TestRuns");
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;

  const {
    permissions: testRunResultPermissions,
    isLoading: isLoadingResultPermissions,
  } = useProjectPermissions(activeProjectId ?? -1, "TestRunResults");
  const canAddEditResults = testRunResultPermissions?.canAddEdit ?? false;

  const handleSelect = useCallback(
    (attachments: Attachments[], index: number) => {
      setSelectedAttachments(attachments);
      setSelectedAttachmentIndex(index);
    },
    []
  );

  const handleClose = useCallback(() => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  }, []);

  if (isLoadingTestCase) {
    return (
      <Card shadow="none">
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            <History className="w-5 h-5" />
            {tCases("testResultHistory")}
          </CardTitle>
          <CardDescription>
            {tCases("testResultHistoryDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoadingSpinner className="py-8" />
        </CardContent>
      </Card>
    );
  }

  const toggleExpanded = (resultDisplayId: string) => {
    setExpandedResults((prev) => {
      const newSet = new Set(prev);
      if (resultDisplayId === "all") {
        const nonPendingIds = sortedResults
          .filter((r) => !r.isPending)
          .map((r) => r.displayId);
        const areAllExpanded =
          nonPendingIds.length > 0 && nonPendingIds.every((id) => prev.has(id));
        if (areAllExpanded) {
          return new Set<string>();
        } else {
          nonPendingIds.forEach((id) => newSet.add(id));
          return newSet;
        }
      } else {
        if (newSet.has(resultDisplayId)) {
          newSet.delete(resultDisplayId);
        } else {
          newSet.add(resultDisplayId);
        }
        return newSet;
      }
    });
  };

  const showAddToTestRun = !isAutomatedCaseSource(fetchedTestCase?.source);

  if (!fetchedTestCase) {
    return (
      <Card shadow="none">
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            <History className="w-5 h-5" />
            {tCases("testResultHistory")}
          </CardTitle>
          <CardDescription>
            {tCases("testResultHistoryDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {tCases("noTestResults")}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (typeof activeProjectId !== "number") {
    return null;
  }

  const allUnifiedResults: UnifiedTestResult[] = [];

  // 1. Process Manual Results from TestRunCases
  fetchedTestCase.testRuns?.forEach((trc: any) => {
    trc.results?.forEach((res: any) => {
      allUnifiedResults.push({
        displayId: `manual-${res.id}`,
        sourceType: "manual",
        originalDbId: res.id,
        executedAt: new Date(res.executedAt),
        status: res.status,
        elapsed: res.elapsed,
        attachments: res.attachments,
        issues: res.issues,
        isPending: false,
        associatedTestRun: trc.testRun
          ? {
              id: trc.testRun.id,
              name: trc.testRun.name,
              milestone: trc.testRun.milestone,
              isCompleted: trc.testRun.isCompleted,
              isDeleted: trc.testRun.isDeleted,
              configurationGroupId: trc.testRun.configurationGroupId,
              configuration: trc.testRun.configuration,
            }
          : undefined,
        associatedTestRunCaseId: trc.id,
        testRunCaseVersion: res.testRunCaseVersion,
        executedBy: res.executedBy,
        editedBy: res.editedBy,
        editedAt: res.editedAt ? new Date(res.editedAt) : null,
        notes: res.notes,
        attempt: res.attempt,
        resultFieldValues: res.resultFieldValues,
        // Flatten the snapshot's parametersJson onto the iteration so
        // downstream consumers (row icon + expanded Parameter Values
        // block) don't need to traverse through testRunCase.dataSetSnapshot.
        iteration: res.iteration
          ? {
              id: res.iteration.id,
              label: res.iteration.label,
              rowIndex: res.iteration.rowIndex,
              valuesJson: res.iteration.valuesJson,
              parameterSchema: Array.isArray(
                res.iteration.testRunCase?.dataSetSnapshot?.parametersJson
              )
                ? (
                    res.iteration.testRunCase.dataSetSnapshot
                      .parametersJson as Array<Record<string, unknown>>
                  )
                    .filter(
                      (p) =>
                        p && typeof p === "object" && typeof p.name === "string"
                    )
                    .map((p) => ({
                      name: String(p.name),
                      type: typeof p.type === "string" ? p.type : "STRING",
                      sensitive: p.sensitive === true,
                    }))
                : [],
            }
          : null,
        stepResults: (res.stepResults as any[] | undefined)?.map(
          (stepResItem: any) => ({
            ...stepResItem,
            status: stepResItem.stepStatus,
          })
        ),
      });
    });
  });

  // 2. Process JUnit Results
  fetchedTestCase.junitResults?.forEach((jr: any) => {
    const associatedTestRun =
      jr.testSuite?.testRunId && jr.testSuite.testRun
        ? {
            id: jr.testSuite.testRun.id,
            name: jr.testSuite.testRun.name,
            milestone: jr.testSuite.testRun.milestone,
            isCompleted: jr.testSuite.testRun.isCompleted,
            isDeleted: jr.testSuite.testRun.isDeleted,
            configurationGroupId: jr.testSuite.testRun.configurationGroupId,
            configuration: jr.testSuite.testRun.configuration,
          }
        : undefined;

    allUnifiedResults.push({
      displayId: `junit-${jr.id}`,
      sourceType: "junit",
      originalDbId: jr.id,
      executedAt: new Date(jr.executedAt),
      status: jr.status,
      elapsed: jr.time,
      attachments: jr.attachments || [], // Fallback to empty array
      issues: [], // JUnitTestResult doesn't have issues relation
      isPending: false,
      associatedTestRun,
      executedBy: jr.createdBy,
      content: jr.content,
      systemOut: jr.systemOut,
      systemErr: jr.systemErr,
      file: jr.file,
      line: jr.line,
      assertions: jr.assertions,
      message: jr.message,
      type: jr.type,
      testSuiteName: jr.testSuite?.name,
    });
  });

  // 3. Identify Pending Results
  const executedOrCoveredTrcIds = new Set<number>();
  allUnifiedResults.forEach((r) => {
    // If a manual result exists for a TRC, it's covered.
    if (r.sourceType === "manual" && r.associatedTestRunCaseId) {
      executedOrCoveredTrcIds.add(r.associatedTestRunCaseId);
    }
    // If a JUnit result is explicitly linked to the same TestRun as a TRC, consider that TRC covered.
    if (r.sourceType === "junit" && r.associatedTestRun) {
      const correspondingTrc = fetchedTestCase.testRuns?.find(
        (trcItem: any) => trcItem.testRun?.id === r.associatedTestRun?.id
      );
      if (correspondingTrc) {
        executedOrCoveredTrcIds.add(correspondingTrc.id);
      }
    }
  });

  fetchedTestCase.testRuns?.forEach((trc: any) => {
    if (!executedOrCoveredTrcIds.has(trc.id)) {
      allUnifiedResults.push({
        displayId: `pending-${trc.id}`, // Use TestRunCases.id for pending displayId
        sourceType: "pending",
        executedAt: new Date(),
        status: {
          name: tCommon("status.pending"),
          color: { value: "#B1B2B3" },
        },
        isPending: true,
        associatedTestRun: trc.testRun
          ? {
              id: trc.testRun.id,
              name: trc.testRun.name,
              milestone: trc.testRun.milestone,
              isCompleted: trc.testRun.isCompleted,
              isDeleted: trc.testRun.isDeleted,
              configurationGroupId: trc.testRun.configurationGroupId,
              configuration: trc.testRun.configuration,
            }
          : undefined,
        associatedTestRunCaseId: trc.id,
        executedBy: { id: "", name: "-" },
      });
    }
  });

  // Sort results: pending first, then by executedAt descending
  const sortedResults = allUnifiedResults.sort((a, b) => {
    if (a.isPending && !b.isPending) return -1;
    if (!a.isPending && b.isPending) return 1;
    return new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime();
  });

  if (!sortedResults.length) {
    return (
      <Card shadow="none">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-1">
              <History className="w-5 h-5" />
              {tCases("testResultHistory")}
            </CardTitle>
            <CardDescription>{tCases("noTestResults")}</CardDescription>
          </div>
          {!isLoadingTestRunPermissions &&
            canAddEditRun &&
            showAddToTestRun && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={isLoadingTestRunPermissions}
                  >
                    <PlusSquare className="h-4 w-4" />
                    {tCommon("actions.addToTestRun")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {activeProjectId && (
                    <ScrollArea className="max-h-96">
                      <AddToTestRunDropdown
                        caseId={caseId}
                        projectId={activeProjectId}
                      />
                    </ScrollArea>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
        </CardHeader>
      </Card>
    );
  }

  const nonPendingResults = sortedResults.filter((r) => !r.isPending);
  const allExpanded =
    nonPendingResults.length > 0 &&
    nonPendingResults.every((r) => expandedResults.has(r.displayId));

  return (
    <Card shadow="none">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <div>
          <CardTitle className="flex items-center gap-1">
            <History className="w-5 h-5" />
            {tCases("testResultHistory")}
          </CardTitle>
          <CardDescription>
            {tCases("testResultHistoryDescription")}
          </CardDescription>
        </div>
        {!isLoadingTestRunPermissions && canAddEditRun && showAddToTestRun && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isLoadingTestRunPermissions}
              >
                <PlusSquare className="h-4 w-4" />
                {tCommon("actions.addToTestRun")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {activeProjectId && (
                <ScrollArea className="max-h-96">
                  <AddToTestRunDropdown
                    caseId={caseId}
                    projectId={activeProjectId}
                  />
                </ScrollArea>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="text-nowrap">
              <TableHead className="w-8">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        toggleExpanded("all");
                      }}
                    >
                      {allExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {allExpanded
                      ? tCommon("actions.collapse")
                      : tCommon("actions.expand")}
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="w-[300px]">
                {tCommon("actions.junit.import.testRun.label")}
              </TableHead>
              <TableHead className="w-[120px]">
                {tCommon("actions.status")}
              </TableHead>
              <TableHead className="w-[150px]">
                {tCommon("fields.executedBy")}
              </TableHead>
              <TableHead className="w-[150px]">
                {tCommon("fields.executedAt")}
              </TableHead>
              <TableHead className="w-[80px] text-center">
                {tCommon("fields.editedHeader")}
              </TableHead>
              <TableHead className="w-[100px]">
                {tCommon("fields.iterations")}
              </TableHead>
              <TableHead className="w-[100px]">
                {tCommon("fields.duration")}
              </TableHead>
              <TableHead className="w-[100px]">
                {tCommon("fields.attachments")}
              </TableHead>
              <TableHead className="w-[75px]">
                {tCommon("fields.issues")}
              </TableHead>
              <TableHead className="w-[50px] text-center">
                {tCommon("fields.version")}
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedResults.map((result) => {
              const statusColor = result.status?.color?.value || "transparent";
              const isExpanded = expandedResults.has(result.displayId);

              let displayDuration = result.elapsed || 0;
              if (result.sourceType === "manual" && result.stepResults) {
                displayDuration = result.elapsed || 0;
                result.stepResults.forEach((step) => {
                  displayDuration += step.elapsed || 0;
                });
              } else if (result.sourceType === "junit") {
                displayDuration = result.elapsed || 0; // elapsed is mapped from jr.time
              } else {
                // pending
                displayDuration = 0;
              }

              const isAssociatedTestRunCompleted =
                result.associatedTestRun?.isCompleted ?? false;

              // System admins always edit (matches the server guard); for
              // everyone else resolve the effective window from the system
              // ceiling + the project override.
              const isSystemAdmin = session?.user.access === "ADMIN";
              let isEditingAllowedByTime = true;
              if (
                !isSystemAdmin &&
                result.sourceType === "manual" && // Editing only for manual
                !result.isPending
              ) {
                const effectiveWindowSeconds = resolveEffectiveWindowSeconds(
                  editResultsDurationSeconds ?? null,
                  projectEditWindowSeconds
                );
                if (effectiveWindowSeconds === 0) {
                  isEditingAllowedByTime = false;
                } else if (effectiveWindowSeconds !== null) {
                  const timeDifferenceSeconds =
                    (Date.now() - new Date(result.executedAt).getTime()) / 1000;
                  isEditingAllowedByTime =
                    timeDifferenceSeconds <= effectiveWindowSeconds;
                }
              }

              const canUserEditThisResult =
                result.sourceType === "manual" &&
                (session?.user.access === "ADMIN" ||
                  session?.user.id === result.executedBy.id);

              const showEditButton =
                result.sourceType === "manual" &&
                !result.isPending &&
                !isAssociatedTestRunCompleted && // Check completion of the specific run this result is part of
                isEditingAllowedByTime &&
                !isLoadingResultPermissions &&
                canAddEditResults &&
                canUserEditThisResult;

              return (
                <React.Fragment key={result.displayId}>
                  <TableRow
                    className={`${isExpanded ? "border-b-0" : ""} ${isAssociatedTestRunCompleted ? "bg-muted-foreground/20" : ""}`}
                  >
                    <TableCell className="px-2 w-8">
                      {!result.isPending && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          data-testid={`expand-result-${result.displayId}`}
                          onClick={() => toggleExpanded(result.displayId)}
                          aria-label={tCommon("aria.toggleDetails")}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex items-center group">
                        {result.sourceType === "junit" ? (
                          result.associatedTestRun ? (
                            <div className="font-medium truncate flex items-center">
                              {result.associatedTestRun.isDeleted ? (
                                <>
                                  <Trash2 className="w-4 h-4 inline me-1 shrink-0 text-muted-foreground/50" />
                                  <span className="truncate text-muted-foreground/50 line-through">
                                    {result.associatedTestRun.name}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Bot className="w-4 h-4 inline me-1 shrink-0 text-primary border border-primary rounded-full p-0.5" />
                                  <Link
                                    href={`/projects/runs/${activeProjectId}/${result.associatedTestRun.id}?selectedCase=${fetchedTestCase.id}&view=status`}
                                    className="hover:underline truncate"
                                  >
                                    {result.associatedTestRun.name}
                                  </Link>
                                </>
                              )}
                            </div>
                          ) : (
                            <div className="font-medium truncate flex items-center">
                              <Bot className="w-4 h-4 inline me-1 shrink-0 text-primary border border-primary rounded-full p-0.5" />
                              <span className="truncate">
                                {result.testSuiteName || "JUnit Import"}
                              </span>
                            </div>
                          )
                        ) : result.associatedTestRun ? (
                          <TestRunNameDisplay
                            testRun={result.associatedTestRun}
                            projectId={activeProjectId}
                            className="truncate"
                            linkSuffix={`?selectedCase=${fetchedTestCase.id}&view=status`}
                          />
                        ) : (
                          <div className="font-medium truncate flex items-center">
                            <PlayCircle className="w-4 h-4 inline me-1 shrink-0" />
                            <span className="truncate">
                              {tCases("unknownRun")}
                            </span>
                          </div>
                        )}
                        {result.associatedTestRun &&
                          !result.associatedTestRun.isDeleted &&
                          result.sourceType !== "junit" && (
                            <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[120px]">
                      <Badge
                        variant="outline"
                        style={{
                          backgroundColor: statusColor,
                          color: "white",
                          borderColor: statusColor,
                        }}
                      >
                        {result.status.name}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[150px]">
                      {result.executedBy && result.executedBy.id ? (
                        <div className="truncate">
                          <UserNameCell userId={result.executedBy.id} />
                        </div>
                      ) : (
                        <div className="truncate">
                          {result.executedBy?.name || "-"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[100px]">
                      <RelativeTimeTooltip
                        date={result.executedAt}
                        isPending={result.isPending}
                        dateFnsLocale={dateFnsLocale}
                        dateFormat={session?.user.preferences?.dateFormat}
                        timeFormat={session?.user.preferences?.timeFormat}
                        timezone={session?.user.preferences?.timezone}
                        className="truncate"
                      />
                    </TableCell>
                    <TableCell className="max-w-[80px]">
                      {result.sourceType === "manual" && result.editedAt && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex justify-center">
                              <History className="h-4 w-4 text-muted-foreground" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="flex gap-1">
                              <div>{tCommon("lastEditedBy")}</div>
                              {result.editedBy?.name}
                              <div>{tCommon("on")}</div>
                              <div>
                                <DateFormatter
                                  date={result.editedAt}
                                  formatString={
                                    session?.user.preferences?.dateFormat +
                                    " " +
                                    session?.user.preferences?.timeFormat
                                  }
                                  timezone={session?.user.preferences?.timezone}
                                />
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[100px]">
                      {result.sourceType === "manual" && result.iteration && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex justify-center">
                              <SquareStack
                                className="h-4 w-4 text-muted-foreground"
                                aria-label={tParams("iterationResultRowIcon")}
                              />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {tParams("iterationResultRowIcon")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[100px]">
                      <div className="truncate">
                        {!result.isPending && displayDuration > 0
                          ? formatSeconds(displayDuration, locale)
                          : "-"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[50px]">
                      <div className="flex justify-center">
                        {!result.isPending &&
                          result.attachments &&
                          result.attachments.length > 0 && (
                            <AttachmentsListDisplay
                              attachments={result.attachments}
                              onSelect={handleSelect}
                            />
                          )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[75px]">
                      {!result.isPending &&
                        result.issues &&
                        result.issues.length > 0 && (
                          <div className="flex justify-center">
                            {activeProjectId && (
                              <IssuesListDisplay
                                issues={result.issues.map((issue) => ({
                                  ...issue,
                                  projectIds: [activeProjectId],
                                }))}
                              />
                            )}
                          </div>
                        )}
                    </TableCell>
                    <TableCell className="max-w-[50px] text-center">
                      {result.sourceType === "manual" && !result.isPending && (
                        <Link
                          href={`/projects/repository/${activeProjectId}/${caseId}/${result.testRunCaseVersion}`}
                          className="hover:underline"
                        >
                          {result.testRunCaseVersion}
                        </Link>
                      )}
                      {result.sourceType !== "manual" && "-"}
                    </TableCell>
                    <TableCell className="max-w-[50px]">
                      {showEditButton &&
                        result.sourceType === "manual" &&
                        result.associatedTestRun &&
                        result.associatedTestRunCaseId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              setEditingResult({
                                id: result.originalDbId,
                                testRunId: result.associatedTestRun!.id,
                                testRunCaseId: result.associatedTestRunCaseId!,
                              });
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                  {!result.isPending && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={12} className="py-0 px-2">
                        {" "}
                        {/* ColSpan must match TableHeader column count (12 with iteration icon column) */}
                        <Collapsible open={isExpanded}>
                          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-slide-down data-[state=closed]:animate-slide-up">
                            <div className="pb-2">
                              <Separator className="my-2" />
                              {/* Run details block — Configuration name (+
                                  group context if present). Shown for any
                                  result that has an associated TestRun
                                  configuration. Placement: top of the
                                  expanded panel so it reads like context
                                  metadata before the result content. */}
                              {result.associatedTestRun?.configuration && (
                                <div className="px-4 py-2 mb-2 bg-muted/50 rounded-md border text-xs space-y-1">
                                  <div className="font-semibold text-primary">
                                    {tParams("iterationResultRunDetails")}
                                  </div>
                                  <div>
                                    <span className="font-medium">
                                      {tCommon("fields.configuration") + ":"}
                                    </span>{" "}
                                    {
                                      result.associatedTestRun.configuration
                                        .name
                                    }
                                  </div>
                                </div>
                              )}
                              {/* Parameter values block — per-result
                                  iteration parameter values from
                                  TestRunCaseIteration.valuesJson against
                                  the snapshot's parameter schema. Sensitive
                                  values redact for non-admin viewers
                                  (defense-in-depth client gate; server
                                  audit boundary is the source of truth). */}
                              {result.sourceType === "manual" &&
                                result.iteration && (
                                  <div className="px-4 py-2 mb-2 bg-muted/50 rounded-md border text-xs space-y-1">
                                    <div className="font-semibold text-primary flex items-center gap-1">
                                      <SquareStack
                                        className="h-3 w-3"
                                        aria-hidden
                                      />
                                      {tParams("iterationResultLabelHeading") +
                                        ` ${result.iteration.rowIndex + 1}`}
                                      {result.iteration.label && (
                                        <span className="font-normal text-muted-foreground">
                                          {": "}
                                          {result.iteration.label}
                                        </span>
                                      )}
                                    </div>
                                    {result.iteration.parameterSchema.length >
                                      0 && (
                                      <table className="w-full text-start mt-1">
                                        <thead>
                                          <tr className="border-b">
                                            <th className="font-medium pe-4 py-1">
                                              {tParams(
                                                "iterationIssueTableHeaderParameter"
                                              )}
                                            </th>
                                            <th className="font-medium py-1">
                                              {tParams(
                                                "iterationIssueTableHeaderValue"
                                              )}
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {result.iteration.parameterSchema.map(
                                            (p) => {
                                              const raw = ((result.iteration!
                                                .valuesJson as Record<
                                                string,
                                                unknown
                                              > | null) ?? {})[p.name];
                                              const canSee =
                                                !p.sensitive ||
                                                session?.user?.access ===
                                                  "ADMIN";
                                              let display: string;
                                              if (!canSee) {
                                                display = "••••••";
                                              } else if (
                                                raw === null ||
                                                raw === undefined ||
                                                raw === ""
                                              ) {
                                                display = tParams(
                                                  "iterationResultNoValue"
                                                );
                                              } else if (
                                                typeof raw === "string"
                                              ) {
                                                display = raw;
                                              } else {
                                                try {
                                                  display = JSON.stringify(raw);
                                                } catch {
                                                  display = String(raw);
                                                }
                                              }
                                              return (
                                                <tr key={p.name}>
                                                  <td className="pe-4 py-1 font-mono">
                                                    {"@"}
                                                    {p.name}
                                                  </td>
                                                  <td className="py-1 break-all">
                                                    {display}
                                                  </td>
                                                </tr>
                                              );
                                            }
                                          )}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}
                              {result.sourceType === "manual" &&
                                result.notes &&
                                !isTiptapEmpty(result.notes) && (
                                  <div>
                                    <div className="px-4 text-xs text-muted-foreground">
                                      {tCommon("actions.resultDetails")}
                                    </div>
                                    <div className="px-4">
                                      <TipTapEditor
                                        content={result.notes as object}
                                        readOnly={true}
                                        projectId={
                                          projectId
                                            ? String(projectId)
                                            : undefined
                                        }
                                        className="h-auto"
                                      />
                                    </div>
                                  </div>
                                )}
                              {result.sourceType === "junit" &&
                                result.content && (
                                  <div className="px-4 py-2">
                                    <div className="text-xs text-muted-foreground">
                                      {tCommon("fields.notes")}
                                    </div>
                                    <pre className="whitespace-pre-wrap wrap-break-word bg-background border rounded p-2 mt-1 text-sm">
                                      {result.content}
                                    </pre>
                                  </div>
                                )}
                              {result.sourceType === "junit" && (
                                <div className="px-4 py-2 mt-2 bg-muted/50 rounded-md border text-xs space-y-1">
                                  <div className="font-semibold text-primary">
                                    {tCommon("actions.automated.details")}
                                  </div>
                                  {result.testSuiteName && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("actions.automated.testSuite")}
                                      </span>{" "}
                                      {result.testSuiteName}
                                    </div>
                                  )}
                                  {result.type && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("fields.type") + ":"}
                                      </span>{" "}
                                      {result.type}
                                    </div>
                                  )}
                                  {result.message && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("actions.automated.message") +
                                          ":"}
                                      </span>{" "}
                                      {result.message}
                                    </div>
                                  )}
                                  {result.file && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("file") + ":"}
                                      </span>{" "}
                                      {result.file}
                                    </div>
                                  )}
                                  {typeof result.line === "number" && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("actions.automated.line") +
                                          ":"}
                                      </span>{" "}
                                      {result.line}
                                    </div>
                                  )}
                                  {typeof result.assertions === "number" && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("fields.assertions") + ":"}
                                      </span>{" "}
                                      {result.assertions}
                                    </div>
                                  )}
                                  {result.systemOut && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("fields.systemOutput") + ":"}
                                      </span>
                                      <pre className="whitespace-pre-wrap wrap-break-word bg-background border rounded p-2 mt-1 max-h-40 overflow-auto">
                                        {result.systemOut}
                                      </pre>
                                    </div>
                                  )}
                                  {result.systemErr && (
                                    <div>
                                      <span className="font-medium">
                                        {tCommon("fields.systemError") + ":"}
                                      </span>
                                      <pre className="whitespace-pre-wrap wrap-break-word bg-background border rounded p-2 mt-1 max-h-40 overflow-auto">
                                        {result.systemErr}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                              {result.sourceType === "manual" &&
                                result.originalDbId && (
                                  <ResultFieldValuesDisplay
                                    resultId={result.originalDbId}
                                    result={result}
                                    session={session}
                                  />
                                )}
                              {result.sourceType === "manual" &&
                                result.stepResults &&
                                result.stepResults.length > 0 && (
                                  <div>
                                    <StepResultsDisplay
                                      stepResults={result.stepResults}
                                      projectId={activeProjectId}
                                      resultId={result.originalDbId}
                                    />
                                  </div>
                                )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
        {selectedAttachmentIndex !== null && (
          <AttachmentsCarousel
            attachments={selectedAttachments}
            initialIndex={selectedAttachmentIndex}
            onClose={handleClose}
            canEdit={false}
          />
        )}
      </CardContent>
      {editingResult &&
        typeof activeProjectId === "number" &&
        fetchedTestCase && (
          <EditResultModal
            isOpen={!!editingResult}
            onClose={() => setEditingResult(null)}
            testRunId={editingResult.testRunId}
            testRunCaseId={editingResult.testRunCaseId}
            resultId={editingResult.id} // This is originalDbId for manual result
            caseName={fetchedTestCase.name}
            projectId={activeProjectId}
            steps={fetchedTestCase.steps}
          />
        )}
    </Card>
  );
}
