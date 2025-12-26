"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  useFindManySessionResults,
  useUpdateSessionResults,
  useFindManyStatus,
  useCreateAttachments,
  useUpdateAttachments,
  useFindManyTemplateResultAssignment,
  useCreateResultFieldValues,
  useUpdateResultFieldValues,
  useFindFirstProjects,
} from "~/lib/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateFormatter } from "@/components/DateFormatter";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { toHumanReadable } from "~/utils/duration";
import { useTranslations, useLocale } from "next-intl";
import { getBackgroundStyle, getTextStyle } from "~/utils/colorUtils";
import { emptyEditorContent } from "~/app/constants";
import {
  Clock,
  Copy,
  ChevronRight,
  FileText,
  Trash2,
  LinkIcon,
  Edit,
} from "lucide-react";
import { UserNameCell } from "./tables/UserNameCell";
import LoadingSpinner from "./LoadingSpinner";
import { AttachmentsDisplay, AttachmentChanges } from "./AttachmentsDisplay";
import { AttachmentsCarousel } from "./AttachmentsCarousel";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { z } from "zod/v4";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import parseDuration from "parse-duration";
import { MAX_DURATION } from "~/app/constants";
import UploadAttachments from "./UploadAttachments";
import type { Attachments, SessionResults, User } from "@prisma/client";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { usePathname, useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { IssuesListDisplay } from "./tables/IssuesListDisplay";
import { SimpleUnifiedIssueManager } from "./issues/UnifiedIssueManager";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";

// Define the ExtendedSessionResults interface to match the query structure
interface ExtendedSessionResults extends SessionResults {
  createdBy: User;
  session: {
    id: number;
    name: string;
    templateId: number | null;
  };
  status: {
    id: number;
    name: string;
    color: {
      id: number;
      value: string;
      hex?: string;
    };
  };
  attachments?: {
    id: number;
    name: string;
    url: string;
    mimeType: string;
    size: bigint;
    createdAt: Date;
    createdById: string;
    isDeleted: boolean;
    sessionId: number | null;
    testCaseId: number | null;
    sessionResultsId: number | null;
    note: string | null;
  }[];
  resultFieldValues?: {
    id: number;
    fieldId: number;
    value: string;
    field: {
      id: number;
      displayName: string;
      type: {
        type: string;
      };
      fieldOptions?: {
        fieldOption: {
          id: number;
          name: string;
          order: number;
        };
      }[];
    };
  }[];
  issues?: {
    id: number;
    name: string;
    externalId?: string | null;
    externalUrl?: string | null;
    externalKey?: string | null;
    title?: string | null;
    externalStatus?: string | null;
    data?: any;
    integrationId?: number | null;
    lastSyncedAt?: Date | null;
    integration?: {
      id: number;
      provider: string;
      name: string;
    } | null;
  }[];
}

interface SessionResultsListProps {
  sessionId: number;
  projectId: string | number;
  canEditResults: boolean;
  canDeleteResults: boolean;
  isCompleted: boolean;
}

// Define a form schema for editing session results
const createFormSchema = (
  locale: string,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  templateFields: any[] = []
) => {
  const statusFieldName = tCommon("fields.status"); // Pre-calculate field name
  // Create a base schema with required fields
  const baseSchema = {
    statusId: z.string().min(1, {
      message: tCommon("validation.required", {
        field: statusFieldName, // Use pre-calculated string
      }),
    }),
    resultData: z.any(),
    elapsed: z
      .string()
      .nullable()
      .prefault("")
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
  };

  // Add dynamic fields to the schema
  const schema: Record<string, any> = { ...baseSchema };

  // For each template field, add a validator
  templateFields.forEach((field) => {
    const fieldId = field.resultField?.id.toString();
    if (fieldId) {
      schema[fieldId] = z.any().optional();
    }
  });

  return z.object(schema);
};

type FormValues = z.infer<ReturnType<typeof createFormSchema>>;

// Define a more flexible interface for form values that can include dynamic fields
interface FieldFormValues extends FormValues {
  [key: string]: any; // Allow any string key for dynamic fields
}

export function SessionResultsList({
  sessionId,
  projectId,
  canEditResults,
  canDeleteResults,
  isCompleted,
}: SessionResultsListProps) {
  const { data: session } = useSession();
  const t = useTranslations("sessions.results");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const currentLocale = params.locale as string;
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resultToDelete, setResultToDelete] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [resultToEdit, setResultToEdit] =
    useState<ExtendedSessionResults | null>(null);
  const [editSelectedIssues, setEditSelectedIssues] = useState<number[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pendingAttachmentChanges, setPendingAttachmentChanges] =
    useState<AttachmentChanges>({ edits: [], deletes: [] });
  const [uploadAttachmentsKey, setUploadAttachmentsKey] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refreshResults, setRefreshResults] = useState(0);
  const [copyingLinkId, setCopyingLinkId] = useState<number | null>(null);

  // Add a state to track dynamic field values
  const [dynamicFieldValues, setDynamicFieldValues] = useState<
    Record<string, any>
  >({});

  // Fetch permissions for restricted fields
  const {
    permissions: restrictedFieldPermissions,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(Number(projectId), "SessionsRestrictedFields");
  const canEditRestrictedFields =
    restrictedFieldPermissions?.canAddEdit ?? false;

  // Load statuses for the session result edit form
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

  // Fetch project data for issueConfigId
  const { data: projectData, isLoading: isLoadingProject } =
    useFindFirstProjects(
      {
        where: { id: Number(projectId) },
        select: {
          projectIntegrations: {
            where: { isActive: true },
            include: { integration: true },
          },
        },
      },
      {
        enabled: !isNaN(Number(projectId)),
      }
    );

  // Add this line to get the createAttachments hook
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: updateAttachments } = useUpdateAttachments();

  // Initialize the form with dynamic schema
  const form = useForm<FieldFormValues>({
    resolver: zodResolver(createFormSchema(locale, tCommon, [])),
    defaultValues: {
      statusId: "",
      resultData: emptyEditorContent,
      elapsed: "",
    },
  });

  const {
    data: sessionResults,
    isLoading,
    refetch,
  } = useFindManySessionResults({
    where: {
      sessionId: sessionId,
      isDeleted: false,
    },
    include: {
      session: {
        select: {
          id: true,
          name: true,
          templateId: true,
        },
      },
      createdBy: true,
      status: {
        include: {
          color: true,
        },
      },
      attachments: {
        where: {
          isDeleted: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      resultFieldValues: {
        include: {
          field: {
            include: {
              type: true,
              fieldOptions: {
                include: {
                  fieldOption: true,
                },
                orderBy: {
                  fieldOption: {
                    order: "asc",
                  },
                },
              },
            },
          },
        },
      },
      issues: {
        select: {
          id: true,
          name: true,
          externalId: true,
          externalUrl: true,
          externalKey: true,
          title: true,
          externalStatus: true,
          data: true,
          integrationId: true,
          lastSyncedAt: true,
          issueTypeName: true,
          issueTypeIconUrl: true,
          integration: {
            select: {
              id: true,
              provider: true,
              name: true,
            },
          },
        },
        where: { isDeleted: false },
        orderBy: { name: "asc" },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const { mutateAsync: updateSessionResult } = useUpdateSessionResults();

  // Add hooks for field values operations
  const { mutateAsync: createResultFieldValue } = useCreateResultFieldValues();
  const { mutateAsync: updateResultFieldValue } = useUpdateResultFieldValues();

  // Fetch template fields when the session result is being edited
  const [editTemplateFields, setEditTemplateFields] = useState<any[]>([]);

  // Add template field fetching when opening edit dialog
  const { data: templateResultFields, isLoading: isLoadingTemplateFields } =
    useFindManyTemplateResultAssignment({
      where: {
        templateId:
          sessionResults && sessionResults.length > 0
            ? sessionResults[0].session?.templateId
            : 0,
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

  // Update useEffect to set template fields when data is loaded and update form schema
  useEffect(() => {
    if (templateResultFields) {
      setEditTemplateFields(templateResultFields);

      // Update the form schema with the template fields
      form.clearErrors();

      // Update form defaults to include the template fields
      const defaultsWithFields: Record<string, any> = {
        ...form.formState.defaultValues,
      };

      // Add each template field to the defaults
      templateResultFields.forEach((field) => {
        const fieldId = field.resultField?.id.toString();
        if (fieldId) {
          defaultsWithFields[fieldId] = null;
          // Register field with the form
          try {
            form.register(fieldId);
          } catch (err) {
            // Error registering field
          }
        }
      });

      // Set the resolver with updated schema that includes the template fields
      const updatedResolver = zodResolver(
        createFormSchema(locale, tCommon, templateResultFields)
      );

      // Force revalidation with updated resolver
      form.trigger();
    }
  }, [templateResultFields, form, locale, tCommon]);

  const handleAttachmentSelect = useCallback(
    (attachments: Attachments[], index: number) => {
      setSelectedAttachments(attachments);
      setSelectedAttachmentIndex(index);
    },
    []
  );

  // Track if user has actively selected files to prevent remount from resetting
  const userHasSelectedFilesRef = React.useRef(false);

  const handleFileSelect = useCallback((files: File[]) => {
    // If we receive files, mark that user has selected files
    if (files.length > 0) {
      userHasSelectedFilesRef.current = true;
    }

    // Prevent empty array from resetting files if user previously selected files
    // This handles the case where UploadAttachments remounts and tries to reset state
    if (files.length === 0 && userHasSelectedFilesRef.current) {
      return;
    }

    setSelectedFiles(files);
  }, []);

  // Reset the ref when dialog closes to allow empty array on next open
  useEffect(() => {
    if (!editDialogOpen) {
      userHasSelectedFilesRef.current = false;
    }
  }, [editDialogOpen]);

  const handleCarouselClose = useCallback(() => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  }, []);

  // Delete functionality
  const handleDeleteClick = useCallback((resultId: number) => {
    setResultToDelete(resultId);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!resultToDelete) return;

    try {
      await updateSessionResult({
        where: {
          id: resultToDelete,
        },
        data: {
          isDeleted: true,
        },
      });

      // Refetch the results to update the list
      await refetch();

      toast.success(t("deleteSuccess"));
    } catch (error) {
      console.error("Error deleting session result:", error);
      toast.error(t("deleteError"));
    } finally {
      setDeleteDialogOpen(false);
      setResultToDelete(null);
    }
  }, [resultToDelete, updateSessionResult, refetch, t]);

  const handleCancelDelete = useCallback(() => {
    setDeleteDialogOpen(false);
    setResultToDelete(null);
  }, []);

  // Edit functionality
  const handleEditClick = useCallback(
    (result: ExtendedSessionResults) => {
      // Set the result with its attachments to edit
      setResultToEdit(result);

      // Prepare the resultData content, checking for our new format with editorContent
      let editorContent;
      if (typeof result.resultData === "string") {
        try {
          const parsed = JSON.parse(result.resultData);
          // Use editorContent if it exists, otherwise use the whole resultData
          editorContent = parsed.editorContent || parsed;
        } catch (e) {
          editorContent = emptyEditorContent;
        }
      } else if (result.resultData && typeof result.resultData === "object") {
        // Use editorContent if it exists, otherwise use the whole resultData
        // Use type assertion to tell TypeScript this is a custom object type
        const resultDataObj = result.resultData as { editorContent?: any };
        editorContent = resultDataObj.editorContent || result.resultData;
      } else {
        editorContent = emptyEditorContent;
      }

      // Create form values object with the base fields
      const formValues: Record<string, any> = {
        statusId: result.statusId.toString(),
        resultData: editorContent,
        elapsed: result.elapsed
          ? toHumanReadable(result.elapsed, {
              isSeconds: true,
              locale,
            })
          : "",
      };

      // Also initialize our dynamic field values tracker
      const initialDynamicValues: Record<string, any> = {};

      // Process dynamic field values if they exist
      if (result.resultFieldValues && result.resultFieldValues.length > 0) {
        result.resultFieldValues.forEach((fieldValue) => {
          const fieldId = fieldValue.fieldId.toString();
          try {
            if (isJsonString(fieldValue.value)) {
              const parsedValue = JSON.parse(fieldValue.value);
              formValues[fieldId] = parsedValue;
              initialDynamicValues[fieldId] = parsedValue;
            } else {
              formValues[fieldId] = fieldValue.value;
              initialDynamicValues[fieldId] = fieldValue.value;
            }
          } catch (e) {
            formValues[fieldId] = fieldValue.value;
            initialDynamicValues[fieldId] = fieldValue.value;
          }
        });
      }

      // Set our dynamic field values
      setDynamicFieldValues(initialDynamicValues);

      // Register dynamic fields with the form - this ensures they are part of the form state
      if (result.resultFieldValues && result.resultFieldValues.length > 0) {
        result.resultFieldValues.forEach((fieldValue) => {
          const fieldId = fieldValue.fieldId.toString();
          form.register(fieldId);
        });
      }

      // Reset the form with all values
      form.reset(formValues);

      // Explicitly set each field value to ensure it's registered
      Object.keys(formValues).forEach((key) => {
        if (key !== "statusId" && key !== "resultData" && key !== "elapsed") {
          form.setValue(key, formValues[key], {
            shouldValidate: true,
            shouldDirty: true,
            shouldTouch: true,
          });
        }
      });

      // Clear any previously selected files
      setSelectedFiles([]);

      // Reset keys to force re-render of components
      setEditorKey((prev) => prev + 1);
      setUploadAttachmentsKey((prev) => prev + 1);

      // Initialize selected issues for the edit dialog
      setEditSelectedIssues(result.issues?.map((issue) => issue.id) || []);

      setEditDialogOpen(true);
    },
    [form, locale, setDynamicFieldValues]
  );

  const handleCancelEdit = useCallback(() => {
    setEditDialogOpen(false);
    setResultToEdit(null);
    setSelectedFiles([]);
    setPendingAttachmentChanges({ edits: [], deletes: [] });
    userHasSelectedFilesRef.current = false; // Reset ref when dialog closes
  }, []);

  const handleSaveEdit = useCallback(
    async (values: FieldFormValues) => {
      console.log('=== handleSaveEdit CALLED ===');
      console.log('selectedFiles:', selectedFiles);
      console.log('selectedFiles.length:', selectedFiles.length);
      if (!resultToEdit || !session?.user?.id) return;

      setIsSubmitting(true);

      try {
        // Use the values passed to the function directly
        // Explicitly log all field values for debugging
        if (editTemplateFields) {
          editTemplateFields.forEach((templateField) => {
            const fieldId = templateField.resultField.id.toString();
            const valueFromForm = values[fieldId];
            const valueFromState = dynamicFieldValues[fieldId];

            // If the value is in the state but not in the form values, use it
            if (valueFromForm === undefined && valueFromState !== undefined) {
              values[fieldId] = valueFromState;
            }
          });
        }

        // Convert elapsed time to seconds if provided
        let elapsedInSeconds: number | null = null;
        if (values.elapsed) {
          const durationInMilliseconds = parseDuration(values.elapsed);
          if (durationInMilliseconds !== null) {
            elapsedInSeconds = Math.round(durationInMilliseconds / 1000);
          }
        }

        // Create an updated resultData object that preserves any existing data
        // but makes sure the editor content is properly saved
        const updatedResultData = {
          editorContent: values.resultData, // Store the editor content separately
          statusId: values.statusId,
          elapsed: elapsedInSeconds,
        };

        // First update the session result with the combined data
        await updateSessionResult({
          where: {
            id: resultToEdit.id,
          },
          data: {
            statusId: parseInt(values.statusId),
            resultData: updatedResultData,
            elapsed: elapsedInSeconds,
            // Set the issues relation
            issues: {
              set: editSelectedIssues.map((id) => ({ id })),
            },
          },
        });

        // Handle field values
        if (editTemplateFields && editTemplateFields.length > 0) {
          // Create a map of existing field values for quick lookup
          const existingFieldValues = new Map(
            resultToEdit.resultFieldValues?.map((fv) => [
              fv.fieldId.toString(),
              fv,
            ]) || []
          );

          // Process each template field
          const fieldPromises = editTemplateFields.map(
            async (templateField) => {
              const fieldId = templateField.resultField.id.toString();

              // Get the field value - try form values first, then dynamic state
              let fieldValue = values[fieldId];

              // If no value in form, check our dynamic state
              if (fieldValue === undefined) {
                fieldValue = dynamicFieldValues[fieldId];
              }

              // Skip if no value
              if (fieldValue === undefined || fieldValue === null) {
                return Promise.resolve();
              }

              // Check if the field is restricted and user lacks permission
              const isFieldRestricted = templateField.resultField.isRestricted;
              if (isFieldRestricted && !canEditRestrictedFields) {
                // If restricted and no permission, skip saving this field

                return Promise.resolve();
              }

              const stringValue =
                typeof fieldValue === "object"
                  ? JSON.stringify(fieldValue)
                  : String(fieldValue);

              // If we have an existing field value, update it
              if (existingFieldValues.has(fieldId)) {
                const existingField = existingFieldValues.get(fieldId);
                return updateResultFieldValue({
                  where: { id: existingField!.id },
                  data: { value: stringValue },
                });
              }
              // Otherwise create a new field value
              else {
                return createResultFieldValue({
                  data: {
                    fieldId: parseInt(fieldId),
                    value: stringValue,
                    sessionResultsId: resultToEdit.id,
                  },
                });
              }
            }
          );

          await Promise.all(fieldPromises);
        }

        // Then handle file uploads if any
        console.log('[DEBUG] selectedFiles at upload time:', selectedFiles.length, selectedFiles.map(f => f.name));
        if (selectedFiles.length > 0) {
          const prependString = session.user.id;
          const sanitizedFolder =
            typeof projectId === "string" ? projectId : projectId.toString();

          // Deduplicate files by name+size+lastModified before uploading
          const uniqueFiles = selectedFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)
          );
          console.log('[DEBUG] uniqueFiles after deduplication:', uniqueFiles.length, uniqueFiles.map(f => f.name));

          const uploadAttachmentsPromises = uniqueFiles.map(async (file) => {
            try {
              const fileUrl = await fetchSignedUrl(
                file,
                `/api/get-attachment-url/`,
                `${sanitizedFolder}/${prependString}`
              );

              // Create the attachment in the database linked to the session result
              const attachment = await createAttachments({
                data: {
                  sessionResults: {
                    connect: { id: resultToEdit.id },
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

              return attachment;
            } catch (error) {
              console.error("Error uploading file:", error);
              throw error;
            }
          });

          await Promise.all(uploadAttachmentsPromises);
        }

        // Apply pending attachment changes (edits and deletes)
        if (pendingAttachmentChanges.edits.length > 0 || pendingAttachmentChanges.deletes.length > 0) {
          // Apply edits
          const editPromises = pendingAttachmentChanges.edits.map((edit) =>
            updateAttachments({
              where: { id: edit.id },
              data: {
                ...(edit.name !== undefined && { name: edit.name }),
                ...(edit.note !== undefined && { note: edit.note }),
              },
            })
          );

          // Apply deletes (soft delete)
          const deletePromises = pendingAttachmentChanges.deletes.map((id) =>
            updateAttachments({
              where: { id },
              data: { isDeleted: true },
            })
          );

          await Promise.all([...editPromises, ...deletePromises]);

          // Reset pending changes
          setPendingAttachmentChanges({ edits: [], deletes: [] });
        }

        // Refetch to update the list with the latest data
        await refetch();

        // Force refresh the UI
        setRefreshResults((prev) => prev + 1);

        // Force re-render the TipTapEditor
        setEditorKey((prev) => prev + 1);

        toast.success(t("updateSuccess"));

        // Close the dialog
        setEditDialogOpen(false);
        setResultToEdit(null);
        setSelectedFiles([]);
        userHasSelectedFilesRef.current = false; // Reset ref after successful save
      } catch (error) {
        // Error updating session result
        toast.error(t("updateError"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      resultToEdit,
      session,
      updateSessionResult,
      editTemplateFields,
      selectedFiles,
      refetch,
      t,
      updateResultFieldValue,
      createResultFieldValue,
      projectId,
      createAttachments,
      updateAttachments,
      dynamicFieldValues,
      editSelectedIssues,
      canEditRestrictedFields,
      pendingAttachmentChanges,
    ]
  );

  // Add a useEffect to re-render the list when needed
  useEffect(() => {
    // This effect runs when refreshResults changes
    if (refreshResults > 0) {
      // If we've had at least one refresh, refetch the data
      refetch();
    }
  }, [refreshResults, refetch]);

  // Use an effect to handle hash scrolling that works with Next.js
  useEffect(() => {
    // Function to scroll to result based on hash
    const scrollToResult = () => {
      // Remove any existing highlights
      document.querySelectorAll(".result-highlight").forEach((el) => {
        el.classList.remove(
          "result-highlight",
          "ring-2",
          "ring-primary",
          "ring-opacity-70"
        );
      });

      // Check if there's a hash in the URL
      if (typeof window !== "undefined") {
        const hash = window.location.hash;
        if (hash && hash.startsWith("#result-")) {
          const resultId = hash.replace("#result-", "");
          const resultElement = document.getElementById(`result-${resultId}`);

          if (resultElement) {
            // Add highlight and scroll into view
            resultElement.classList.add(
              "result-highlight",
              "ring-2",
              "ring-primary",
              "ring-opacity-70"
            );

            // Smooth scroll to the element
            setTimeout(() => {
              resultElement.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });

              // Remove highlight after 3 seconds
              setTimeout(() => {
                resultElement.classList.remove(
                  "ring-2",
                  "ring-primary",
                  "ring-opacity-70"
                );
              }, 3000);
            }, 100);
          }
        }
      }
    };

    // Run on initial load and when results are loaded
    if (!isLoading && sessionResults?.length && sessionResults.length > 0) {
      scrollToResult();
    }

    // Add event listener for hash changes (for browser back/forward navigation)
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", scrollToResult);

      // Clean up
      return () => {
        window.removeEventListener("hashchange", scrollToResult);
      };
    }
  }, [isLoading, sessionResults, pathname]);

  // Function to copy result link to clipboard
  const handleCopyLink = useCallback(
    (resultId: number) => {
      if (typeof window !== "undefined") {
        // Get the origin
        const origin = window.location.origin;

        // Construct URL with explicit locale path
        const path = `/${currentLocale}/projects/sessions/${projectId}/${sessionId}#result-${resultId}`;

        // Full URL with origin and path
        const completeUrl = `${origin}${path}`;

        // Copy to clipboard
        navigator.clipboard
          .writeText(completeUrl)
          .then(() => {
            // Show success state
            setCopyingLinkId(resultId);
            toast.success(t("linkCopied"));

            // Reset the button after 2 seconds
            setTimeout(() => {
              setCopyingLinkId(null);
            }, 2000);
          })
          .catch((err) => {
            console.error("Failed to copy link: ", err);
            toast.error(t("copyFailed"));
          });
      }
    },
    [currentLocale, projectId, sessionId, t]
  );

  // Helper function to check if content is empty
  const isEmptyContent = (content: any): boolean => {
    if (!content) return true;

    try {
      const parsedContent =
        typeof content === "string" ? JSON.parse(content) : content;
      return (
        JSON.stringify(parsedContent) === JSON.stringify(emptyEditorContent)
      );
    } catch (error) {
      // Error parsing content
      return false;
    }
  };

  // Add helper to render field editors based on field type
  const renderDynamicFieldEditor = (field: any, formField: any) => {
    const fieldType = field.type?.type;
    const displayName = field.displayName;
    const isRequired = field.isRequired;
    const fieldOptions =
      field.fieldOptions?.map((option: any) => option.fieldOption) || [];

    // Ensure formField.value is never undefined to avoid React controlled/uncontrolled warnings
    const safeValue = formField.value === undefined ? "" : formField.value;

    // Get the field ID as a string
    const fieldId = field.id.toString();

    // Check if the field is restricted and user lacks permission
    const isFieldDisabled = field.isRestricted && !canEditRestrictedFields;

    // Helper function to update both form and dynamic state
    const updateFieldValue = (value: any) => {
      formField.onChange(value);
      // Force immediate form update
      form.setValue(fieldId, value, {
        shouldValidate: true,
        shouldDirty: true,
        shouldTouch: true,
      });

      // Also update our dynamic state tracker
      setDynamicFieldValues((prev) => ({
        ...prev,
        [fieldId]: value,
      }));
    };

    switch (fieldType) {
      case "Text String":
      case "Text":
        return (
          <FormItem>
            <FormLabel className="flex items-center gap-1">
              {displayName}
              {isRequired && <span className="text-destructive">{"*"}</span>}
            </FormLabel>
            <FormControl>
              <Input
                {...formField}
                value={safeValue}
                onChange={(e) => {
                  updateFieldValue(e.target.value);
                }}
                disabled={isFieldDisabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      case "Number":
        return (
          <FormItem>
            <FormLabel className="flex items-center gap-1">
              {displayName}
              {isRequired && <span className="text-destructive">{"*"}</span>}
            </FormLabel>
            <FormControl>
              <Input
                {...formField}
                type="number"
                value={safeValue}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null;
                  updateFieldValue(val);
                }}
                disabled={isFieldDisabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      case "Dropdown":
        return (
          <FormItem>
            <FormLabel className="flex items-center gap-1">
              {displayName}
              {isRequired && <span className="text-destructive">{"*"}</span>}
            </FormLabel>
            <FormControl>
              <Select
                onValueChange={(value) => {
                  updateFieldValue(value);
                }}
                value={safeValue}
                disabled={isFieldDisabled}
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
        );
      case "RichText":
      case "Text Long": {
        const fieldId = field.resultField.id.toString();
        const displayName = field.resultField.displayName;
        const hint = field.resultField.hint;
        const isRequired = field.resultField.isRequired;
        // Get initialHeight
        const initialHeight = field.resultField.initialHeight;
        const editorClassName = `min-h-[100px] border rounded-md w-full ${
          initialHeight ? `min-h-[${initialHeight}px]` : ""
        }`;

        return (
          <FormField
            key={fieldId}
            control={form.control}
            name={fieldId}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-1">
                  {displayName}
                  {isRequired && (
                    <span className="text-destructive">{"*"}</span>
                  )}
                </FormLabel>
                <FormControl>
                  <TipTapEditor
                    content={field.value || emptyEditorContent}
                    onUpdate={updateFieldValue}
                    projectId={projectId.toString()}
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
      default:
        return (
          <FormItem>
            <FormLabel className="flex items-center gap-1">
              {`${displayName} (${fieldType})`}
              {isRequired && <span className="text-destructive">{"*"}</span>}
            </FormLabel>
            <FormControl>
              <Input
                {...formField}
                value={safeValue}
                onChange={(e) => {
                  updateFieldValue(e.target.value);
                }}
                disabled={isFieldDisabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
    }
  };

  // Improve the formatFieldValue function to handle different types
  const formatFieldValue = (fieldValue: string, fieldType: string) => {
    if (!fieldValue) return "";

    // If fieldValue is an object (shouldn't happen but handle it), stringify it
    if (typeof fieldValue === "object") {
      return JSON.stringify(fieldValue);
    }
    try {
      if (fieldType === "Text Long") {
        // For Text Long, parse the value and render it in a read-only TipTapEditor
        let content;
        try {
          const parsed = JSON.parse(fieldValue);
          // Validate that it's a proper TipTap document structure
          if (parsed && typeof parsed === "object" && parsed.type === "doc") {
            content = parsed;
          } else {
            // If it's not a valid TipTap document, use empty content
            content = emptyEditorContent;
          }
        } catch (e) {
          // If it's not JSON or parsing fails, use emptyEditorContent
          content = emptyEditorContent;
        }

        return (
          <div className="border rounded-md">
            <TipTapEditor
              content={content}
              readOnly={true}
              projectId={"0"} // This is read-only, so projectId doesn't matter
              className="min-h-[50px] max-h-[200px] overflow-y-auto"
            />
          </div>
        );
      } else if (fieldType === "RichText") {
        // For rich text, just show a placeholder
        return (
          <span className="italic text-muted-foreground">
            {tCommon("ui.issues.richTextContent")}
          </span>
        );
      } else if (isJsonString(fieldValue)) {
        // For other JSON values, try to display them nicely
        const parsed = JSON.parse(fieldValue);
        if (typeof parsed === "object") {
          return JSON.stringify(parsed);
        }
        return String(parsed);
      }

      // Return the value as is for other types
      return fieldValue;
    } catch (e) {
      // If any error occurs during parsing/rendering
      return (
        <span className="italic text-muted-foreground">
          {tCommon("ui.issues.invalidContent")}
        </span>
      );
    }
  };

  // Helper function to check if a string is valid JSON
  function isJsonString(str: string) {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  // In the displayResult function, update references to result.resultData to properly validate
  // Update any reference to status.color.value or status.color.hex to handle both possible properties
  const getColorValue = (color: { value?: string; hex?: string }) => {
    return color.value || color.hex || "#808080"; // Default color if neither is available
  };

  // Update the getResultData helper to retrieve the correct editor content with proper type handling
  const getResultData = (result: ExtendedSessionResults): any => {
    if (!result) return {};

    try {
      // If resultData is an object
      if (typeof result.resultData === "object" && result.resultData !== null) {
        // Use a properly typed temporary variable to check for editorContent
        // This avoids TypeScript complaints about accessing properties
        const typedResultData = result.resultData as Record<string, any>;

        // Now we can safely check for editorContent
        if (typedResultData.editorContent) {
          return typedResultData.editorContent;
        }

        return result.resultData;
      }

      // If it's a string, try to parse it
      if (typeof result.resultData === "string") {
        const parsed = JSON.parse(result.resultData);

        // Check if it has an editorContent property (our new format)
        if (parsed && typeof parsed === "object" && "editorContent" in parsed) {
          return parsed.editorContent;
        }

        return parsed;
      }
    } catch (e) {
      // Error parsing resultData
      console.error("Error parsing resultData", e);
    }

    return {};
  };

  if (
    isLoading ||
    isLoadingStatuses ||
    isLoadingTemplateFields ||
    isLoadingProject ||
    isLoadingPermissions
  ) {
    return <LoadingSpinner />;
  }

  if (!sessionResults || sessionResults.length === 0) {
    return (
      <Card className="mb-4">
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">{t("noResults")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {(sessionResults as unknown as ExtendedSessionResults[]).map(
        (result, index) => (
          <Card
            key={`result-${result.id}-${refreshResults}`}
            id={`result-${result.id}`}
            className="transition-all duration-300"
          >
            <CardHeader className="p-0">
              <div
                className="flex justify-between items-center p-2 rounded-t-md text-background"
                style={{
                  backgroundColor: getColorValue(result.status.color),
                  color: "#fff",
                }}
              >
                <div className="flex items-center gap-2">
                  {/* Copy Link Button - Moved to left side */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 p-1 text-background hover:text-primary hover:bg-background/10"
                    onClick={() => handleCopyLink(result.id)}
                    title={tCommon("actions.copyLink")}
                  >
                    {copyingLinkId === result.id ? (
                      <Copy className="h-4 w-4" />
                    ) : (
                      <LinkIcon className="h-4 w-4" />
                    )}
                  </Button>

                  <div className="w-[100px] bg-transparent text-lg font-extrabold py-0 overflow-hidden">
                    <span className="truncate">{result.status.name}</span>
                  </div>
                  <span className="text-sm flex items-center gap-1">
                    <UserNameCell userId={result.createdBy.id} />
                  </span>
                  {result.elapsed && (
                    <div className="text-sm text-muted flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {toHumanReadable(result.elapsed, {
                        isSeconds: true,
                        locale,
                      })}
                    </div>
                  )}
                  {result.attachments && result.attachments.length > 0 && (
                    <div className="text-sm text-muted flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      {result.attachments.length}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-md pr-2">
                    <DateFormatter
                      date={result.createdAt}
                      formatString={
                        session?.user.preferences?.dateFormat +
                        " " +
                        session?.user.preferences?.timeFormat
                      }
                      timezone={session?.user.preferences?.timezone}
                    />
                  </div>
                  <span className="flex items-center space-x-1">
                    {/* Edit Button - Conditionally render based on canEditResults AND !isCompleted */}
                    {!isCompleted && canEditResults && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-background hover:text-primary hover:bg-background/10"
                        onClick={() => handleEditClick(result)}
                        title={tCommon("actions.edit")}
                        disabled={
                          !(
                            session?.user.access === "ADMIN" ||
                            session?.user.id === result.createdById
                          )
                        }
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {/* Delete Button - Conditionally render based on canDeleteResults AND !isCompleted */}
                    {!isCompleted && canDeleteResults && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-background hover:text-destructive hover:bg-background/10"
                        onClick={() => handleDeleteClick(result.id)}
                        title={tCommon("actions.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div
                className="rounded-b-md"
                style={getBackgroundStyle(getColorValue(result.status.color))}
              >
                {getResultData(result) &&
                !isEmptyContent(getResultData(result)) ? (
                  <TipTapEditor
                    key={`display-${result.id}-${refreshResults}`}
                    content={getResultData(result)}
                    readOnly
                    projectId={projectId.toString()}
                    className="p-4 rounded-md"
                  />
                ) : (
                  <div className="p-4 text-muted-foreground italic">
                    {t("noNotes")}
                  </div>
                )}

                {/* Display dynamic field values if they exist */}
                {result.resultFieldValues &&
                  result.resultFieldValues.length > 0 && (
                    <div className="p-4 border-t">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {editTemplateFields?.map((templateField) => {
                          // Find the corresponding field value
                          const fieldValue = result.resultFieldValues?.find(
                            (fv) => fv.fieldId === templateField.resultField.id
                          );

                          if (!fieldValue) return null;

                          return (
                            <div key={fieldValue.id} className="flex flex-col">
                              <span className="text-xs font-medium text-muted-foreground">
                                {fieldValue.field.displayName}
                              </span>
                              <span className="text-sm">
                                {formatFieldValue(
                                  fieldValue.value,
                                  fieldValue.field.type.type
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {result.attachments && result.attachments.length > 0 && (
                  <Collapsible className="w-full">
                    <Separator />
                    <div>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex items-center gap-1 group"
                        >
                          <FileText className="h-4 w-4" />
                          {tCommon("upload.attachments.count", {
                            count: result.attachments.length,
                          })}
                          <ChevronRight className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-90" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 p-4">
                        <AttachmentsDisplay
                          key={`result-attachments-${result.id}-${refreshResults}`}
                          attachments={result.attachments as Attachments[]}
                          onSelect={handleAttachmentSelect}
                          preventEditing={true}
                        />
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                )}

                {/* Display Issues */}
                {result.issues && result.issues.length > 0 && (
                  <div className="p-4 border-t">
                    <IssuesListDisplay
                      issues={
                        result.issues?.map((issue) => ({
                          ...issue,
                          projectIds: [Number(projectId)], // Add projectId
                        })) || []
                      }
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )
      )}

      {selectedAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={selectedAttachments}
          initialIndex={selectedAttachmentIndex}
          onClose={handleCarouselClose}
          canEdit={false} // TODO: Add canEdit
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDelete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            // When closing the dialog, refresh the results list
            setRefreshResults((prev) => prev + 1);
          }
          setEditDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t("edit")}</DialogTitle>
            <DialogDescription>{t("editDescription")}</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={(e) => {
                console.log('=== FORM onSubmit CALLED ===');
                e.preventDefault();
                const formData = form.getValues() as FieldFormValues;

                // Log each field for debugging
                if (editTemplateFields) {
                  editTemplateFields.forEach((field) => {
                    const fieldId = field.resultField.id.toString();

                    // Debug: check if field is registered in form
                    const isRegistered =
                      form.getFieldState(fieldId).isDirty !== undefined;
                  });
                }

                // Capture all fields that should be saved
                const fieldsToSave: Record<string, any> = { ...formData };

                // Add any dynamic fields from our state tracker
                Object.keys(dynamicFieldValues).forEach((fieldId) => {
                  if (dynamicFieldValues[fieldId] !== undefined) {
                    fieldsToSave[fieldId] = dynamicFieldValues[fieldId];
                  }
                });

                // Add any dynamic fields that might have been missed
                if (editTemplateFields && formData) {
                  editTemplateFields.forEach((field) => {
                    const fieldId = field.resultField.id.toString();
                    // If we're editing a field that has a value in the UI but not in formData
                    if (
                      fieldsToSave[fieldId] === undefined &&
                      resultToEdit?.resultFieldValues
                    ) {
                      // Try to find it in the original result
                      const existingValue = resultToEdit.resultFieldValues.find(
                        (fv) => fv.fieldId.toString() === fieldId
                      );
                      if (existingValue) {
                        fieldsToSave[fieldId] = existingValue.value;
                      }
                    }
                  });
                }

                // Call the save handler with the complete data
                handleSaveEdit(fieldsToSave);
              }}
              className="space-y-4"
            >
              {/* Status */}
              <FormField
                control={form.control}
                name="statusId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("fields.status")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={tCommon("placeholders.selectStatus")}
                          />
                        </SelectTrigger>
                      </FormControl>
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
                                  backgroundColor: getColorValue(status.color),
                                }}
                              ></div>
                              {status.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Notes */}
              <FormField
                control={form.control}
                name="resultData"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("details")}</FormLabel>
                    <FormControl>
                      <TipTapEditor
                        key={`editor-${editorKey}`}
                        content={field.value || emptyEditorContent}
                        onUpdate={(content) => {
                          field.onChange(content);
                        }}
                        projectId={projectId.toString()}
                        className="min-h-[100px] border rounded-md w-full"
                        placeholder={t("details")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Elapsed Time */}
              <FormField
                control={form.control}
                name="elapsed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("fields.elapsed")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={tCommon("placeholders.elapsed")}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Dynamic fields if they exist */}
              {editTemplateFields && editTemplateFields.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">
                    {tCommon("ui.issues.fieldInformation")}
                  </h3>
                  <div className="space-y-4">
                    {editTemplateFields.map((templateField) => {
                      const fieldId = templateField.resultField.id.toString();
                      return (
                        <FormField
                          key={fieldId}
                          control={form.control}
                          name={fieldId}
                          render={({ field }) =>
                            renderDynamicFieldEditor(
                              templateField.resultField,
                              field
                            )
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Issues Management */}
              {projectData?.projectIntegrations?.[0] && (
                <FormItem>
                  <FormLabel>{tCommon("fields.issues")}</FormLabel>
                  <FormControl>
                    <SimpleUnifiedIssueManager
                      projectData={projectData}
                      projectId={Number(projectId)}
                      linkedIssueIds={editSelectedIssues}
                      setLinkedIssueIds={setEditSelectedIssues}
                      entityType="sessionResult"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}

              {/* Attachments */}
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
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

                    {/* Display existing attachments */}
                    {resultToEdit?.attachments &&
                      resultToEdit.attachments.length > 0 && (
                        <div className="mt-4">
                          <div className="text-sm font-medium mb-2">
                            {tCommon("fields.attachments")}:
                          </div>
                          <div className="max-w-[550px]">
                            <AttachmentsDisplay
                              key={`attachments-display-${refreshResults}-${uploadAttachmentsKey}`}
                              attachments={
                                resultToEdit.attachments as Attachments[]
                              }
                              onSelect={handleAttachmentSelect}
                              preventEditing={false}
                              deferredMode={true}
                              onPendingChanges={setPendingAttachmentChanges}
                            />
                          </div>
                        </div>
                      )}
                  </div>
                </FormControl>
              </FormItem>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancelEdit}
                >
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? tCommon("actions.saving")
                    : tCommon("actions.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SessionResultsList;
