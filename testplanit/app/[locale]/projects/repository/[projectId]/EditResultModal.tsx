import { useState, useRef, useEffect } from "react";
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
import { Attachments } from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useFindManyStatus,
  useUpdateTestRunResults,
  useCreateAttachments,
  useFindManyTestRunResults,
  useFindFirstRepositoryCases,
  useFindManyTemplateResultAssignment,
  useCreateResultFieldValues,
  useUpdateResultFieldValues,
  useUpdateTestRunStepResults,
  useCreateTestRunStepResults,
  useFindFirstWorkflows,
  useFindFirstProjects,
} from "~/lib/hooks";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { ListChecks, SearchCheck, Trash2, LockIcon } from "lucide-react";
import { emptyEditorContent } from "~/app/constants";
import { JsonValue } from "@prisma/client/runtime/library";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { Bug } from "lucide-react";
import type { Issue } from "@prisma/client";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { MAX_DURATION } from "~/app/constants";
import type { useTranslations as useTranslationsType } from "next-intl";

interface StepsWithExpectedResult {
  id: number;
  step: any;
  testCaseId: number;
  order: number;
  expectedResult?: {
    id: number;
    expectedResult: any;
    stepId: number;
  } | null;
}

interface TestRunResult {
  id: number;
  testRunId: number;
  testRunCaseId: number;
  statusId: number;
  executedById: string;
  executedAt: Date;
  elapsed: number | null;
  notes: JsonValue;
  evidence: JsonValue;
  attachments: Attachments[];
  resultFieldValues: {
    id: number;
    fieldId: number;
    value: JsonValue;
  }[];
  stepResults: {
    id: number;
    stepId: number;
    statusId: number;
    notes: JsonValue;
    evidence: JsonValue;
    elapsed: number | null;
    issues?: Issue[];
  }[];
  issues?: Issue[];
}

interface StepResult {
  id: number;
  stepId: number;
  statusId: number;
  notes: any;
  evidence: any;
  elapsed: number | null;
}

// Helper function to map field types to Zod schemas
const mapFieldToZodType = (
  field: any,
  tCommon: ReturnType<typeof useTranslationsType<"common">>,
  displayName: string
) => {
  const fieldType = field.resultField.type?.type;
  const isRequired = field.resultField.isRequired;

  let schema;

  switch (fieldType) {
    case "Text":
    case "Dropdown":
    case "Radio":
    case "Checkbox":
      schema = z.string();
      if (isRequired) {
        schema = schema.min(1, {
          message: tCommon("validation.required", { field: displayName }),
        });
      }
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
      schema = z.any();
      break;
    default:
      schema = z.string();
  }

  if (!isRequired) {
    return schema.nullable().optional();
  }

  return schema;
};

// @ts-expect-error - No type definitions for parse-duration locales
import es from "parse-duration/locale/es.js";

// Update the form schema to include dynamic fields
const formSchema = (
  locale: string,
  tCommon: ReturnType<typeof useTranslationsType<"common">>,
  templateFields: any[] = [],
  steps: StepsWithExpectedResult[] = []
) => {
  if (locale.startsWith("es")) {
    parseDuration.unit = es;
  }

  const baseSchema = {
    statusId: z.number(),
    notes: z.any().optional(),
    elapsed: z
      .string()
      .nullable()
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
    attachments: z.array(z.any()).optional(),
  };

  // Add dynamic fields from template
  const dynamicSchema = templateFields.reduce((acc: any, field: any) => {
    acc[field.resultField.id.toString()] = mapFieldToZodType(
      field,
      tCommon,
      field.resultField.displayName
    );
    return acc;
  }, {});

  // Add schema for step results
  const stepResultsSchema = steps.reduce((acc: any, step) => {
    const stepId = step.id.toString();
    acc[`step_${stepId}_statusId`] = z.number().optional();
    acc[`step_${stepId}_notes`] = z.any().optional();
    acc[`step_${stepId}_evidence`] = z.any().optional();
    acc[`step_${stepId}_elapsed`] = z.string().nullable().optional();
    return acc;
  }, {});

  return z.object({ ...baseSchema, ...dynamicSchema, ...stepResultsSchema });
};

type FormValues = z.infer<ReturnType<typeof formSchema>>;

interface EditResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  testRunId: number;
  testRunCaseId: number;
  resultId: number;
  caseName: string;
  projectId: number;
  steps?: StepsWithExpectedResult[];
}

// Helper function to parse TipTap content
const parseTipTapContent = (content: any) => {
  if (!content) return emptyEditorContent;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch (e) {
      return emptyEditorContent;
    }
  }
  return content;
};

export function EditResultModal({
  isOpen,
  onClose,
  testRunId,
  testRunCaseId,
  resultId,
  caseName,
  projectId,
  steps = [],
}: EditResultModalProps) {
  const t: ReturnType<typeof useTranslationsType<"runs.edit">> =
    useTranslations("runs.edit");
  const tCommon: ReturnType<typeof useTranslationsType<"common">> =
    useTranslations("common");
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedMainIssues, setSelectedMainIssues] = useState<number[]>([]);
  const [selectedStepIssues, setSelectedStepIssues] = useState<
    Record<number, number[]>
  >({});

  // Fetch permissions
  const {
    permissions: testRunResultPermissions,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(projectId, ApplicationArea.TestRunResults);
  const canDeleteResults = testRunResultPermissions?.canDelete ?? false;
  const canAddEditResults = testRunResultPermissions?.canAddEdit ?? false;

  // Fetch Restricted Fields permission (NEW)
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

  // Fetch the existing result data
  const { data: existingResult } = useFindManyTestRunResults<{
    where: {
      testRunId: number;
      testRunCaseId: number;
    };
    include: {
      status: true;
      executedBy: true;
      resultFieldValues: true;
      stepResults: {
        include: {
          stepStatus: true;
          step: true;
          issues: true;
        };
      };
      attachments: true;
      issues: true;
    };
  }>({
    where: {
      testRunId,
      testRunCaseId,
    },
    include: {
      status: true,
      executedBy: true,
      resultFieldValues: true,
      stepResults: {
        include: {
          stepStatus: true,
          step: true,
          issues: true,
        },
      },
      attachments: true,
      issues: true,
    },
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

  // Update templateFields state when template result fields are loaded
  useEffect(() => {
    if (templateResultFields) {
      setTemplateFields(templateResultFields);
    }
  }, [templateResultFields]);

  // Fetch project data to get issueConfigId
  const { data: projectData, isLoading: isLoadingProject } =
    useFindFirstProjects({
      where: { id: projectId },
      select: {
        projectIntegrations: {
          where: { isActive: true },
          include: { integration: true },
        },
      },
    });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema(locale, tCommon, templateFields, steps)),
    defaultValues: {
      statusId: "",
      notes: emptyEditorContent,
      elapsed: null,
      attachments: [],
      stepResults: steps.reduce((acc: Record<string, any>, step) => {
        acc[`step_${step.id.toString()}_statusId`] = "";
        acc[`step_${step.id.toString()}_notes`] = emptyEditorContent;
        acc[`step_${step.id.toString()}_evidence`] = {};
        acc[`step_${step.id.toString()}_elapsed`] = "";
        return acc;
      }, {}),
      resultFieldValues: templateFields.reduce(
        (acc: Record<string, any>, field) => {
          acc[field.resultField.id.toString()] =
            field.resultField.defaultValue ?? null;
          return acc;
        },
        {}
      ),
    },
  });

  // Update the form reset effect
  useEffect(() => {
    if (resultId && testRunId && testRunCaseId && existingResult) {
      const result = (existingResult as TestRunResult[]).find(
        (r: TestRunResult) => r.id === Number(resultId)
      );

      if (result) {
        // Map step results to individual fields
        const initialStepIssues: Record<number, number[]> = {};
        const stepFields = result.stepResults?.reduce(
          (acc: Record<string, any>, step) => {
            acc[`step_${step.stepId}_statusId`] = step.statusId;
            acc[`step_${step.stepId}_notes`] =
              typeof step.notes === "string"
                ? JSON.parse(step.notes)
                : step.notes || emptyEditorContent;
            acc[`step_${step.stepId}_evidence`] =
              typeof step.evidence === "string"
                ? JSON.parse(step.evidence)
                : step.evidence || {};
            acc[`step_${step.stepId}_elapsed`] = step.elapsed
              ? toHumanReadable(step.elapsed, { isSeconds: true, locale })
              : "";
            // Populate initial step issues
            if (step.issues) {
              initialStepIssues[step.stepId] = step.issues.map(
                (issue: Issue) => issue.id
              );
            }
            return acc;
          },
          {}
        );

        const parsedData = {
          statusId: result.statusId,
          notes:
            typeof result.notes === "string"
              ? JSON.parse(result.notes)
              : result.notes || emptyEditorContent,
          evidence:
            typeof result.evidence === "string"
              ? JSON.parse(result.evidence)
              : result.evidence || {},
          elapsed: result.elapsed
            ? toHumanReadable(result.elapsed, { isSeconds: true, locale })
            : "",
          // Add dynamic field values
          ...result.resultFieldValues?.reduce(
            (
              acc: Record<string, any>,
              field: { fieldId: number; value: any }
            ) => {
              const fieldType = templateFields.find(
                (f) => f.resultField.id === field.fieldId
              )?.resultField.type?.type;

              if (fieldType === "Text Long") {
                try {
                  acc[field.fieldId] =
                    typeof field.value === "string"
                      ? JSON.parse(field.value)
                      : field.value || emptyEditorContent;
                } catch (e) {
                  acc[field.fieldId] = emptyEditorContent;
                }
              } else {
                acc[field.fieldId] = field.value;
              }
              return acc;
            },
            {} as Record<string, any>
          ),
          // Add step fields
          ...stepFields,
        };

        // Set initial issue state
        setSelectedMainIssues(
          result.issues?.map((issue: Issue) => issue.id) || []
        );
        setSelectedStepIssues(initialStepIssues);

        form.reset(parsedData);
      }
    }
  }, [
    resultId,
    testRunId,
    testRunCaseId,
    existingResult,
    form,
    locale,
    tCommon,
    templateFields,
  ]);

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

  // Second useEffect for status color
  useEffect(() => {
    if (statuses && form.getValues("statusId")) {
      const selectedStatus = statuses.find(
        (status) => status.id === form.getValues("statusId")
      );
      if (selectedStatus?.color?.value) {
        setSelectedStatusColor(selectedStatus.color.value);
      }
    }
  }, [statuses, form]);

  const { mutateAsync: updateTestRunResults } = useUpdateTestRunResults();
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: createResultFieldValues } = useCreateResultFieldValues();
  const { mutateAsync: updateTestRunStepResults } =
    useUpdateTestRunStepResults();
  const { mutateAsync: createTestRunStepResults } =
    useCreateTestRunStepResults();
  const { mutateAsync: updateResultFieldValues } = useUpdateResultFieldValues();

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

  const handleStatusChange = (statusId: number) => {
    form.setValue("statusId", statusId);
    const status = statuses?.find((s) => s.id === statusId);
    if (status?.color?.value) {
      setSelectedStatusColor(status.color.value);
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
  const isFailureStatus = (statusId: number) => {
    return (
      statuses?.find((status) => status.id === statusId)?.isFailure === true
    );
  };

  const onSubmit = async (values: FormValues) => {
    if (!session?.user?.id || !repositoryCase?.currentVersion) return;

    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Parse elapsed time back to seconds
      let elapsedInSeconds: number | null = null;
      if (values.elapsed) {
        const durationInMilliseconds = parseDuration(values.elapsed as string);
        if (durationInMilliseconds !== null) {
          elapsedInSeconds = Math.round(durationInMilliseconds / 1000);
        }
      }

      const updateData = {
        statusId: parseInt(values.statusId as any as string),
        notes: values.notes,
        elapsed: elapsedInSeconds,
        editedAt: new Date(),
        editedById: session.user.id,
        testRunCaseVersion: repositoryCase.currentVersion,
        issues: {
          set: selectedMainIssues.map((id) => ({ id })),
        },
      };

      // Update the test run result
      const result = await updateTestRunResults({
        where: { id: Number(resultId) },
        data: updateData as any,
      });

      if (!result) {
        throw new Error("Failed to update test run result");
      }

      // Update step results
      if (steps.length > 0) {
        for (const step of steps) {
          const stepId = step.id.toString();
          const stepStatusId = (values as any)[`step_${stepId}_statusId`];
          const stepNotes = (values as any)[`step_${stepId}_notes`];
          const stepEvidence = (values as any)[`step_${stepId}_evidence`];
          const stepElapsed = (values as any)[`step_${stepId}_elapsed`];

          // Calculate elapsed time for step
          let stepElapsedInSeconds: number | null = null;
          if (stepElapsed) {
            const duration = parseDuration(stepElapsed);
            if (duration !== null) {
              stepElapsedInSeconds = Math.round(duration / 1000);
            }
          }

          // Find existing step result from the existingResult
          const existingStepResult = existingResult
            ?.find((r: TestRunResult) => r.id === Number(resultId))
            ?.stepResults?.find((sr) => sr.stepId === step.id);

          if (existingStepResult) {
            // Update existing step result
            const updateStepData: any = {
              notes: stepNotes,
              evidence: stepEvidence,
              elapsed: stepElapsedInSeconds,
              issues: {
                set: (selectedStepIssues[step.id] || []).map((id) => ({ id })),
              },
            };
            if (stepStatusId && !isNaN(parseInt(stepStatusId))) {
              updateStepData.statusId = parseInt(stepStatusId);
            }

            await updateTestRunStepResults({
              where: { id: existingStepResult.id },
              data: updateStepData,
            });
          } else if (stepStatusId && !isNaN(parseInt(stepStatusId))) {
            // Create new step result only if a valid status ID is provided
            await createTestRunStepResults({
              data: {
                testRunResultId: result.id,
                stepId: step.id,
                statusId: parseInt(stepStatusId),
                notes: stepNotes || emptyEditorContent,
                evidence: stepEvidence || {},
                elapsed: stepElapsedInSeconds,
                issues: {
                  connect: (selectedStepIssues[step.id] || []).map((id) => ({
                    id,
                  })),
                },
              },
            });
          }
        }
      }

      // Update field values
      if (templateFields.length > 0) {
        for (const field of templateFields) {
          const fieldId = field.resultField.id;
          const value = (values as any)[fieldId];
          const fieldType = field.resultField.type?.type;

          // Find existing field value from the existingResult
          const existingFieldValue = existingResult
            ?.find((r: TestRunResult) => r.id === Number(resultId))
            ?.resultFieldValues?.find((fv: any) => fv.fieldId === fieldId);

          // Handle Text Long fields specially - no need to stringify
          const processedValue =
            fieldType === "Text Long"
              ? value // Already in the correct format
              : value;

          if (existingFieldValue) {
            // Update existing field value
            await updateResultFieldValues({
              where: { id: existingFieldValue.id },
              data: {
                value: processedValue,
              },
            });
          } else if (value !== undefined && value !== null) {
            // Create new field value
            await createResultFieldValues({
              data: {
                testRunResultsId: result.id,
                fieldId: fieldId,
                value: processedValue,
              },
            });
          }
        }
      }

      // Upload attachments if there are any
      if (selectedFiles.length > 0) {
        await uploadFiles(result.id);
      }

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({
        queryKey: ["testRunResults", testRunId, testRunCaseId],
      });

      toast.success(t("actions.resultUpdated"));
      onClose();
    } catch (error) {
      console.error("Error updating result:", error);
      toast.error(tCommon("errors.error"), {
        description: tCommon("errors.somethingWentWrong"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!resultId) return;

    setIsDeleting(true);
    try {
      // Soft delete the test run result by setting isDeleted to true
      await updateTestRunResults({
        where: {
          id: Number(resultId),
        },
        data: {
          isDeleted: true,
        },
      });

      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({
        queryKey: ["testRunResults", testRunId, testRunCaseId],
      });

      toast.success(t("actions.resultDeleted"));
      onClose();
    } catch (error) {
      console.error("Error deleting result:", error);
      toast.error(tCommon("errors.error"), {
        description: tCommon("errors.somethingWentWrong"),
      });
    } finally {
      setIsDeleting(false);
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

  if (
    !session ||
    !statuses ||
    isLoadingProject ||
    isLoadingCase ||
    isLoadingTemplateFields
  ) {
    return null;
  }

  // Ensure we have a valid statusId
  const currentStatusId =
    form.getValues("statusId") || (statuses.length > 0 ? statuses[0].id : 0);
  if (!form.getValues("statusId") && statuses.length > 0) {
    form.setValue("statusId", statuses[0].id);
  }

  // Update the form field rendering
  const renderStepFields = (step: StepsWithExpectedResult) => {
    const stepId = step.id;

    return (
      <div key={stepId} className="space-y-4 border p-4 rounded-md">
        <FormField
          control={form.control}
          name={`step_${stepId}_statusId`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center">
                {tCommon("fields.status")}
                <HelpPopover helpKey="testResult.stepStatus" />
              </FormLabel>
              <FormControl>
                <Select
                  onValueChange={(val: string) => field.onChange(Number(val))}
                  value={field.value?.toString() || ""}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={tCommon("placeholders.selectStatus")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses?.map((status) => (
                      <SelectItem key={status.id} value={status.id.toString()}>
                        <div className="flex items-center">
                          <div
                            className="w-3 h-3 rounded-full mr-2"
                            style={{
                              backgroundColor: status.color?.value || "#B1B2B3",
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
                  placeholder={tCommon("placeholders.duration")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`step_${stepId}_notes`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center">
                {tCommon("fields.notes")}
                <HelpPopover helpKey="testResult.stepNotes" />
              </FormLabel>
              <FormControl>
                <div className="w-full border rounded-lg">
                  <TipTapEditor
                    key={editorKey}
                    content={parseTipTapContent(field.value)}
                    onUpdate={(content: any) => field.onChange(content)}
                    placeholder={t("actions.resultDetailsPlaceholder")}
                    projectId={`step_${stepId}_notes`}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* --- Step Issues --- */}
        {projectData?.projectIntegrations?.[0] && (
          <FormItem>
            <FormLabel className="flex items-center gap-1">
              <Bug className="h-4 w-4" />
              {tCommon("fields.issues")}
              <HelpPopover helpKey="testResult.stepIssues" />
            </FormLabel>
            <FormControl>
              <UnifiedIssueManager
                projectId={Number(projectId)}
                linkedIssueIds={selectedStepIssues[stepId] || []}
                setLinkedIssueIds={(ids) =>
                  setSelectedStepIssues((prev) => ({ ...prev, [stepId]: ids }))
                }
                entityType="testRunResult"
              />
            </FormControl>
          </FormItem>
        )}
      </div>
    );
  };

  // Render the dynamic fields based on their type
  const renderDynamicField = (field: any) => {
    const fieldId = field.resultField.id.toString();
    const fieldType = field.resultField.type?.type;
    const displayName = field.resultField.displayName;
    const hint = field.resultField.hint;
    const isRequired = field.resultField.isRequired;
    const isRestricted = field.resultField.isRestricted;
    const isDisabled = isRestricted && !canEditRestrictedPerm;

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
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && (
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
                    {...formField}
                    value={(formField.value as string) ?? ""}
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
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && (
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
                    {...formField}
                    type="number"
                    value={(formField.value as number | null) ?? ""}
                    onChange={(e) => {
                      const val = e.target.value
                        ? Number(e.target.value)
                        : null;
                      formField.onChange(val);
                    }}
                    disabled={isDisabled}
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
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && (
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
                    onValueChange={(val: string) =>
                      field.onChange(val ? Number(val) : undefined)
                    }
                    value={(field.value as any)?.toString() || ""}
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
              render={({ field: formField }) => {
                // Parse the content if it's a string, otherwise use it as is
                const content =
                  typeof formField.value === "string"
                    ? JSON.parse(formField.value)
                    : formField.value || emptyEditorContent;

                return (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      {displayName}
                      {isRequired && (
                        <span className="text-destructive">{"*"}</span>
                      )}
                      {isRestricted && (
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
                        content={content}
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
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {`${displayName} (${fieldType})`}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                  {isRestricted && (
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
                    {...formField}
                    value={(formField.value as string) ?? ""}
                    disabled={isDisabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        );
    }

    return fieldComponent;
  };

  // Add a function to get the current status color with opacity
  const getSelectedStatusColorWithOpacity = (statusId: number | undefined) => {
    if (!statusId) return undefined;
    const status = statuses?.find((s) => s.id === statusId);
    if (!status?.color?.value) return undefined;

    // Convert hex to rgba with 0.2 opacity
    const hex = status.color.value.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.2)`;
  };

  // Update the step status change handler
  const handleStepStatusChange = (stepId: number, statusId: number) => {
    const stepResults = form.getValues("stepResults") || [];
    const stepIndex = (stepResults as any[]).findIndex(
      (s: StepResult) => s.stepId === stepId
    );

    if (stepIndex !== -1) {
      const updatedStepResults = [...(stepResults as any[])];
      updatedStepResults[stepIndex] = {
        ...updatedStepResults[stepIndex],
        statusId: statusId,
      };
      form.setValue("stepResults", updatedStepResults);
    } else {
      form.setValue("stepResults", [
        ...(stepResults as any[]),
        {
          id: 0,
          stepId: stepId,
          statusId: statusId,
          notes: null,
          evidence: null,
          elapsed: null,
        },
      ]);
    }

    // If this step is marked with a failure status, update the main status
    if (isFailureStatus(statusId)) {
      form.setValue("statusId", statusId);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-4xl transition-all duration-2000"
        style={{
          backgroundImage: form.watch("statusId")
            ? `linear-gradient(${getSelectedStatusColorWithOpacity(form.watch("statusId") as number)}, ${getSelectedStatusColorWithOpacity(form.watch("statusId") as number)})`
            : undefined,
          backgroundColor: "hsl(var(--background))",
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("actions.editResult")}</DialogTitle>
          <DialogDescription>
            <div className="text-sm text-muted-foreground flex items-center">
              <div className="flex items-center">
                <ListChecks className="mr-1 h-4 w-4 shrink-0" />
                {caseName}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit(onSubmit)(e);
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
                        key={`select-${field.value}`}
                        onValueChange={(val: string) => {
                          field.onChange(Number(val));
                        }}
                        value={(field.value as number).toString()}
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

            <FormField
              control={form.control}
              name="notes"
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
                        placeholder={t("actions.resultDetailsPlaceholder")}
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
                  {templateFields.map((field) => renderDynamicField(field))}
                </div>
              </div>
            )}

            {/* Step results */}
            {steps.length > 0 && (
              <div className="space-y-4">
                <div className="font-bold">{t("fields.steps")}</div>
                <ol className="space-y-4">
                  {steps.map((step, index) => {
                    const stepId = step.id.toString();
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
                      expectedResultContent =
                        typeof step.expectedResult?.expectedResult === "string"
                          ? JSON.parse(step.expectedResult.expectedResult)
                          : step.expectedResult?.expectedResult ||
                            emptyEditorContent;
                    } catch (error) {
                      console.warn(
                        "Error parsing expected result content:",
                        error
                      );
                      expectedResultContent = emptyEditorContent;
                    }

                    return (
                      <li key={step.id} className="space-y-2">
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {renderStepFields(step)}
                        </div>
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

            <div className="flex justify-between items-center">
              {!isLoadingPermissions && canDeleteResults && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      type="button"
                      disabled={isDeleting || isLoadingPermissions}
                      className="flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      {tCommon("actions.delete")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("actions.deleteResult")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("actions.deleteResultConfirmation")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {tCommon("actions.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isDeleting ? (
                          <>{tCommon("status.deleting")}</>
                        ) : (
                          <>{tCommon("actions.delete")}</>
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {!(!isLoadingPermissions && canDeleteResults) && <div></div>}
              <div className="flex space-x-2">
                <Button variant="outline" type="button" onClick={onClose}>
                  {tCommon("actions.cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>{tCommon("status.submitting")}</>
                  ) : (
                    <>{t("actions.save")}</>
                  )}
                </Button>
              </div>
            </div>

            {/* --- Manage Issues --- */}
            {projectData?.projectIntegrations?.[0] && (
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
            )}
          </form>
        </Form>

        {selectedAttachmentIndex !== null && (
          <AttachmentsCarousel
            attachments={selectedAttachments}
            initialIndex={selectedAttachmentIndex}
            onClose={handleAttachmentClose}
            canEdit={canAddEditResults}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
