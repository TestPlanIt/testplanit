"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useSession } from "next-auth/react";
import {
  useCreateSessionResults,
  useFindManyStatus,
  useCreateAttachments,
  useFindFirstSessions,
  useFindManyTemplateResultAssignment,
  useCreateResultFieldValues,
  useFindManyWorkflows,
  useUpdateSessions,
  useFindFirstProjects,
} from "~/lib/hooks";
import { emptyEditorContent } from "~/app/constants";
import { Button } from "@/components/ui/button";
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
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Save, Paperclip, Bug, Clock, CircleCheckBig } from "lucide-react";
import parseDuration from "parse-duration";
import { toHumanReadable } from "~/utils/duration";
import { MAX_DURATION } from "~/app/constants";
import { useTranslations, useLocale } from "next-intl";
import { getBackgroundStyle } from "~/utils/colorUtils";
import LoadingSpinner from "@/components/LoadingSpinner";
import { TimeTracker, TimeTrackerRef } from "@/components/TimeTracker";
import UploadAttachments from "@/components/UploadAttachments";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import type { Attachments } from "@prisma/client";
import { SimpleUnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
// Import Spanish locale for parseDuration
// @ts-expect-error - No type definitions for parse-duration locales
import es from "parse-duration/locale/es.js";
import { Separator } from "@/components/ui/separator";
import { useRouter } from "~/lib/navigation";
import { toast } from "sonner";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";

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
  templateFields: any[] = []
) => {
  // Set the locale for parseDuration if Spanish
  if (locale.startsWith("es")) {
    parseDuration.unit = es;
  }

  // Base schema with fixed fields
  const baseSchema = {
    statusId: z.string().min(1, {
      message: tCommon("validation.required", {
        field: tCommon("fields.status"),
      }),
    }),
    resultData: z.any().optional(),
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
    attachments: z.array(z.any()).optional(),
  };

  // Dynamic schema for template fields
  const dynamicSchema = templateFields.reduce(
    (schema, field) => {
      const fieldName = field.resultField.id.toString();
      schema[fieldName] = mapFieldToZodType(field);
      return schema;
    },
    {} as Record<string, z.ZodTypeAny>
  );

  return z.object({
    ...baseSchema,
    ...dynamicSchema,
  });
};

type FormValues = z.infer<ReturnType<typeof formSchema>>;

interface SessionResultFormProps {
  sessionId: number;
  projectId: string | number;
  onResultAdded?: () => void;
  alwaysShowForm?: boolean;
  className?: string;
  onStatusColorChange?: (color: string) => void;
}

export function SessionResultForm({
  sessionId,
  projectId,
  onResultAdded,
  alwaysShowForm = true,
  className = "mb-6",
  onStatusColorChange,
}: SessionResultFormProps) {
  const t = useTranslations("sessions.results");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedStatusColor, setSelectedStatusColor] =
    useState<string>("#3b82f6"); // Default to blue
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
  const [selectedIssues, setSelectedIssues] = useState<number[]>([]);
  const [stepFieldValues, setStepFieldValues] = useState<Record<number, any>>(
    {}
  );
  const [stepAttachments, setStepAttachments] = useState<
    Record<number, File[]>
  >({});

  // Fetch permissions for restricted fields
  const {
    permissions: restrictedFieldPermissions,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(Number(projectId), "SessionsRestrictedFields");
  const canEditRestrictedFields =
    restrictedFieldPermissions?.canAddEdit ?? false;

  // Fetch project data to get integrations
  const { data: projectData } = useFindFirstProjects({
    where: { id: Number(projectId) },
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

  // Fetch session data to get the template
  const { data: sessionData, isLoading: isLoadingSession } =
    useFindFirstSessions({
      where: {
        id: Number(sessionId),
      },
      include: {
        template: true,
        sessionResults: true,
        _count: {
          select: {
            sessionResults: true,
          },
        },
      },
    });

  // Fetch template result fields if we have a session with a template
  const { data: templateResultFields, isLoading: isLoadingTemplateFields } =
    useFindManyTemplateResultAssignment({
      where: {
        templateId: sessionData?.templateId || 0,
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

  // Get statuses that can be used for session results
  const { data: statuses, isLoading: isLoadingStatuses } = useFindManyStatus({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: {
        some: {
          scope: {
            name: "Session",
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

  const { data: inProgressWorkflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      isEnabled: true,
      workflowType: "IN_PROGRESS",
      scope: "SESSIONS",
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    orderBy: {
      order: "asc",
    },
  });

  const { mutateAsync: createSessionResult } = useCreateSessionResults();
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: createResultFieldValue } = useCreateResultFieldValues();
  const { mutateAsync: updateSession } = useUpdateSessions();

  // Update useEffect to remove debug logging
  useEffect(() => {
    if (templateResultFields) {
      setTemplateFields(templateResultFields);
    }
  }, [templateResultFields]);

  // Initialize form with dynamic schema
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema(locale, tCommon, templateFields)),
    defaultValues: {
      statusId: "",
      resultData: emptyEditorContent,
      elapsed: "",
      attachments: [],
    },
  });

  // Update form schema when template fields change
  useEffect(() => {
    if (templateFields && templateFields.length > 0) {
      // Create default values for the dynamic fields
      const dynamicDefaults = templateFields.reduce((acc, field) => {
        const fieldId = field.resultField.id.toString();
        acc[fieldId] = field.resultField.defaultValue || null;
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

  // Set default status when statuses are loaded
  useEffect(() => {
    if (statuses && statuses.length > 0) {
      const defaultStatusId = statuses[0].id.toString();

      // Set the form value directly
      form.setValue("statusId", defaultStatusId);

      // Set the initial color
      const defaultStatus = statuses.find(
        (status) => status.id.toString() === defaultStatusId
      );
      if (defaultStatus?.color?.value) {
        setSelectedStatusColor(defaultStatus.color.value);
        if (onStatusColorChange) {
          onStatusColorChange(defaultStatus.color.value);
        }
      }
    }
  }, [statuses, form, onStatusColorChange]);

  // Generate a dynamic background style with 10% opacity
  const editorBackgroundStyle = useMemo(() => {
    return getBackgroundStyle(selectedStatusColor);
  }, [selectedStatusColor]);

  const handleStatusChange = (statusId: string) => {
    // Update the form value with validation
    form.setValue("statusId", statusId, {
      shouldValidate: true,
      shouldDirty: true,
    });

    // Find the selected status and update the color
    const selectedStatus = statuses?.find(
      (status) => status.id.toString() === statusId
    );
    if (selectedStatus?.color?.value) {
      setSelectedStatusColor(selectedStatus.color.value);
      if (onStatusColorChange) {
        onStatusColorChange(selectedStatus.color.value);
      }
    }
  };

  const handleTimeUpdate = (seconds: number) => {
    setTrackedSeconds(seconds);
    if (seconds > 0) {
      // Convert seconds to a human-readable format for the elapsed field
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

  const uploadFiles = async (sessionResultId: number) => {
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
          sessionResults: {
            connect: { id: sessionResultId },
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

  const handleSubmit = async () => {
    if (!session?.user?.id) return;

    // Validate the entire form before proceeding
    const isValid = await form.trigger();
    if (!isValid) {
      return;
    }

    const values = form.getValues();
    setIsSubmitting(true);
    try {
      // Convert elapsed time to seconds if provided
      let elapsedInSeconds: number | null = null;
      if (values.elapsed) {
        const durationInMilliseconds = parseDuration(values.elapsed as string);
        if (durationInMilliseconds !== null) {
          elapsedInSeconds = Math.round(durationInMilliseconds / 1000);
        }
      }

      // Create the session result
      const result = await createSessionResult({
        data: {
          sessionId: sessionId,
          statusId: parseInt(values.statusId as string),
          resultData: values.resultData || emptyEditorContent,
          elapsed: elapsedInSeconds,
          createdById: session.user.id,
          issues: {
            connect: selectedIssues.map((id) => ({ id })),
          },
        },
      });

      // Check if this is the first result (count was 0 before adding this one)
      if (sessionData?._count.sessionResults === 0) {
        // If we found any IN_PROGRESS workflows, update the session state
        if (inProgressWorkflows && inProgressWorkflows.length > 0) {
          const firstInProgressWorkflow = inProgressWorkflows[0];

          await updateSession({
            where: { id: Number(sessionId) },
            data: {
              stateId: firstInProgressWorkflow.id,
            },
          });
        }
      }

      // Now save the template field values directly to the ResultFieldValues table
      if (result && templateFields.length > 0) {
        const fieldValuesPromises = templateFields.map((field) => {
          const fieldId = field.resultField.id.toString();
          const fieldValue = values[fieldId];

          // Only save if field has a value
          if (fieldValue !== undefined && fieldValue !== null) {
            return createResultFieldValue({
              data: {
                fieldId: parseInt(fieldId),
                value:
                  typeof fieldValue === "object"
                    ? JSON.stringify(fieldValue)
                    : String(fieldValue as string | number | boolean),
                sessionResultsId: result.id,
              },
            });
          }
          return Promise.resolve();
        });

        await Promise.all(fieldValuesPromises);
      }

      // Upload attachments if there are any
      if (selectedFiles.length > 0 && result) {
        await uploadFiles(result.id);
      }

      // Reset form with the current status and explicitly set resultData to emptyEditorContent
      const currentStatusId = form.getValues("statusId");
      form.reset({
        statusId: currentStatusId,
        resultData: emptyEditorContent,
        elapsed: "",
        attachments: [],
        ...templateFields.reduce((acc, field) => {
          acc[field.resultField.id.toString()] =
            field.resultField.defaultValue || null;
          return acc;
        }, {}),
      });

      // Reset the TimeTracker
      timeTrackerRef.current?.reset();

      // Reset selected files
      setSelectedFiles([]);
      // Reset selected issues
      setSelectedIssues([]);

      // Increment the key to force TipTapEditor to re-render
      setEditorKey((prevKey) => prevKey + 1);

      // Increment the key to force UploadAttachments to re-render
      setUploadAttachmentsKey((prevKey) => prevKey + 1);

      if (onResultAdded) {
        onResultAdded();
      }
      setIsSubmitting(false);
    } catch (error) {
      console.error("Error submitting result:", error);
      setIsSubmitting(false);
    }
  };

  if (
    isLoadingSession ||
    isLoadingStatuses ||
    isLoadingTemplateFields ||
    !session ||
    !statuses ||
    isLoadingPermissions
  ) {
    return <LoadingSpinner />;
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
    const fieldOptions =
      field.resultField.fieldOptions?.map(
        (option: any) => option.fieldOption
      ) || [];

    // Check if the field is restricted and user lacks permission
    const isFieldDisabled =
      field.resultField.isRestricted && !canEditRestrictedFields;

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
                </FormLabel>
                {hint && (
                  <p className="text-sm text-muted-foreground">{hint}</p>
                )}
                <FormControl>
                  <Input
                    {...formField}
                    value={(formField.value as string) ?? ""}
                    disabled={isFieldDisabled}
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
                    disabled={isFieldDisabled}
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
                </FormLabel>
                {hint && (
                  <p className="text-sm text-muted-foreground">{hint}</p>
                )}
                <FormControl>
                  <Select
                    onValueChange={formField.onChange}
                    value={(formField.value as string) ?? ""}
                    disabled={isFieldDisabled}
                  >
                    <SelectTrigger className="w-full truncate">
                      <SelectValue
                        className="truncate w-[85%]"
                        placeholder={tCommon("placeholders.selectStatus")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {statuses?.map((status) => (
                        <SelectItem
                          key={status.id}
                          value={status.id.toString()}
                          className="truncate"
                        >
                          <div className="flex items-center w-full truncate">
                            <div
                              className="w-3 h-3 rounded-full mr-2 shrink-0"
                              style={{
                                backgroundColor:
                                  status.color?.value || "#B1B2B3",
                              }}
                            ></div>
                            <span className="truncate">{status.name}</span>
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
              render={({ field: formField }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    {displayName}
                    {isRequired && (
                      <span className="text-destructive">{"*"}</span>
                    )}
                  </FormLabel>
                  {hint && (
                    <p className="text-sm text-muted-foreground">{hint}</p>
                  )}
                  <FormControl>
                    <TipTapEditor
                      key={editorKey}
                      content={formField.value ?? emptyEditorContent}
                      onUpdate={(content) => formField.onChange(content)}
                      projectId={projectId?.toString() ?? "0"}
                      className={editorClassName}
                      placeholder={`Enter ${displayName.toLowerCase()} here...`}
                      readOnly={isFieldDisabled}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
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
                </FormLabel>
                {hint && (
                  <p className="text-sm text-muted-foreground">{hint}</p>
                )}
                <FormControl>
                  <Input
                    {...formField}
                    value={(formField.value as string) ?? ""}
                    disabled={isFieldDisabled}
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

  return (
    <div className={`w-full ${className}`}>
      <Form {...form}>
        <div className="space-y-4 w-full">
          <FormField
            control={form.control}
            name="resultData"
            render={({ field }) => (
              <FormItem className="w-full">
                <FormControl>
                  <div className="w-full" style={editorBackgroundStyle}>
                    <TipTapEditor
                      key={editorKey}
                      content={field.value || emptyEditorContent}
                      onUpdate={(content) => field.onChange(content)}
                      projectId={projectId?.toString() ?? "0"}
                      className="min-h-[100px] border rounded-md w-full"
                      placeholder={t("details")}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
            {/* --- Row 1: Status, Time Tracker, Elapsed --- */}
            <div className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Status Dropdown */}
              <div className="lg:col-span-4 xl:col-span-3">
                <FormField
                  control={form.control}
                  name="statusId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <CircleCheckBig className="h-4 w-4" />
                        {tCommon("fields.status")}
                      </FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={handleStatusChange}
                          value={currentStatusId as string}
                        >
                          <SelectTrigger className="w-full truncate">
                            <SelectValue
                              className="truncate w-[85%]"
                              placeholder={tCommon("placeholders.selectStatus")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {statuses?.map((status) => (
                              <SelectItem
                                key={status.id}
                                value={status.id.toString()}
                                className="truncate"
                              >
                                <div className="flex items-center w-full truncate">
                                  <div
                                    className="w-3 h-3 rounded-full mr-2 shrink-0"
                                    style={{
                                      backgroundColor:
                                        status.color?.value || "#B1B2B3",
                                    }}
                                  ></div>
                                  <span className="truncate">
                                    {status.name}
                                  </span>
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
              </div>

              {/* Time Tracker */}
              <div className="lg:col-span-4 xl:col-span-5">
                <FormItem>
                  <FormControl>
                    <TimeTracker
                      ref={timeTrackerRef}
                      onTimeUpdate={handleTimeUpdate}
                    />
                  </FormControl>
                </FormItem>
              </div>

              {/* Elapsed Time Input */}
              <div className="lg:col-span-4 xl:col-span-4">
                <FormField
                  control={form.control}
                  name="elapsed"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {tCommon("fields.elapsed")}
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-end space-x-2">
                          <Input
                            {...field}
                            placeholder={tCommon("placeholders.elapsed")}
                            value={(field.value as string) ?? ""}
                            className="grow"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* --- Row 2: Attachments, Issues --- */}
            <div className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Attachments */}
              <div className="lg:col-span-6">
                <FormField
                  control={form.control}
                  name="attachments"
                  render={() => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <Paperclip className="h-4 w-4" />
                        {tCommon("fields.attachments")}
                      </FormLabel>
                      <FormControl>
                        <div>
                          <UploadAttachments
                            key={uploadAttachmentsKey}
                            onFileSelect={handleFileSelect}
                            compact={true}
                          />
                          {selectedFiles.length > 0 && (
                            <div className="text-sm text-muted-foreground mt-1">
                              {tCommon("upload.attachments.count", {
                                count: selectedFiles.length,
                              })}
                            </div>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Issues Section */}
              <div className="lg:col-span-6">
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <Bug className="h-4 w-4" />
                    {tCommon("fields.issues")}
                  </FormLabel>
                  <FormControl>
                    <SimpleUnifiedIssueManager
                      projectData={projectData || { projectIntegrations: [] }}
                      projectId={Number(projectId)}
                      linkedIssueIds={selectedIssues}
                      setLinkedIssueIds={setSelectedIssues}
                      entityType="sessionResult"
                    />
                  </FormControl>
                </FormItem>
              </div>
            </div>

            {/* --- Row 3: Dynamic Fields --- */}
            {templateFields.length > 0 && (
              <div className="lg:col-span-12 space-y-4">
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templateFields.map((field) => {
                    const fieldComponent = renderDynamicField(field);
                    return (
                      <div className="lg:col-span-1" key={field.resultField.id}>
                        {fieldComponent}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* --- Row 4: Save Button --- */}
            <div className="lg:col-span-12 flex justify-end">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                <Save className="h-4 w-4" />
                {tCommon("actions.save")}
              </Button>
            </div>
          </div>
        </div>
      </Form>

      {selectedAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={selectedAttachments}
          initialIndex={selectedAttachmentIndex}
          onClose={handleAttachmentClose}
          canEdit={false} // TODO: Add canEdit
        />
      )}
    </div>
  );
}

export default SessionResultForm;
