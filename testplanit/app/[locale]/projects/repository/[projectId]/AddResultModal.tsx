import React, { useState, useRef, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4";
import { toHumanReadable } from "~/utils/duration";
import parseDuration from "parse-duration";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { TimeTracker, TimeTrackerRef } from "@/components/TimeTracker";
import UploadAttachments from "@/components/UploadAttachments";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import {
  Attachments,
  Steps,
  SharedStepGroup as PrismaSharedStepGroup,
  SharedStepItem as PrismaSharedStepItem,
  Status as PrismaStatus,
  Color as PrismaColor,
} from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useFindManyStatus,
  useCreateTestRunResults,
  useCreateAttachments,
  useUpdateTestRunCases,
  useFindManyTestRunResults,
  useFindFirstRepositoryCases,
  useFindManyTemplateResultAssignment,
  useCreateResultFieldValues,
  useCreateTestRunStepResults,
  useFindFirstWorkflows,
  useUpdateTestRuns,
  useFindFirstProjects,
  useFindManySharedStepItem,
  useCreateIssue,
  useDeleteIssue,
  useFindManyIssue,
} from "~/lib/hooks";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { ListChecks, SearchCheck, Bug, LockIcon, Layers, Combine } from "lucide-react";
import { emptyEditorContent } from "~/app/constants";
import { ExtendedCases } from "./columns";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { HelpPopover } from "@/components/ui/help-popover";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { MAX_DURATION } from "~/app/constants";

// Helper function to map field types to Zod schemas
const mapFieldToZodType = (field: any) => {
  const fieldType = field.resultField.type?.type;
  const isRequired = field.resultField.isRequired;

  let schema;

  switch (fieldType) {
    case "Text":
    case "Dropdown":
    case "Radio":
    case "Checkbox":
      schema = z.string();
      break;
    case "Number":
      schema = z.number();
      if (field.resultField.minValue !== null) {
        schema = schema.min(field.resultField.minValue);
      }
      if (field.resultField.maxValue !== null) {
        schema = schema.max(field.resultField.maxValue);
      }
      break;
    case "Text Long":
    case "RichText":
      // Allow any for rich text and text long because they're handled by TipTap
      schema = z.any();
      break;
    default:
      schema = z.string();
  }

  // Make it nullable if not required
  if (!isRequired) {
    return schema.nullable().optional();
  }

  return schema;
};

// Define the form schema
const formSchema = (
  locale: string,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  templateFields: any[] = [],
  steps: Steps[] = []
) => {
  // Base schema with fixed fields
  const baseSchema = {
    statusId: z.string().min(1, {
      message: tCommon("validation.required", {
        field: tCommon("fields.status"),
      }),
    }),
    resultData: z.any(),
    evidence: z.any().optional(),
    elapsed: z
      .string()
      .nullable()
      .default("")
      .refine(
        (value) => {
          if (!value) return true;
          const durationInMilliseconds = parseDuration(value);
          return durationInMilliseconds !== null;
        },
        {
          message: tCommon("validation.invalidDuration"),
        }
      )
      .refine(
        (value) => {
          if (!value) return true;
          const durationInMilliseconds = parseDuration(value);
          if (!durationInMilliseconds) return false;
          const durationInSeconds = Math.round(durationInMilliseconds / 1000);
          return durationInSeconds <= MAX_DURATION;
        },
        {
          message: tCommon("validation.maxDuration", {
            max: toHumanReadable(MAX_DURATION, {
              isSeconds: true,
              locale,
            }),
          }),
        }
      ),
    attempt: z.number().default(1),
  };

  // Dynamic schema for template fields
  const dynamicSchema = templateFields.reduce(
    (schema, field) => {
      const fieldId = field.resultField.id.toString();
      schema[fieldId] = mapFieldToZodType(field);
      return schema;
    },
    {} as Record<string, z.ZodTypeAny>
  );

  // Schema for step results
  const stepResultsSchema = steps.reduce(
    (schema, step) => {
      // Only create schema entries for regular steps, not shared step group placeholders
      if (!step.sharedStepGroupId) {
        const stepId = step.id.toString();
        schema[`step_${stepId}_statusId`] = z.string().optional();
        schema[`step_${stepId}_notes`] = z.any().optional();
        schema[`step_${stepId}_evidence`] = z.any().optional();
        schema[`step_${stepId}_elapsed`] = z.string().nullable().default("");
        // Assuming issues for regular steps are handled if needed, not explicitly in schema here
      }
      return schema;
    },
    {} as Record<string, z.ZodTypeAny>
  );

  return z.object({
    ...baseSchema,
    ...dynamicSchema,
    ...stepResultsSchema,
  });
};

// Type for the form values
type FormValues = z.infer<ReturnType<typeof formSchema>>;

// Define EnrichedStep type
interface EnrichedStep extends Steps {
  sharedStepGroup?: (PrismaSharedStepGroup & { name: string | null }) | null;
}

interface AddResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  testRunId: number;
  testRunCaseId?: number;
  caseName: string;
  projectId: number;
  currentAttempt?: number;
  defaultStatusId?: string;
  isBulkResult?: boolean;
  selectedCases?: ExtendedCases[];
  steps?: EnrichedStep[]; // Updated to EnrichedStep
  configuration?: { id: number; name: string } | null;
}

export function AddResultModal({
  isOpen,
  onClose,
  testRunId,
  testRunCaseId,
  caseName,
  projectId,
  currentAttempt = 1,
  defaultStatusId,
  isBulkResult = false,
  selectedCases = [],
  steps = [], // Default to empty array
  configuration,
}: AddResultModalProps) {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStatusColor, setSelectedStatusColor] =
    useState<string>("#3b82f6");
  const [editorKey, setEditorKey] = useState<number>(0);
  const [uploadAttachmentsKey, setUploadAttachmentsKey] = useState<number>(0);
  const [trackedSeconds, setTrackedSeconds] = useState(0);
  const timeTrackerRef = useRef<TimeTrackerRef>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [templateFields, setTemplateFields] = useState<any[]>([]);
  const [selectedMainIssues, setSelectedMainIssues] = useState<number[]>([]);
  const [selectedStepIssues, setSelectedStepIssues] = useState<
    Record<number, number[]>
  >({});
  const [selectedSharedItemIssues, setSelectedSharedItemIssues] = useState<
    Record<number, number[]>
  >({}); // For shared step items

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Reset issue selections when modal opens
      setSelectedMainIssues([]);
      setSelectedStepIssues({});
      setSelectedSharedItemIssues({});
    }
  }, [isOpen]);

  // Collect all issue IDs from all sources
  const allIssueIds = [
    ...Object.values(selectedStepIssues).flat(),
    ...Object.values(selectedSharedItemIssues).flat(),
    ...selectedMainIssues,
  ];

  // Fetch issue details for all selected issues
  const { data: issueDetails } = useFindManyIssue(
    {
      where: {
        id: { in: allIssueIds },
      },
      select: {
        id: true,
        name: true,
        title: true,
        externalKey: true,
        externalUrl: true,
      },
    },
    {
      enabled: allIssueIds.length > 0,
    }
  );

  // Create a map for quick lookup
  const issueMap = React.useMemo(() => {
    const map = new Map<number, { key: string; title: string; url?: string }>();
    if (issueDetails) {
      issueDetails.forEach((issue) => {
        map.set(issue.id, {
          key: issue.externalKey || issue.name,
          title: issue.title,
          url: issue.externalUrl || undefined,
        });
      });
    }
    return map;
  }, [issueDetails]);

  // Query previous test run results to determine the correct attempt number
  const { data: previousResults } = useFindManyTestRunResults({
    where: {
      testRunCaseId,
    },
    orderBy: {
      attempt: "desc",
    },
    take: 1,
  });

  // Find the repository case to get its template ID
  const { data: repositoryCase, isLoading: isLoadingCase } =
    useFindFirstRepositoryCases({
      where: {
        testRuns: {
          some: {
            id: testRunCaseId,
          },
        },
      },
      select: {
        id: true,
        name: true,
        templateId: true,
        currentVersion: true,
      },
    });

  // Fetch template result fields if we have a case with a template
  const { data: templateResultFields, isLoading: isLoadingTemplateFields } =
    useFindManyTemplateResultAssignment({
      where: {
        templateId: repositoryCase?.templateId || 0,
      },
      include: {
        resultField: {
          include: {
            type: {
              select: {
                type: true,
              },
            },
            fieldOptions: {
              select: {
                fieldOption: {
                  select: {
                    id: true,
                    name: true,
                    order: true,
                  },
                },
              },
              orderBy: { fieldOption: { order: "asc" } },
            },
          },
        },
      },
      orderBy: {
        order: "asc",
      },
    });

  // Fetch project data to get integrations
  const { data: projectData, isLoading: isLoadingProject } =
    useFindFirstProjects({
      where: { id: projectId },
      select: {
        projectIntegrations: {
          where: {
            isActive: true,
            integration: {
              status: "ACTIVE",
            },
          },
          include: {
            integration: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
          },
        },
      },
    });

  // Calculate the next attempt number based on previous results
  const nextAttempt =
    previousResults && previousResults.length > 0
      ? Math.max(previousResults[0].attempt, currentAttempt) + 1
      : currentAttempt;

  // Update templateFields state when template result fields are loaded
  useEffect(() => {
    if (templateResultFields) {
      setTemplateFields(templateResultFields);
    }
  }, [templateResultFields]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema(locale, tCommon, templateFields, steps)),
    defaultValues: {
      statusId: defaultStatusId || "",
      resultData: emptyEditorContent,
      evidence: {},
      elapsed: "",
      attempt: nextAttempt,
    },
  });

  // Update form schema when template fields change
  useEffect(() => {
    if (templateFields && templateFields.length > 0) {
      // Create default values for the dynamic fields
      const dynamicDefaults = templateFields.reduce((acc, field) => {
        const fieldId = field.resultField.id.toString();
        const defaultValue = field.resultField.defaultValue;
        acc[fieldId] = defaultValue || null;
        return acc;
      }, {});

      // Get current values to preserve them
      const currentValues = form.getValues();

      // Recreate form with new resolver and merged values
      form.reset({
        ...currentValues,
        ...dynamicDefaults,
      });
    }
  }, [templateFields, locale, tCommon, form]);

  // Fetch available statuses
  const { data: statuses } = useFindManyStatus({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: {
        some: {
          scope: {
            name: "Test Run",
          },
        },
      },
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    include: {
      color: {
        select: {
          value: true,
        },
      },
    },
    orderBy: {
      order: "asc",
    },
  });

  const { mutateAsync: createTestRunResult } = useCreateTestRunResults();
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: updateTestRunCase } = useUpdateTestRunCases();
  const { mutateAsync: updateTestRun } = useUpdateTestRuns();
  const { mutateAsync: createResultFieldValue } = useCreateResultFieldValues();
  const { mutateAsync: createTestRunStepResult } =
    useCreateTestRunStepResults();
  const { mutateAsync: createIssue } = useCreateIssue();
  const { mutateAsync: deleteIssue } = useDeleteIssue();

  // Check if this is the first result for this test run
  const { data: existingResults } = useFindManyTestRunResults({
    where: {
      testRunId,
    },
    take: 1,
  });

  // Find the first IN_PROGRESS workflow state for this project
  const { data: inProgressWorkflow } = useFindFirstWorkflows({
    where: {
      projects: {
        some: {
          projectId: projectId,
        },
      },
      workflowType: "IN_PROGRESS",
      isEnabled: true,
      isDeleted: false,
    },
    orderBy: {
      order: "asc",
    },
  });

  // Fetch permissions
  const {
    permissions: restrictedFieldsPermissions,
    isLoading: isLoadingRestrictedPermissions,
  } = useProjectPermissions(
    projectId,
    ApplicationArea.TestRunResultRestrictedFields
  );
  const canEditRestricted = restrictedFieldsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const canEditRestrictedPerm = canEditRestricted || isSuperAdmin;

  const handleStatusChange = (statusId: string) => {
    form.setValue("statusId", statusId, {
      shouldValidate: true,
      shouldDirty: true,
    });

    const selectedStatus = statuses?.find(
      (status) => status.id.toString() === statusId
    );
    if (selectedStatus?.color?.value) {
      setSelectedStatusColor(selectedStatus.color.value);
    }
  };

  const handleTimeUpdate = (seconds: number) => {
    setTrackedSeconds(seconds);
    if (seconds > 0) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      let timeString = "";

      if (minutes > 0) {
        timeString += `${minutes} ${tCommon("time.minutes", { count: minutes })} `;
      }
      if (remainingSeconds > 0 || minutes === 0) {
        timeString += `${remainingSeconds} ${tCommon("time.seconds", { count: remainingSeconds })}`;
      }

      form.setValue("elapsed", timeString, {
        shouldValidate: true,
        shouldDirty: true,
      });
    } else {
      form.setValue("elapsed", "", {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  };

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const handleAttachmentSelect = (
    attachments: Attachments[],
    index: number
  ) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleAttachmentClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const uploadFiles = async (testRunResultId: number) => {
    if (!session?.user?.id) return [];

    const prependString = session.user.id;
    const sanitizedFolder = projectId?.toString() || "";

    const attachmentsPromises = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );

      const attachment = await createAttachments({
        data: {
          testRunResults: {
            connect: { id: testRunResultId },
          },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: {
            connect: { id: session.user.id },
          },
        },
      });

      return {
        id: attachment?.id,
        url: fileUrl,
        name: file.name,
        note: "",
        mimeType: file.type,
        size: file.size,
        createdBy: session.user.name,
      };
    });

    const attachments = await Promise.all(attachmentsPromises);
    return attachments;
  };

  // Add this function to check if a status is a failure status
  const isFailureStatus = (statusId: string) => {
    return (
      statuses?.find((status) => status.id.toString() === statusId)
        ?.isFailure === true
    );
  };

  const handleSubmit = async () => {
    if (!session?.user?.id) return;

    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }

    const values = form.getValues();
    setIsSubmitting(true);

    try {
      let elapsedInSeconds: number | null = null;
      if (values.elapsed) {
        const durationInMilliseconds = parseDuration(values.elapsed as string);
        if (durationInMilliseconds !== null) {
          elapsedInSeconds = Math.round(durationInMilliseconds / 1000);
        }
      }

      let hasSubmittedElapsedTime = false;
      if (elapsedInSeconds !== null && elapsedInSeconds > 0) {
        hasSubmittedElapsedTime = true;
      }

      // Check elapsed time for regular steps
      if (!hasSubmittedElapsedTime && steps.length > 0) {
        for (const step of steps) {
          if (!step.sharedStepGroupId) {
            // Only regular steps
            const stepElapsedValue =
              values[`step_${step.id.toString()}_elapsed`];
            if (stepElapsedValue) {
              const stepDurationMs = parseDuration(stepElapsedValue as string);
              if (stepDurationMs !== null && stepDurationMs > 0) {
                hasSubmittedElapsedTime = true;
                break;
              }
            }
          }
        }
      }

      // Check elapsed time for shared step items (will need access to form values for shared items)
      // This part is tricky as shared item fields are not in the main `steps` iteration here.
      // We'll refine this after SharedStepGroupInputs is defined.
      // For now, we assume `values` might contain `shared_item_[id]_elapsed`.
      if (!hasSubmittedElapsedTime) {
        for (const key in values) {
          if (Object.prototype.hasOwnProperty.call(values, key)) {
            const stringKey = key as string; // Ensure key is treated as a string
            if (
              stringKey.startsWith("shared_item_") &&
              stringKey.endsWith("_elapsed")
            ) {
              // Use a more direct cast if TypeScript still complains about symbol index
              const itemElapsedValue = (values as any)[stringKey] as
                | string
                | null;
              if (itemElapsedValue) {
                const itemDurationMs = parseDuration(itemElapsedValue);
                if (itemDurationMs !== null && itemDurationMs > 0) {
                  hasSubmittedElapsedTime = true;
                  break;
                }
              }
            }
          }
        }
      }

      // Issues are already created by DeferredIssueManager, just use the IDs directly
      const issueIdsToConnect: number[] = selectedMainIssues;
      // console.log("Selected main issue IDs to connect:", selectedMainIssues);

      // console.log("Issue IDs to connect:", issueIdsToConnect);

      if (isBulkResult && selectedCases.length > 0) {
        // Handle bulk result submission
        const bulkPromises = selectedCases.map(async (selectedCase) => {
          if (!selectedCase.testRunCaseId) return;
          const caseVersion = 1;

          // Create the test run result
          const result = await createTestRunResult({
            data: {
              testRunId,
              testRunCaseId: selectedCase.testRunCaseId,
              statusId: parseInt(values.statusId as string),
              notes: values.resultData || emptyEditorContent,
              evidence: values.evidence as any,
              elapsed: elapsedInSeconds,
              executedById: session.user.id,
              attempt: values.attempt as number,
              testRunCaseVersion: caseVersion,
              issues: {
                connect: issueIdsToConnect.map((id) => ({ id })),
              },
            },
          });

          // If this is the first result and we have an IN_PROGRESS workflow state
          if (existingResults?.length === 0 && inProgressWorkflow) {
            // Update the test run's workflow state
            await updateTestRun({
              where: {
                id: testRunId,
              },
              data: {
                stateId: inProgressWorkflow.id,
              },
            });
          }

          // Update the test run case status
          await updateTestRunCase({
            where: {
              id: selectedCase.testRunCaseId,
            },
            data: {
              statusId: parseInt(values.statusId as string),
            },
          });

          // Save template field values if any exist
          if (result && templateFields.length > 0) {
            const fieldValuesPromises = templateFields.map((field) => {
              const fieldId = field.resultField.id.toString();
              const fieldData = values[fieldId];

              if (fieldData !== undefined && fieldData !== null) {
                return createResultFieldValue({
                  data: {
                    fieldId: parseInt(fieldId),
                    value:
                      typeof fieldData === "object"
                        ? JSON.stringify(fieldData)
                        : String(fieldData as string | number | boolean),
                    testRunResultsId: result.id,
                  },
                });
              }
              return Promise.resolve();
            });

            await Promise.all(fieldValuesPromises);
          }

          // Save step results if any exist
          if (result && steps.length > 0) {
            const stepResultsPromises = steps.map(async (step) => {
              if (step.sharedStepGroupId) {
                // Handle shared step group - 'step' here is the placeholder Step from props
                const placeholderStepId = step.id; // ID of the placeholder Step

                const sharedItems = queryClient.getQueryData<
                  PrismaSharedStepItem[]
                >(["sharedStepItems", step.sharedStepGroupId]);

                if (sharedItems && sharedItems.length > 0) {
                  const sharedItemPromises = sharedItems.map(
                    async (item: PrismaSharedStepItem) => {
                      // 'item' is a SharedStepItem
                      const itemIdStr = item.id.toString();
                      const statusKey = `shared_item_${itemIdStr}_statusId`;
                      const notesKey = `shared_item_${itemIdStr}_notes`;
                      const evidenceKey = `shared_item_${itemIdStr}_evidence`;
                      const elapsedKey = `shared_item_${itemIdStr}_elapsed`;

                      const itemStatusIdFromForm = (values as any)[
                        statusKey
                      ] as string | undefined;
                      const itemNotes = (values as any)[notesKey];
                      const itemEvidenceValue = (values as any)[evidenceKey];
                      const itemEvidence =
                        typeof itemEvidenceValue === "object" &&
                        itemEvidenceValue !== null
                          ? itemEvidenceValue
                          : {};
                      const itemElapsed = (values as any)[elapsedKey] as
                        | string
                        | null;
                      const itemIssues =
                        selectedSharedItemIssues[item.id] || [];

                      let itemElapsedInSeconds: number | null = null;
                      if (itemElapsed) {
                        const durationInMilliseconds =
                          parseDuration(itemElapsed);
                        if (durationInMilliseconds !== null) {
                          itemElapsedInSeconds = Math.round(
                            durationInMilliseconds / 1000
                          );
                        }
                      }

                      let itemStatusIdToUse: number | undefined = undefined;

                      if (
                        itemStatusIdFromForm &&
                        !isNaN(parseInt(itemStatusIdFromForm))
                      ) {
                        itemStatusIdToUse = parseInt(itemStatusIdFromForm);
                      } else if (
                        itemNotes ||
                        (itemElapsedInSeconds && itemElapsedInSeconds > 0)
                      ) {
                        if (
                          values.statusId &&
                          !isNaN(parseInt(values.statusId as string))
                        ) {
                          itemStatusIdToUse = parseInt(
                            values.statusId as string
                          );
                        } else {
                          console.warn(
                            `Shared item ${item.id} has details but no valid status, and main status is also invalid. Skipping.`
                          );
                          return null;
                        }
                      }

                      if (
                        itemStatusIdToUse !== undefined &&
                        isFailureStatus(itemStatusIdToUse.toString())
                      ) {
                        await updateTestRunCase({
                          where: { id: selectedCase.testRunCaseId },
                          data: { statusId: itemStatusIdToUse },
                        });
                      }

                      if (itemStatusIdToUse !== undefined) {
                        const stepResultData = {
                          testRunResultId: result.id,
                          stepId: placeholderStepId, // Use placeholderStepId
                          sharedStepItemId: item.id, // Pass the actual SharedStepItem ID
                          statusId: itemStatusIdToUse,
                          notes: itemNotes || emptyEditorContent,
                          evidence: itemEvidence,
                          elapsed: itemElapsedInSeconds,
                          executedAt: new Date(),
                          issues: {
                            connect: itemIssues.map((id) => ({ id })),
                          },
                        };

                        return createTestRunStepResult({
                          data: stepResultData,
                        });
                      }
                      return null;
                    }
                  );
                  return Promise.all(sharedItemPromises.filter(Boolean));
                }
                return [];
              } else {
                // Handle regular step
                const stepId = step.id.toString();
                const stepStatusIdFromForm = values[
                  `step_${stepId}_statusId`
                ] as string | undefined;
                const stepNotes = values[`step_${stepId}_notes`];
                const stepEvidenceValue = values[`step_${stepId}_evidence`];
                const stepEvidence =
                  typeof stepEvidenceValue === "object" &&
                  stepEvidenceValue !== null
                    ? stepEvidenceValue
                    : {}; // Default evidence
                const stepElapsed = values[`step_${stepId}_elapsed`] as
                  | string
                  | null
                  | undefined;
                const stepIssues = selectedStepIssues[step.id] || [];

                let stepElapsedInSeconds: number | null = null;
                if (stepElapsed) {
                  const durationInMilliseconds = parseDuration(
                    stepElapsed as string
                  );
                  if (durationInMilliseconds !== null) {
                    stepElapsedInSeconds = Math.round(
                      durationInMilliseconds / 1000
                    );
                  }
                }

                let stepStatusIdToUse: number | undefined = undefined;
                if (
                  stepStatusIdFromForm &&
                  !isNaN(parseInt(stepStatusIdFromForm))
                ) {
                  stepStatusIdToUse = parseInt(stepStatusIdFromForm);
                } else if (
                  stepNotes ||
                  (stepElapsedInSeconds && stepElapsedInSeconds > 0) ||
                  Object.keys(stepEvidence).length > 0 ||
                  stepIssues.length > 0
                ) {
                  if (
                    values.statusId &&
                    !isNaN(parseInt(values.statusId as string))
                  ) {
                    stepStatusIdToUse = parseInt(values.statusId as string);
                  } else {
                    console.warn(
                      `Regular step ${step.id} has details but no valid status, and main status is also invalid. Skipping.`
                    );
                    return null;
                  }
                }

                if (stepStatusIdToUse !== undefined) {
                  if (
                    testRunCaseId &&
                    isFailureStatus(stepStatusIdToUse.toString()) // Updated to use stepStatusIdToUse
                  ) {
                    await updateTestRunCase({
                      where: {
                        id: testRunCaseId,
                      },
                      data: {
                        statusId: stepStatusIdToUse,
                      },
                    });
                  }

                  const stepResultData = {
                    testRunResultId: result.id,
                    stepId: step.id,
                    statusId: stepStatusIdToUse,
                    notes: stepNotes || emptyEditorContent,
                    evidence: stepEvidence,
                    elapsed: stepElapsedInSeconds,
                    executedAt: new Date(),
                    issues: {
                      connect: stepIssues.map((id) => ({ id })),
                    },
                  };

                  return createTestRunStepResult({ data: stepResultData });
                }
                return null;
              }
            });
            await Promise.all(
              (await Promise.all(stepResultsPromises)).flat().filter(Boolean)
            );
          }

          // Upload attachments if there are any
          if (selectedFiles.length > 0 && result) {
            await uploadFiles(result.id);
          }

          // --- Trigger forecast update for this case ---
          if (selectedCase.id && hasSubmittedElapsedTime)
            fetch(`/api/forecast/update?caseId=${selectedCase.id}`);
        });

        await Promise.all(bulkPromises);
      } else if (testRunCaseId && repositoryCase?.currentVersion) {
        // Handle single result submission
        const result = await createTestRunResult({
          data: {
            testRunId,
            testRunCaseId,
            statusId: parseInt(values.statusId as string),
            notes: values.resultData || emptyEditorContent,
            evidence: values.evidence as any,
            elapsed: elapsedInSeconds,
            executedById: session.user.id,
            attempt: values.attempt as number,
            testRunCaseVersion: repositoryCase.currentVersion,
            issues: {
              connect: issueIdsToConnect.map((id) => ({ id })),
            },
          },
        });

        // If this is the first result and we have an IN_PROGRESS workflow state
        if (existingResults?.length === 0 && inProgressWorkflow) {
          // Update the test run's workflow state
          await updateTestRun({
            where: {
              id: testRunId,
            },
            data: {
              stateId: inProgressWorkflow.id,
            },
          });
        }

        // Update the test run case status
        await updateTestRunCase({
          where: {
            id: testRunCaseId,
          },
          data: {
            statusId: parseInt(values.statusId as string),
          },
        });

        // Save template field values if any exist
        if (result && templateFields.length > 0) {
          const fieldValuesPromises = templateFields.map((field) => {
            const fieldId = field.resultField.id.toString();
            const fieldData = values[fieldId];

            if (fieldData !== undefined && fieldData !== null) {
              return createResultFieldValue({
                data: {
                  fieldId: parseInt(fieldId),
                  value:
                    typeof fieldData === "object"
                      ? JSON.stringify(fieldData)
                      : String(fieldData as string | number | boolean),
                  testRunResultsId: result.id,
                },
              });
            }
            return Promise.resolve();
          });

          await Promise.all(fieldValuesPromises);
        }

        // Save step results if any exist
        if (result && steps.length > 0) {
          const stepResultsPromises = steps.map(async (step) => {
            if (step.sharedStepGroupId) {
              // Handle shared step group - 'step' here is the placeholder Step from props
              const placeholderStepId = step.id; // ID of the placeholder Step

              const sharedItems = queryClient.getQueryData<
                PrismaSharedStepItem[]
              >(["sharedStepItems", step.sharedStepGroupId]);

              if (sharedItems && sharedItems.length > 0) {
                const sharedItemPromises = sharedItems.map(
                  async (item: PrismaSharedStepItem) => {
                    // 'item' is a SharedStepItem
                    const itemIdStr = item.id.toString();
                    const statusKey = `shared_item_${itemIdStr}_statusId`;
                    const notesKey = `shared_item_${itemIdStr}_notes`;
                    const evidenceKey = `shared_item_${itemIdStr}_evidence`;
                    const elapsedKey = `shared_item_${itemIdStr}_elapsed`;

                    const itemStatusIdFromForm = (values as any)[statusKey] as
                      | string
                      | undefined;
                    const itemNotes = (values as any)[notesKey];
                    const itemEvidenceValue = (values as any)[evidenceKey];
                    const itemEvidence =
                      typeof itemEvidenceValue === "object" &&
                      itemEvidenceValue !== null
                        ? itemEvidenceValue
                        : {};
                    const itemElapsed = (values as any)[elapsedKey] as
                      | string
                      | null;
                    const itemIssues = selectedSharedItemIssues[item.id] || [];

                    let itemElapsedInSeconds: number | null = null;
                    if (itemElapsed) {
                      const durationInMilliseconds = parseDuration(itemElapsed);
                      if (durationInMilliseconds !== null) {
                        itemElapsedInSeconds = Math.round(
                          durationInMilliseconds / 1000
                        );
                      }
                    }

                    let itemStatusIdToUse: number | undefined = undefined;

                    if (
                      itemStatusIdFromForm &&
                      !isNaN(parseInt(itemStatusIdFromForm))
                    ) {
                      itemStatusIdToUse = parseInt(itemStatusIdFromForm);
                    } else if (
                      itemNotes ||
                      (itemElapsedInSeconds && itemElapsedInSeconds > 0)
                    ) {
                      if (
                        values.statusId &&
                        !isNaN(parseInt(values.statusId as string))
                      ) {
                        itemStatusIdToUse = parseInt(values.statusId as string);
                      } else {
                        console.warn(
                          `Shared item ${item.id} has details but no valid status, and main status is also invalid. Skipping.`
                        );
                        return null;
                      }
                    }

                    if (
                      testRunCaseId &&
                      itemStatusIdToUse !== undefined &&
                      isFailureStatus(itemStatusIdToUse.toString())
                    ) {
                      await updateTestRunCase({
                        where: { id: testRunCaseId },
                        data: { statusId: itemStatusIdToUse },
                      });
                    }

                    if (itemStatusIdToUse !== undefined) {
                      const stepResultData = {
                        testRunResultId: result.id,
                        stepId: placeholderStepId, // Use placeholderStepId
                        sharedStepItemId: item.id, // Pass the actual SharedStepItem ID
                        statusId: itemStatusIdToUse,
                        notes: itemNotes || emptyEditorContent,
                        evidence: itemEvidence,
                        elapsed: itemElapsedInSeconds,
                        executedAt: new Date(),
                        issues: {
                          connect: itemIssues.map((id) => ({ id })),
                        },
                      };

                      return createTestRunStepResult({ data: stepResultData });
                    }
                    return null;
                  }
                );
                return Promise.all(sharedItemPromises.filter(Boolean));
              }
              return [];
            } else {
              // Handle regular step
              const stepId = step.id.toString();
              const stepStatusIdFromForm = values[`step_${stepId}_statusId`] as
                | string
                | undefined;
              const stepNotes = values[`step_${stepId}_notes`];
              const stepEvidenceValue = values[`step_${stepId}_evidence`];
              const stepEvidence =
                typeof stepEvidenceValue === "object" &&
                stepEvidenceValue !== null
                  ? stepEvidenceValue
                  : {}; // Default evidence
              const stepElapsed = values[`step_${stepId}_elapsed`] as
                | string
                | null
                | undefined;
              const stepIssues = selectedStepIssues[step.id] || [];

              let stepElapsedInSeconds: number | null = null;
              if (stepElapsed) {
                const durationInMilliseconds = parseDuration(
                  stepElapsed as string
                );
                if (durationInMilliseconds !== null) {
                  stepElapsedInSeconds = Math.round(
                    durationInMilliseconds / 1000
                  );
                }
              }

              let stepStatusIdToUse: number | undefined = undefined;
              if (
                stepStatusIdFromForm &&
                !isNaN(parseInt(stepStatusIdFromForm))
              ) {
                stepStatusIdToUse = parseInt(stepStatusIdFromForm);
              } else if (
                stepNotes ||
                (stepElapsedInSeconds && stepElapsedInSeconds > 0) ||
                Object.keys(stepEvidence).length > 0 ||
                stepIssues.length > 0
              ) {
                if (
                  values.statusId &&
                  !isNaN(parseInt(values.statusId as string))
                ) {
                  stepStatusIdToUse = parseInt(values.statusId as string);
                } else {
                  console.warn(
                    `Regular step ${step.id} has details but no valid status, and main status is also invalid. Skipping.`
                  );
                  return null;
                }
              }

              if (stepStatusIdToUse !== undefined) {
                if (
                  testRunCaseId &&
                  isFailureStatus(stepStatusIdToUse.toString()) // Updated to use stepStatusIdToUse
                ) {
                  await updateTestRunCase({
                    where: {
                      id: testRunCaseId,
                    },
                    data: {
                      statusId: stepStatusIdToUse,
                    },
                  });
                }

                const stepResultData = {
                  testRunResultId: result.id,
                  stepId: step.id,
                  statusId: stepStatusIdToUse,
                  notes: stepNotes || emptyEditorContent,
                  evidence: stepEvidence,
                  elapsed: stepElapsedInSeconds,
                  executedAt: new Date(),
                  issues: {
                    connect: stepIssues.map((id) => ({ id })),
                  },
                };

                return createTestRunStepResult({ data: stepResultData });
              }
              return null;
            }
          });
          // Flatten the array of arrays that might result from shared step groups
          await Promise.all(
            (await Promise.all(stepResultsPromises)).flat().filter(Boolean)
          );
        }

        // Upload attachments if there are any
        if (selectedFiles.length > 0 && result) {
          await uploadFiles(result.id);
        }

        // --- Trigger forecast update for this case ---
        if (repositoryCase?.id && hasSubmittedElapsedTime)
          fetch(`/api/forecast/update?caseId=${repositoryCase.id}`);
      }

      // Reset form with current status and default values
      const currentStatusId = form.getValues("statusId");
      form.reset({
        statusId: currentStatusId,
        resultData: emptyEditorContent,
        evidence: {},
        elapsed: "",
        attempt: nextAttempt + 1,
        ...templateFields.reduce((acc: Record<string, any>, field) => {
          acc[field.resultField.id.toString()] =
            field.resultField.defaultValue || null;
          return acc;
        }, {}),
        ...steps.reduce((acc: Record<string, any>, step) => {
          const stepId = step.id.toString();
          acc[`step_${stepId}_statusId`] = "";
          acc[`step_${stepId}_notes`] = emptyEditorContent;
          acc[`step_${stepId}_evidence`] = {};
          acc[`step_${stepId}_elapsed`] = "";
          return acc;
        }, {}),
      });

      // Reset the TimeTracker
      timeTrackerRef.current?.reset();

      // Reset selected files
      setSelectedFiles([]);

      // Increment keys to force re-render
      setEditorKey((prevKey) => prevKey + 1);
      setUploadAttachmentsKey((prevKey) => prevKey + 1);

      // Reset issue state
      setSelectedMainIssues([]);
      setSelectedStepIssues({});
      setSelectedSharedItemIssues({}); // Reset shared item issues

      toast.success(
        isBulkResult
          ? tCommon("actions.resultsAdded", {
              count: selectedCases.length,
            })
          : tCommon("actions.resultAdded"),
        {
          description: isBulkResult
            ? tCommon("actions.resultsAddedDescription", {
                count: selectedCases.length,
              })
            : tCommon("actions.resultAddedDescription"),
        }
      );

      onClose();
    } catch (error) {
      console.error("Error submitting result:", error);
      toast.error(tCommon("errors.error"), {
        description: tCommon("errors.somethingWentWrong"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Add effect to handle keyboard event propagation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen) {
        e.stopPropagation();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown, true);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  // Check for loading states and required data
  const isLoadingData =
    !session ||
    !statuses ||
    isLoadingCase ||
    isLoadingTemplateFields ||
    isLoadingProject;

  if (isLoadingData) {
    // Return a dialog with loading state instead of null to prevent parent re-render issues
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{tCommon("actions.addResult")}</DialogTitle>
            <DialogDescription>
              <LoadingSpinner />
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Ensure we have a valid statusId
  const currentStatusId =
    form.getValues("statusId") ||
    (statuses.length > 0 ? statuses[0].id.toString() : "");
  if (!form.getValues("statusId") && statuses.length > 0) {
    form.setValue("statusId", statuses[0].id.toString());
  }

  // Render the dynamic fields based on their type
  const renderDynamicField = (field: any) => {
    const fieldId = field.resultField.id.toString();
    const fieldType = field.resultField.type?.type;
    const displayName = field.resultField.displayName;
    const hint = field.resultField.hint;
    const isRequired = field.resultField.isRequired;
    const isRestricted = field.resultField.isRestricted; // Get restricted flag
    const isDisabled = isRestricted && !canEditRestrictedPerm; // Calculate disabled state

    const fieldOptions =
      field.resultField.fieldOptions?.map(
        (option: any) => option.fieldOption
      ) || [];

    // Add a default case to return something even if field type is unrecognized
    let fieldComponent;

    switch (fieldType) {
      case "Text String":
      case "Text":
        fieldComponent = (
          <FormField
            key={fieldId}
            control={form.control}
            name={fieldId}
            render={({ field: formField }: { field: any }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && ( // Add LockIcon
                    <span title="Restricted Field" className="ml-1">
                      <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                    </span>
                  )}
                </FormLabel>
                {hint && (
                  <p className="text-sm text-muted-foreground">{hint}</p>
                )}
                <FormControl>
                  <Input
                    value={(formField.value as string) ?? ""}
                    onChange={formField.onChange}
                    ref={formField.ref}
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
        break;
      case "Number":
        fieldComponent = (
          <FormField
            key={fieldId}
            control={form.control}
            name={fieldId}
            render={({ field: formField }: { field: any }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && ( // Add LockIcon
                    <span title="Restricted Field" className="ml-1">
                      <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                    </span>
                  )}
                </FormLabel>
                {hint && (
                  <p className="text-sm text-muted-foreground">{hint}</p>
                )}
                <FormControl>
                  <Input
                    type="number"
                    value={(formField.value as number | null) ?? ""}
                    onChange={(e) => {
                      const val = e.target.value
                        ? Number(e.target.value)
                        : null;
                      formField.onChange(val);
                    }}
                    disabled={isDisabled}
                    ref={formField.ref}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
        break;
      case "Dropdown":
        fieldComponent = (
          <FormField
            key={fieldId}
            control={form.control}
            name={fieldId}
            render={({ field: formField }: { field: any }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && ( // Add LockIcon
                    <span title="Restricted Field" className="ml-1">
                      <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                    </span>
                  )}
                </FormLabel>
                {hint && (
                  <p className="text-sm text-muted-foreground">{hint}</p>
                )}
                <FormControl>
                  <Select
                    onValueChange={formField.onChange}
                    value={(formField.value as string) ?? ""}
                    disabled={isDisabled}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={`Select ${displayName}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldOptions.map((option: any) => (
                        <SelectItem key={option.id} value={option.name}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
        break;
      case "Text Long":
      case "RichText":
        {
          // Get initialHeight
          const initialHeight = field.resultField.initialHeight;
          const editorClassName = `min-h-[100px] border rounded-md w-full ${
            initialHeight ? `min-h-[${initialHeight}px]` : ""
          }`;

          fieldComponent = (
            <FormField
              key={fieldId}
              control={form.control}
              name={fieldId}
              render={({ field: formField }: { field: any }) => {
                // Determine initial content for TipTap here, similar to RenderField
                let initialContent: any = emptyEditorContent;
                const definedDefaultValue = field.resultField.defaultValue;

                if (
                  typeof formField.value === "object" &&
                  formField.value !== null
                ) {
                  // If form state already has a valid object (e.g., from previous input), use it
                  initialContent = formField.value;
                } else if (definedDefaultValue) {
                  // Otherwise, try to use the default value
                  try {
                    initialContent = JSON.parse(definedDefaultValue);
                  } catch (e) {
                    if (typeof definedDefaultValue === "string") {
                      initialContent = {
                        type: "doc",
                        content: [
                          {
                            type: "paragraph",
                            content: [
                              { type: "text", text: definedDefaultValue },
                            ],
                          },
                        ],
                      };
                    } else {
                      initialContent = emptyEditorContent; // Fallback
                    }
                  }
                }

                return (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      {displayName}
                      {isRequired && (
                        <span className="text-destructive">{"*"}</span>
                      )}
                      {isRestricted && ( // Add LockIcon
                        <span title="Restricted Field" className="ml-1">
                          <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                        </span>
                      )}
                    </FormLabel>
                    {hint && (
                      <p className="text-sm text-muted-foreground">{hint}</p>
                    )}
                    <FormControl>
                      <TipTapEditor
                        // Pass the calculated initial content
                        content={initialContent}
                        onUpdate={(content) => formField.onChange(content)}
                        projectId={projectId.toString()}
                        className={editorClassName}
                        placeholder={`Enter ${displayName.toLowerCase()} here...`}
                        readOnly={isDisabled}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          );
        }
        break;
      default:
        // Default to text input if type is unknown
        console.warn(`Unknown field type: ${fieldType}`);
        fieldComponent = (
          <FormField
            key={fieldId}
            control={form.control}
            name={fieldId}
            render={({ field: formField }: { field: any }) => {
              return (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    {`${displayName} (${fieldType})`}
                    {isRequired && (
                      <span className="text-destructive">{"*"}</span>
                    )}
                    {isRestricted && ( // Add LockIcon
                      <span title="Restricted Field" className="ml-1">
                        <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                      </span>
                    )}
                  </FormLabel>
                  {hint && (
                    <p className="text-sm text-muted-foreground">{hint}</p>
                  )}
                  <FormControl>
                    <Input
                      value={formField.value ?? ""}
                      onChange={formField.onChange}
                      ref={formField.ref}
                      disabled={isDisabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        );
    }

    return fieldComponent;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-4xl transition-all duration-2000 border-8"
        style={{
          borderColor: form.watch("statusId")
            ? statuses?.find((s) => s.id.toString() === form.watch("statusId"))
                ?.color?.value
            : undefined,
          backgroundColor: "hsl(var(--background))",
        }}
      >
        <DialogHeader>
          <DialogTitle>{tCommon("actions.addResult")}</DialogTitle>
          <DialogDescription>
            <div className="text-sm text-muted-foreground flex flex-col gap-1">
              {isBulkResult ? (
                tCommon("actions.addingResultsToMultiple", {
                  count: selectedCases.length,
                })
              ) : (
                <div className="flex items-center">
                  <ListChecks className="mr-1 h-4 w-4 shrink-0" />
                  {caseName}
                </div>
              )}
              {configuration && (
                <Badge className="flex items-center gap-1 text-sm w-fit">
                  <Combine className="w-4 h-4 shrink-0" />
                  <span>{configuration.name}</span>
                </Badge>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit(handleSubmit)(e);
            }}
            className="space-y-2"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="statusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.status")}
                      <HelpPopover helpKey="testResult.status" />
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={handleStatusChange}
                        value={currentStatusId as string}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={tCommon("placeholders.selectStatus")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {statuses?.map((status) => (
                            <SelectItem
                              key={status.id}
                              value={status.id.toString()}
                            >
                              <div className="flex items-center">
                                <div
                                  className="w-3 h-3 rounded-full mr-2"
                                  style={{
                                    backgroundColor:
                                      status.color?.value || "#B1B2B3",
                                  }}
                                />
                                <span>{status.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="elapsed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.elapsed")}
                      <HelpPopover helpKey="testResult.elapsedTime" />
                    </FormLabel>
                    <div className="flex items-end space-x-2">
                      <div className="time-tracker">
                        <TimeTracker
                          ref={timeTrackerRef}
                          onTimeUpdate={handleTimeUpdate}
                        />
                      </div>
                      <FormControl>
                        <Input
                          {...field}
                          value={(field.value as string) || ""}
                          placeholder={tCommon("placeholders.duration")}
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* --- Manage Issues --- */}
            <FormItem>
              <FormLabel className="flex items-center gap-1">
                <Bug className="h-4 w-4" />
                {tCommon("fields.issues")}
                <HelpPopover helpKey="testResult.issues" />
              </FormLabel>
              <FormControl>
                <UnifiedIssueManager
                  projectId={Number(projectId)}
                  linkedIssueIds={selectedMainIssues}
                  setLinkedIssueIds={setSelectedMainIssues}
                  entityType="testRunResult"
                />
              </FormControl>
            </FormItem>

            {/* --- Result Details --- */}
            <FormField
              control={form.control}
              name="resultData"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("actions.resultDetails")}
                    <HelpPopover helpKey="testResult.resultData" />
                  </FormLabel>
                  <FormControl>
                    <div className="w-full border rounded-lg">
                      <TipTapEditor
                        key={editorKey}
                        content={field.value as any}
                        onUpdate={field.onChange}
                        placeholder={t(
                          "common.actions.resultDetailsPlaceholder"
                        )}
                        projectId={projectId.toString()}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Dynamic template fields */}
            {templateFields.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templateFields.map((field: any) => (
                    <React.Fragment key={field.resultField.id}>
                      {renderDynamicField(field)}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Step results */}
            {steps.length > 0 && (
              <div className="space-y-4">
                <div className="font-bold -mb-2">
                  {t("repository.fields.steps")}
                </div>
                <ol className="space-y-4">
                  {steps.map((step, index) => {
                    const stepId = step.id.toString();

                    // Handle Shared Step Group
                    if (step.sharedStepGroupId && step.sharedStepGroup) {
                      return (
                        <li
                          key={`shared-group-${step.sharedStepGroupId}-${index}`}
                          className="space-y-2 border-2 border-primary/20 rounded-lg bg-secondary/50 p-2"
                        >
                          <div className="flex items-center font-bold text-primary mb-2">
                            <Layers className="mr-2 h-5 w-5 shrink-0" />
                            {step.sharedStepGroup.name ||
                              t("repository.steps.unnamedSharedGroup")}
                          </div>
                          <SharedStepGroupInputs
                            sharedStepGroupId={step.sharedStepGroupId}
                            control={form.control}
                            setValue={form.setValue}
                            getValues={form.getValues}
                            statuses={statuses || []}
                            projectId={projectId}
                            projectIntegration={
                              projectData?.projectIntegrations?.[0]
                            }
                            selectedIssues={selectedSharedItemIssues}
                            setSelectedIssues={setSelectedSharedItemIssues}
                            issueMap={issueMap}
                          />
                        </li>
                      );
                    }

                    // Handle Regular Step
                    let stepContent;
                    try {
                      stepContent =
                        typeof step.step === "string"
                          ? JSON.parse(step.step)
                          : step.step;
                    } catch (error) {
                      // console.warn("Error parsing step content:", error);
                      stepContent = emptyEditorContent;
                    }

                    let expectedResultContent;
                    try {
                      if (typeof step.expectedResult === "string") {
                        expectedResultContent = JSON.parse(step.expectedResult);
                      } else if (
                        typeof step.expectedResult === "object" &&
                        step.expectedResult !== null
                      ) {
                        expectedResultContent = step.expectedResult; // Assume it's a valid TipTap JSON object
                      } else {
                        // For null, undefined, boolean, number, or any other type
                        expectedResultContent = emptyEditorContent;
                      }
                    } catch (error) {
                      // This catch is primarily for JSON.parse errors
                      console.warn(
                        "Error processing expected result content:",
                        error
                      );
                      expectedResultContent = emptyEditorContent;
                    }

                    return (
                      <li
                        key={step.id}
                        className="space-y-2 border-2 border-primary/20 rounded-lg bg-secondary/50 p-2"
                      >
                        <div className="flex gap-2 shrink-0 w-full ring-2 ring-primary/50 p-2 rounded-lg bg-primary-foreground rounded-b-none">
                          <div className="font-bold flex items-center justify-center p-2 text-primary-foreground bg-primary border-2 border-primary rounded-full w-8 h-8">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <TipTapEditor
                              content={stepContent}
                              readOnly={true}
                              projectId={`step_${step.id}`}
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
                              projectId={`step_${step.id}_expected`}
                              className="prose-sm"
                            />
                          </div>
                        </div>
                        <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name={`step_${stepId}_statusId`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center gap-2">
                                  {tCommon("fields.status")}
                                  <HelpPopover helpKey="testResult.stepStatus" />
                                </FormLabel>
                                <FormControl>
                                  <Select
                                    onValueChange={(value) => {
                                      field.onChange(value);
                                      if (value && isFailureStatus(value)) {
                                        form.setValue("statusId", value, {
                                          shouldValidate: true,
                                          shouldDirty: true,
                                        });
                                      }
                                    }}
                                    value={(field.value as string) || ""}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue
                                        placeholder={t(
                                          "common.placeholders.selectStatus"
                                        )}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {statuses?.map((status) => (
                                        <SelectItem
                                          key={status.id}
                                          value={status.id.toString()}
                                        >
                                          <div className="flex items-center">
                                            <div
                                              className="w-3 h-3 rounded-full mr-2"
                                              style={{
                                                backgroundColor:
                                                  status.color?.value ||
                                                  "#B1B2B3",
                                              }}
                                            />
                                            <span>{status.name}</span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`step_${stepId}_elapsed`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="flex items-center">
                                  {tCommon("fields.elapsed")}
                                  <HelpPopover helpKey="testResult.stepElapsedTime" />
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    value={(field.value as string) || ""}
                                    placeholder={t(
                                      "common.placeholders.duration"
                                    )}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={form.control}
                          name={`step_${stepId}_notes`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center">
                                {tCommon("actions.resultDetails")}
                                <HelpPopover helpKey="testResult.stepNotes" />
                              </FormLabel>
                              <FormControl>
                                <div className="w-full border rounded-lg">
                                  <TipTapEditor
                                    content={field.value || emptyEditorContent}
                                    onUpdate={field.onChange}
                                    placeholder={t(
                                      "common.actions.resultDetailsPlaceholder"
                                    )}
                                    projectId={`step_${step.id}_notes`}
                                  />
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Issue linking for this step */}
                        <FormItem>
                          <FormLabel className="flex items-center gap-1">
                            <Bug className="h-4 w-4" />
                            {tCommon("fields.issues")} {"("}
                            {tCommon("fields.step")} {index + 1}
                            {")"}
                          </FormLabel>
                          <FormControl>
                            <UnifiedIssueManager
                              projectId={Number(projectId)}
                              linkedIssueIds={selectedStepIssues[step.id] || []}
                              setLinkedIssueIds={(ids) => {
                                setSelectedStepIssues((prev) => ({
                                  ...prev,
                                  [step.id]: ids,
                                }));
                              }}
                              entityType="testRunStepResult"
                            />
                          </FormControl>
                        </FormItem>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            <div className="space-y-2">
              <FormLabel className="flex items-center">
                {tCommon("fields.attachments")}
                <HelpPopover helpKey="testResult.evidence" />
              </FormLabel>
              <UploadAttachments
                key={uploadAttachmentsKey}
                onFileSelect={setSelectedFiles}
              />
            </div>

            <div className="flex justify-end space-x-2">
              <Button variant="outline" type="button" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>{tCommon("status.submitting")}</>
                ) : (
                  <>{tCommon("actions.save")}</>
                )}
              </Button>
            </div>
          </form>
        </Form>

        {selectedAttachmentIndex !== null && (
          <AttachmentsCarousel
            attachments={selectedAttachments}
            initialIndex={selectedAttachmentIndex}
            onClose={handleAttachmentClose}
            canEdit={false} // TODO: Add canEdit
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Define a type for statuses to be passed to SharedStepGroupInputs
type StatusForSelect = Pick<PrismaStatus, "id" | "name" | "isFailure"> & {
  color?: Pick<PrismaColor, "value"> | null;
};

// More specific types for react-hook-form functions
import { UseFormSetValue, UseFormGetValues } from "react-hook-form";
import LoadingSpinner from "~/components/LoadingSpinner";

// New component for Shared Step Group Inputs
interface SharedStepGroupInputsProps {
  sharedStepGroupId: number;
  control: any; // Control from react-hook-form
  setValue: UseFormSetValue<FormValues>;
  getValues: UseFormGetValues<FormValues>;
  statuses: StatusForSelect[];
  projectId: number;
  projectIntegration?: any;
  selectedIssues: Record<number, number[]>;
  setSelectedIssues: React.Dispatch<
    React.SetStateAction<Record<number, number[]>>
  >;
  issueMap: Map<number, { key: string; title: string; url?: string }>;
}

const SharedStepGroupInputs: React.FC<SharedStepGroupInputsProps> = ({
  sharedStepGroupId,
  control,
  setValue,
  getValues,
  statuses,
  projectId,
  projectIntegration,
  selectedIssues,
  setSelectedIssues,
  issueMap,
}): React.ReactNode => {
  // Explicitly set return type to React.ReactNode
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const { data: items, isLoading } = useFindManySharedStepItem({
    where: { sharedStepGroupId },
    orderBy: { order: "asc" },
  });
  const queryClient = useQueryClient(); // Added for use in useEffect to setQueryData

  useEffect(() => {
    if (items) {
      // Potentially update React Query cache if this component is the source of truth for these items
      queryClient.setQueryData(["sharedStepItems", sharedStepGroupId], items);

      items.forEach((item) => {
        const notesFieldName = `shared_item_${item.id}_notes`;
        if (!(notesFieldName in getValues())) {
          setValue(notesFieldName, emptyEditorContent, {
            shouldDirty: false,
          });
        }
        const statusFieldName = `shared_item_${item.id}_statusId`;
        if (!(statusFieldName in getValues())) {
          setValue(statusFieldName, "", {
            shouldDirty: false,
          });
        }
        const elapsedFieldName = `shared_item_${item.id}_elapsed`;
        if (!(elapsedFieldName in getValues())) {
          setValue(elapsedFieldName, "", {
            shouldDirty: false,
          });
        }
        const evidenceFieldName = `shared_item_${item.id}_evidence`;
        if (!(evidenceFieldName in getValues())) {
          setValue(evidenceFieldName, {}, { shouldDirty: false });
        }
      });
    }
  }, [items, setValue, getValues, queryClient, sharedStepGroupId]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!items || items.length === 0) {
    return <p>{t("repository.steps.noStepsInSharedGroup")}</p>;
  }

  return (
    <div className="space-y-4 ml-4 pl-4 border-l-2 border-dashed">
      {items.map((item, index) => {
        const itemIdStr = item.id.toString();
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
          <div
            key={item.id}
            className="space-y-2 border rounded-md p-3 bg-muted/30"
          >
            <div className="flex gap-2 shrink-0 w-full ring-1 ring-primary/30 p-2 rounded-lg bg-primary-foreground rounded-b-none">
              <div className="font-bold flex items-center justify-center p-1 text-primary-foreground bg-primary border border-primary rounded-full w-6 h-6 text-xs">
                {index + 1}
              </div>
              <div className="flex-1">
                <TipTapEditor
                  content={stepContent}
                  readOnly
                  projectId={`shared_item_step_${item.id}`}
                  className="prose-sm"
                />
              </div>
            </div>
            <div className="flex gap-1 shrink-0 w-full ring-1 ring-primary/30 p-2 rounded-lg bg-primary-foreground rounded-t-none">
              <SearchCheck className="text-primary h-6 w-6 shrink-0 mt-0.5" />
              <div className="flex-1">
                <TipTapEditor
                  content={expectedResultContent}
                  readOnly
                  projectId={`shared_item_expected_${item.id}`}
                  className="prose-sm"
                />
              </div>
            </div>

            <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={control}
                name={`shared_item_${itemIdStr}_statusId`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      {tCommon("fields.status")}{" "}
                      <HelpPopover helpKey="testResult.stepStatus" />
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (
                            value &&
                            statuses.find((s) => s.id.toString() === value)
                              ?.isFailure
                          ) {
                            // Check isFailure directly
                            // Also update the main form's status if a shared item fails
                            setValue("statusId", value, {
                              shouldValidate: true,
                              shouldDirty: true,
                            });
                          }
                        }}
                        value={(field.value as string) || ""}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={tCommon("placeholders.selectStatus")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {statuses.map((status) => (
                            <SelectItem
                              key={status.id}
                              value={status.id.toString()}
                            >
                              <div className="flex items-center">
                                <div
                                  className="w-3 h-3 rounded-full mr-2"
                                  style={{
                                    backgroundColor:
                                      status.color?.value || "#B1B2B3",
                                  }}
                                />
                                <span>{status.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`shared_item_${itemIdStr}_elapsed`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.elapsed")}{" "}
                      <HelpPopover helpKey="testResult.stepElapsedTime" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={(field.value as string) || ""}
                        placeholder={tCommon("placeholders.duration")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={control}
              name={`shared_item_${itemIdStr}_notes`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("actions.resultDetails")}{" "}
                    <HelpPopover helpKey="testResult.stepNotes" />
                  </FormLabel>
                  <FormControl>
                    <div className="w-full border rounded-lg">
                      <TipTapEditor
                        content={field.value || emptyEditorContent}
                        onUpdate={field.onChange}
                        placeholder={t(
                          "common.actions.resultDetailsPlaceholder"
                        )}
                        projectId={`shared_item_notes_${item.id}`}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Issue linking for this shared step item */}
            <FormItem>
              <FormLabel className="flex items-center gap-1">
                <Bug className="h-4 w-4" />
                {tCommon("fields.issues")} {"("}
                {tCommon("fields.step")} {index + 1}
                {")"}
              </FormLabel>
              <FormControl>
                <UnifiedIssueManager
                  projectId={projectId}
                  linkedIssueIds={selectedIssues[item.id] || []}
                  setLinkedIssueIds={(ids) => {
                    setSelectedIssues((prev) => ({
                      ...prev,
                      [item.id]: ids,
                    }));
                  }}
                  entityType="testRunStepResult"
                />
              </FormControl>
            </FormItem>
          </div>
        );
      })}
    </div>
  );
};
