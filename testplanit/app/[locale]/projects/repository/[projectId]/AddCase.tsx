import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFindFirstRepositoryFolders,
  useFindFirstRepositoryCases,
  useFindManyTemplates,
  useFindManyWorkflows,
  useCreateRepositoryCases,
  useCreateCaseFieldValues,
  useCreateCaseFieldVersionValues,
  useCreateAttachments,
  useCreateSteps,
  useFindManyTags,
  useFindManyIssue,
  useFindManySharedStepGroup,
} from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, CirclePlus, Asterisk } from "lucide-react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import RenderField from "./RenderField";
import parseDuration from "parse-duration";
import UploadAttachments from "@/components/UploadAttachments";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ManageTags } from "@/components/ManageTags";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { emptyEditorContent } from "~/app/constants";
import { Textarea } from "@/components/ui/textarea";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import { useTranslations } from "next-intl";
import { MAX_DURATION } from "~/app/constants";
import { ApplicationArea, Prisma } from "@prisma/client";
import { HelpPopover } from "@/components/ui/help-popover";

interface SharedStepItemDetail {
  step: Prisma.JsonValue;
  expectedResult?: Prisma.JsonValue;
  order: number;
}

interface SharedStepGroupWithItems {
  id: number;
  name: string;
  projectId: number;
  isDeleted: boolean;
  items: SharedStepItemDetail[];
}

const mapFieldToZodType = (field: any) => {
  const isRequired = field.caseField.isRequired;

  const addMinMax = (schema: z.ZodNumber) => {
    if (field.caseField.minValue !== undefined) {
      schema = schema.min(field.caseField.minValue);
    }
    if (field.caseField.maxValue !== undefined) {
      schema = schema.max(field.caseField.maxValue);
    }
    return schema;
  };

  switch (field.caseField.type.type) {
    case "Checkbox":
      return isRequired
        ? z.boolean().prefault(field.caseField.isChecked)
        : z.boolean().prefault(field.caseField.isChecked).optional();
    case "Date":
      // Use z.any() to skip Zod validation - we'll handle nulls via resolver transformation
      return z.any();
    case "Multi-Select":
      return isRequired ? z.number().array() : z.number().array().optional();
    case "Dropdown":
      return isRequired ? z.number() : z.number().optional();
    case "Integer":
      let integerBaseSchema = z.union([
        z.number().int(),
        z.string().transform((val) => (val === "" ? undefined : parseInt(val, 10))),
      ]);

      // Apply min/max constraints using refine
      if (field.caseField.minValue !== undefined && field.caseField.minValue !== null) {
        const minValue = field.caseField.minValue;
        integerBaseSchema = integerBaseSchema.refine(
          (val) => val === undefined || (typeof val === 'number' && val >= minValue),
          { message: `Value must be at least ${minValue}` }
        ) as any;
      }
      if (field.caseField.maxValue !== undefined && field.caseField.maxValue !== null) {
        const maxValue = field.caseField.maxValue;
        integerBaseSchema = integerBaseSchema.refine(
          (val) => val === undefined || (typeof val === 'number' && val <= maxValue),
          { message: `Value must be at most ${maxValue}` }
        ) as any;
      }

      return isRequired ? integerBaseSchema : integerBaseSchema.optional();

    case "Number":
      let numberBaseSchema = z.union([
        z.number(),
        z.string().transform((val) => (val === "" ? undefined : parseFloat(val))),
      ]);

      // Apply min/max constraints using refine
      if (field.caseField.minValue !== undefined && field.caseField.minValue !== null) {
        const minValue = field.caseField.minValue;
        numberBaseSchema = numberBaseSchema.refine(
          (val) => val === undefined || (typeof val === 'number' && val >= minValue),
          { message: `Value must be at least ${minValue}` }
        ) as any;
      }
      if (field.caseField.maxValue !== undefined && field.caseField.maxValue !== null) {
        const maxValue = field.caseField.maxValue;
        numberBaseSchema = numberBaseSchema.refine(
          (val) => val === undefined || (typeof val === 'number' && val <= maxValue),
          { message: `Value must be at most ${maxValue}` }
        ) as any;
      }

      return isRequired ? numberBaseSchema : numberBaseSchema.optional();
    case "Link":
      return isRequired
        ? z.string().url()
        : z.union([
            z.string().url(),
            z.literal(""),
          ]).optional();
    case "Text String":
      return isRequired ? z.string() : z.string().optional();
    case "Text Long":
      return isRequired
        ? z.string().refine(
            (val) => {
              try {
                const parsed = JSON.parse(val);
                return (
                  JSON.stringify(parsed) !== JSON.stringify(emptyEditorContent)
                );
              } catch {
                return false;
              }
            },
            {
              error: "This field is required",
            }
          )
        : z.string().optional();
    case "Steps":
      const stepObjectSchema = z.object({
        id: z.string().optional(),
        step: z.looseObject({}).optional(),
        expectedResult: z.looseObject({}).optional(),
        isShared: z.boolean().optional(),
        sharedStepGroupId: z.number().optional(),
        sharedStepGroupName: z.string().optional(),
      });
      return isRequired
        ? z.array(stepObjectSchema).min(1)
        : z.array(stepObjectSchema).optional();
    default:
      return z.string().optional();
  }
};

const createFormSchema = (fields: any[]) => {
  const baseSchema = {
    name: z.string().min(2, {
      error: "Please enter a name for the Test Case",
    }),
    templateId: z.number({
      error: (issue) =>
        issue.input === undefined ? "Please select a Template" : undefined,
    }),
    workflowId: z.number({
      error: (issue) =>
        issue.input === undefined ? "Please select a State" : undefined,
    }),
    estimate: z
      .string()
      .optional()
      .refine(
        (value) => {
          if (!value) return true;
          const durationInMilliseconds = parseDuration(value);
          return durationInMilliseconds !== null;
        },
        {
          error:
            "Invalid duration format. Try something like 30m, 1 week or 1h 25m",
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
          error: "Estimate is too large",
        }
      ),
    automated: z.boolean().prefault(false),
  };

  const dynamicSchema = fields.reduce(
    (schema, field) => {
      const fieldName = field.caseField.id.toString();
      // Skip Date fields entirely - we'll handle them manually without validation
      if (field.caseField.type.type !== "Date") {
        schema[fieldName] = mapFieldToZodType(field);
      }
      return schema;
    },
    {} as Record<string, z.ZodTypeAny>
  );

  return z.object({
    ...baseSchema,
    ...dynamicSchema,
  });
};

interface AddCaseModalProps {
  folderId: number;
}

interface FormValues {
  name: string;
  templateId: number;
  workflowId: number;
  estimate?: string;
  automated: boolean;
  [key: string]: any;
}

export function AddCaseModal({ folderId }: AddCaseModalProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [isTemplateReady, setIsTemplateReady] = useState(false);
  const panelRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);

  const [formSchema, setFormSchema] = useState(createFormSchema([]));
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null
  );
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [linkedIssueIds, setLinkedIssueIds] = useState<number[]>([]);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const {
    data: sharedStepGroupsData,
    isLoading: isLoadingSharedStepGroups,
  }: { data?: SharedStepGroupWithItems[]; isLoading?: boolean } =
    useFindManySharedStepGroup(
      {
        where: {
          project: { id: Number(projectId) },
          isDeleted: false,
        },
        include: {
          items: {
            select: { step: true, expectedResult: true, order: true },
            orderBy: { order: "asc" },
          },
        },
      },
      { enabled: !!projectId && open }
    );

  const { mutateAsync: createRepositoryCases } = useCreateRepositoryCases();
  const { mutateAsync: createCaseFieldValues } = useCreateCaseFieldValues();
  const { mutateAsync: createCaseFieldVersionValues } =
    useCreateCaseFieldVersionValues();
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: createSteps } = useCreateSteps();

  const { data: folder } = useFindFirstRepositoryFolders(
    {
      where: {
        id: folderId,
        isDeleted: false,
      },
      include: {
        repository: true,
        project: true,
      },
    },
    {
      enabled: !!folderId,
    }
  );

  const { data: maxOrder } = useFindFirstRepositoryCases(
    {
      where: {
        folderId: folderId,
      },
      orderBy: {
        order: "desc",
      },
      select: {
        order: true,
      },
    },
    {
      enabled: !!folderId,
    }
  );

  const { data: templates } = useFindManyTemplates(
    {
      where: {
        isDeleted: false,
        projects: {
          some: {
            projectId: Number(projectId),
          },
        },
      },
      include: {
        caseFields: {
          include: {
            caseField: {
              include: {
                fieldOptions: {
                  include: {
                    fieldOption: { include: { icon: true, iconColor: true } },
                  },
                },
                type: true,
              },
            },
          },
          orderBy: {
            order: "asc",
          },
        },
      },
      orderBy: {
        templateName: "asc",
      },
    },
    {
      enabled: !!folderId,
    }
  );

  const { data: workflows } = useFindManyWorkflows({
    where: {
      isDeleted: false,
      scope: "CASES",
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    include: {
      icon: true,
      color: true,
    },
  });

  const defaultWorkflowId = workflows?.find(
    (workflow) => workflow.isDefault
  )?.id;

  const defaultTemplateId = templates?.find(
    (template) => template.isDefault
  )?.id;

  const templateOptions =
    templates?.map((template) => ({
      value: template.id.toString(),
      label: template.templateName,
    })) || [];

  const workflowOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      label: (
        <div className="flex items-center">
          <DynamicIcon
            name={workflow.icon.name as IconName}
            color={workflow.color.value}
          />
          <div className="mx-1">{workflow.name}</div>
        </div>
      ),
    })) || [];
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    mode: 'onSubmit',
    defaultValues: {
      name: "",
      templateId: defaultTemplateId ?? 0,
      workflowId: defaultWorkflowId ?? 0,
      estimate: "",
      automated: false,
    },
  });

  const {
    handleSubmit,
    reset,
    control,
    formState: { errors },
    setValue,
    watch,
  } = form;

  const { data: tags } = useFindManyTags({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
  });

  const { data: allIssues } = useFindManyIssue({
    where: { isDeleted: false },
    select: { id: true, name: true, externalId: true },
  });

  // Fetch Tags permission
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.Tags);
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;

  // Fetch Restricted Fields permission (NEW)
  const {
    permissions: restrictedFieldsPermissions,
    isLoading: isLoadingRestrictedPermissions,
  } = useProjectPermissions(
    numericProjectId,
    ApplicationArea.TestCaseRestrictedFields
  );
  const canEditRestricted = restrictedFieldsPermissions?.canAddEdit ?? false;

  const isSuperAdmin = session?.user?.access === "ADMIN";
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;
  const canEditRestrictedPerm = canEditRestricted || isSuperAdmin; // NEW

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const handleCancel = () => {
    setSelectedFiles([]);
    setOpen(false);
  };

  const uploadFiles = async (caseId: number) => {
    const prependString = session!.user.id;
    const sanitizedFolder = folder?.repositoryId.toString() || "";

    const attachmentsPromises = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );

      const attachment = await createAttachments({
        data: {
          testCase: {
            connect: { id: caseId },
          },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: {
            connect: { id: session!.user.id },
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
        createdBy: session!.user.name,
      };
    });

    const attachments = await Promise.all(attachmentsPromises);
    return attachments;
  };

  useEffect(() => {
    if (defaultWorkflowId) {
      setValue("workflowId", defaultWorkflowId);
    }
    if (defaultTemplateId) {
      setValue("templateId", defaultTemplateId);
      setSelectedTemplateId(defaultTemplateId);
    }
  }, [defaultWorkflowId, defaultTemplateId, setValue]);

  useEffect(() => {
    const selectedTemplate = templates?.find(
      (template) => template.id === selectedTemplateId
    );
    if (selectedTemplate) {
      setFormSchema(createFormSchema(selectedTemplate.caseFields));
      const defaultValues: Partial<FormValues> = {
        name: "",
        templateId: selectedTemplateId ?? 0,
        workflowId: defaultWorkflowId ?? 0,
        estimate: "",
        automated: false,
      };
      selectedTemplate.caseFields.forEach((caseField: any) => {
        const fieldIdStr = caseField.caseField.id.toString();
        const fieldType = caseField.caseField.type.type;

        // Initialize all field types with appropriate defaults
        switch (fieldType) {
          case "Dropdown":
            if (caseField.caseField.fieldOptions) {
              const defaultOption = caseField.caseField.fieldOptions.find(
                (option: any) => option.fieldOption.isDefault
              );
              if (defaultOption) {
                defaultValues[fieldIdStr] = defaultOption.fieldOption.id;
              }
            }
            break;
          case "Multi-Select":
            defaultValues[fieldIdStr] = [];
            break;
          case "Steps":
            defaultValues[fieldIdStr] = [];
            break;
          case "Integer":
          case "Number":
            defaultValues[fieldIdStr] = "";
            break;
          case "Date":
            defaultValues[fieldIdStr] = undefined;
            break;
          case "Checkbox":
            defaultValues[fieldIdStr] = caseField.caseField.isChecked ?? false;
            break;
          case "Link":
          case "Text String":
            defaultValues[fieldIdStr] = "";
            break;
          case "Text Long":
            defaultValues[fieldIdStr] = JSON.stringify(emptyEditorContent);
            break;
        }
      });
      reset(defaultValues as FormValues);
      // Enable the name field after template and fields are ready
      setIsTemplateReady(true);
    }
  }, [selectedTemplateId, templates, defaultWorkflowId, reset, setValue]);

  useEffect(() => {
    if (open) {
      // Reset template ready state when dialog opens
      setIsTemplateReady(false);
      const initialTemplateId =
        defaultTemplateId || (templates && templates[0]?.id) || null;
      setSelectedTemplateId(initialTemplateId);
      const defaultValues: Partial<FormValues> = {
        name: "",
        templateId: initialTemplateId ?? 0,
        workflowId: defaultWorkflowId ?? 0,
        estimate: "",
        automated: false,
      };

      const selectedTemplate = templates?.find(
        (template) => template.id === initialTemplateId
      );

      if (selectedTemplate) {
        selectedTemplate.caseFields.forEach((caseField: any) => {
          const fieldIdStr = caseField.caseField.id.toString();
          const fieldType = caseField.caseField.type.type;

          if (fieldType === "Dropdown" && caseField.caseField.fieldOptions) {
            const defaultOption = caseField.caseField.fieldOptions.find(
              (option: any) => option.fieldOption.isDefault
            );
            if (defaultOption) {
              defaultValues[fieldIdStr] = defaultOption.fieldOption.id;
            }
          } else if (fieldType === "Steps") {
            defaultValues[fieldIdStr] = [];
          } else if (fieldType === "Integer" || fieldType === "Number") {
            defaultValues[fieldIdStr] = "";
          } else if (fieldType === "Date") {
            defaultValues[fieldIdStr] = undefined;
          }
        });
        // Enable the name field since we have a template selected and loaded
        // Use setTimeout to ensure this happens after the form is rendered
        setTimeout(() => {
          setIsTemplateReady(true);
        }, 0);
      } else if (initialTemplateId) {
        // We have a template ID but templates might still be loading
        // The other useEffect will handle enabling when template loads
      }
      reset(defaultValues as FormValues);
      setSelectedFiles([]);
      setSelectedTags([]);
      setLinkedIssueIds([]);
    }
  }, [open, reset, defaultTemplateId, defaultWorkflowId, templates, setValue]);

  const handleTemplateChange = (val: number) => {
    // Temporarily disable the name field while switching templates
    setIsTemplateReady(false);
    setSelectedTemplateId(val);
    setValue("templateId", val);

    const selectedTemplate = templates?.find((template) => template.id === val);
    if (selectedTemplate) {
      const defaultValues: Partial<FormValues> = {
        name: "",
        templateId: val,
        workflowId: defaultWorkflowId ?? 0,
        estimate: "",
        automated: false,
      };
      selectedTemplate.caseFields.forEach((caseField: any) => {
        const fieldIdStr = caseField.caseField.id.toString();
        const fieldType = caseField.caseField.type.type;

        // Initialize all field types with appropriate defaults
        switch (fieldType) {
          case "Dropdown":
            if (caseField.caseField.fieldOptions) {
              const defaultOption = caseField.caseField.fieldOptions.find(
                (option: any) => option.fieldOption.isDefault
              );
              if (defaultOption) {
                defaultValues[fieldIdStr] = defaultOption.fieldOption.id;
              }
            }
            break;
          case "Multi-Select":
            defaultValues[fieldIdStr] = [];
            break;
          case "Steps":
            defaultValues[fieldIdStr] = [];
            break;
          case "Integer":
          case "Number":
            defaultValues[fieldIdStr] = "";
            break;
          case "Date":
            defaultValues[fieldIdStr] = undefined;
            break;
          case "Checkbox":
            defaultValues[fieldIdStr] = caseField.caseField.isChecked ?? false;
            break;
          case "Link":
          case "Text String":
            defaultValues[fieldIdStr] = "";
            break;
          case "Text Long":
            defaultValues[fieldIdStr] = JSON.stringify(emptyEditorContent);
            break;
        }
      });
      reset(defaultValues as FormValues);
    }
  };

  if (!session || !session.user.access) {
    return null;
  }

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);

    // Manual validation for required date fields (since we excluded them from Zod schema)
    const selectedTemplate = templates?.find(t => t.id === selectedTemplateId);
    if (selectedTemplate) {
      for (const fieldMeta of selectedTemplate.caseFields) {
        if (fieldMeta.caseField.type.type === "Date" && fieldMeta.caseField.isRequired) {
          const fieldIdStr = fieldMeta.caseField.id.toString();
          const value = data[fieldIdStr];
          if (!value || !(value instanceof Date) || isNaN(value.getTime())) {
            form.setError(fieldIdStr, {
              type: 'manual',
              message: `${fieldMeta.caseField.displayName} is required`,
            });
            setIsSubmitting(false);
            return;
          }
        }
      }
    }

    try {
      if (session) {
        const convertedData: FormValues = {
          ...data,
          workflowId: Number(data.workflowId),
          templateId: Number(data.templateId),
          ...Object.entries(data).reduce(
            (acc, [key, value]) => {
              if (typeof value === "string" && !isNaN(Number(value))) {
                acc[key] = Number(value);
              } else {
                acc[key] = value;
              }
              return acc;
            },
            {} as Record<string, any>
          ),
        };

        const dynamicFields = Object.entries(convertedData)
          .filter(
            ([key]) =>
              ![
                "name",
                "templateId",
                "workflowId",
                "estimate",
                "automated",
              ].includes(key)
          )
          .map(([fieldId, value]) => {
            const caseField = templates
              ?.find((template) => template.id === convertedData.templateId)
              ?.caseFields.find(
                (field) => field.caseField.id.toString() === fieldId
              );
            return {
              fieldId,
              value,
              displayName: caseField?.caseField.displayName || fieldId,
            };
          });

        const formSteps = dynamicFields.find(
          (field) => Array.isArray(field.value) && field.displayName === "Steps"
        );

        if (isLoadingSharedStepGroups) {
          setIsSubmitting(false);
          return;
        }

        if (
          !sharedStepGroupsData &&
          formSteps?.value?.some((s: any) => s.isShared)
        ) {
          console.error(
            "Shared step group data is not available, but form contains shared steps. Cannot expand."
          );
          setIsSubmitting(false);
          return;
        }

        const estimateDuration = convertedData.estimate
          ? parseDuration(convertedData.estimate)
          : undefined;
        const estimateInSeconds = estimateDuration
          ? Math.round(estimateDuration / 1000)
          : undefined;

        const newCase = await createRepositoryCases({
          data: {
            project: {
              connect: { id: Number(projectId) },
            },
            repository: {
              connect: { id: folder?.repositoryId },
            },
            folder: {
              connect: { id: folderId },
            },
            name: convertedData.name,
            template: {
              connect: { id: convertedData.templateId },
            },
            state: {
              connect: { id: convertedData.workflowId },
            },
            estimate: estimateInSeconds,
            createdAt: new Date(),
            creator: {
              connect: { id: session.user.id },
            },
            automated: convertedData.automated,
            order: maxOrder?.order ? maxOrder.order + 1 : 1,
            tags: {
              connect: selectedTags.map((tagId) => ({ id: tagId })),
            },
            issues: {
              connect: linkedIssueIds.map((issueId) => ({ id: issueId })),
            },
          },
        });

        if (!newCase) throw new Error("Failed to create new case");

        const createCaseFieldValuesPromises = dynamicFields
          .filter(({ displayName }) => displayName !== "Steps")
          .map(async ({ fieldId, value }) => {
            await createCaseFieldValues({
              data: {
                testCase: {
                  connect: { id: newCase.id },
                },
                field: {
                  connect: { id: parseInt(fieldId as string) },
                },
                value: value,
              },
            });
          });

        await Promise.all(createCaseFieldValuesPromises);

        const resolvedStepsForVersion: any[] = [];
        if (formSteps?.value && Array.isArray(formSteps.value)) {
          for (const stepItem of formSteps.value) {
            if (stepItem.isShared && stepItem.sharedStepGroupId) {
              const group = sharedStepGroupsData?.find(
                (g) => g.id === stepItem.sharedStepGroupId
              );
              if (group && group.items && group.items.length > 0) {
                for (const sharedItem of group.items) {
                  let parsedStepContent = emptyEditorContent;
                  try {
                    parsedStepContent =
                      typeof sharedItem.step === "string"
                        ? JSON.parse(sharedItem.step)
                        : sharedItem.step || emptyEditorContent;
                  } catch (e) {
                    console.error(
                      "Error parsing sharedItem.step:",
                      sharedItem.step,
                      e
                    );
                  }

                  let parsedExpectedResultContent = emptyEditorContent;
                  try {
                    if (sharedItem.expectedResult) {
                      parsedExpectedResultContent =
                        typeof sharedItem.expectedResult === "string"
                          ? JSON.parse(sharedItem.expectedResult)
                          : sharedItem.expectedResult || emptyEditorContent;
                    }
                  } catch (e) {
                    console.error(
                      "Error parsing sharedItem.expectedResult:",
                      sharedItem.expectedResult,
                      e
                    );
                  }
                  resolvedStepsForVersion.push({
                    step: parsedStepContent,
                    expectedResult: parsedExpectedResultContent,
                  });
                }
              } else {
                console.warn(
                  `Shared step group ID ${stepItem.sharedStepGroupId} (Name: "${stepItem.sharedStepGroupName || "N/A"}") not found or has no items. This shared step will be SKIPPED in the version.`
                );
              }
            } else {
              resolvedStepsForVersion.push({
                step: stepItem.step || emptyEditorContent,
                expectedResult: stepItem.expectedResult || emptyEditorContent,
              });
            }
          }
        }

        if (formSteps?.value && formSteps.value.length > 0) {
          const createStepsPromises = formSteps.value.map(
            async (stepItem: any, index: number) => {
              const stepDataToSave: any = {
                step:
                  typeof stepItem.step === "string"
                    ? stepItem.step
                    : JSON.stringify(stepItem.step),
                order: index,
                testCase: {
                  connect: { id: newCase.id },
                },
              };

              if (stepItem.expectedResult) {
                stepDataToSave.expectedResult =
                  typeof stepItem.expectedResult === "string"
                    ? stepItem.expectedResult
                    : JSON.stringify(stepItem.expectedResult);
              }

              if (stepItem.sharedStepGroupId) {
                stepDataToSave.sharedStepGroup = {
                  connect: { id: stepItem.sharedStepGroupId },
                };
              }

              await createSteps({ data: stepDataToSave });
            }
          );
          await Promise.all(createStepsPromises);
        }

        const attachmentUrls =
          selectedFiles.length > 0 ? await uploadFiles(newCase.id) : [];

        const attachmentsJson = attachmentUrls.map((attachment) => ({
          id: attachment?.id,
          testCaseId: newCase.id,
          url: attachment?.url,
          name: attachment?.name,
          note: attachment?.note,
          isDeleted: false,
          mimeType: attachment?.mimeType,
          size: attachment?.size.toString(),
          createdAt: new Date().toISOString(),
          createdById: session.user.id,
        }));

        const tagNamesForVersion = selectedTags.map(
          (tagId) => tags?.find((tag) => tag.id === tagId)?.name || ""
        );

        const issuesDataForVersion = linkedIssueIds
          .map((issueId: number) => {
            const issue = allIssues?.find((iss) => iss.id === issueId);
            return issue
              ? { id: issue.id, name: issue.name, externalId: issue.externalId }
              : null;
          })
          .filter(Boolean);

        // Invalidate and refetch the case to ensure we have the committed data from the database
        // This prevents race conditions where version creation tries to use stale currentVersion
        await queryClient.invalidateQueries({
          queryKey: ["RepositoryCases", "findFirst"],
        });

        // Create version snapshot using centralized API endpoint
        const versionResponse = await fetch(
          `/api/repository/cases/${newCase.id}/versions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              // No version specified - will use currentVersion (1) from the newly created case
              overrides: {
                name: convertedData.name,
                stateId: convertedData.workflowId,
                stateName:
                  workflows?.find((w) => w.id === convertedData.workflowId)
                    ?.name || "",
                automated: convertedData.automated,
                estimate: estimateInSeconds,
                steps: resolvedStepsForVersion,
                attachments: attachmentsJson,
                tags: tagNamesForVersion,
                issues: issuesDataForVersion,
              },
            }),
          }
        );

        if (!versionResponse.ok) {
          const errorData = await versionResponse.json();
          throw new Error(
            `Failed to create case version: ${errorData.error || "Unknown error"}`
          );
        }

        const { version: newCaseVersion } = await versionResponse.json();

        const createCaseFieldVersionValuesPromises = dynamicFields
          .filter(({ displayName }) => displayName !== "Steps")
          .map(async ({ displayName, value }) => {
            await createCaseFieldVersionValues({
              data: {
                version: {
                  connect: { id: newCaseVersion.id },
                },
                field: displayName,
                value: value,
              },
            });
          });

        await Promise.all(createCaseFieldVersionValuesPromises);

        // Invalidate folder stats first - this updates the case count which enables the Cases query
        await queryClient.invalidateQueries({
          queryKey: ["folderStats"],
          refetchType: "all",
        });

        // Invalidate RepositoryCases queries to refresh the table
        // ZenStack query keys are: ["zenstack", model, operation, args, options]
        // Using refetchType: 'all' to ensure queries are refetched immediately
        await queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === "zenstack" &&
            query.queryKey[1] === "RepositoryCases",
          refetchType: "all",
        });

        setOpen(false);
        setIsSubmitting(false);
        setSelectedTags([]);
        setLinkedIssueIds([]);
        setSelectedFiles([]);
      }
    } catch (err: any) {
      form.setError("root", {
        type: "custom",
        message: `An unknown error occurred. ${err.message}`,
      });
      setIsSubmitting(false);
      return;
    }
  }

  const toggleCollapse = () => {
    setIsTransitioning(true);
    if (panelRef.current) {
      if (isCollapsed) {
        panelRef.current.expand();
      } else {
        panelRef.current.collapse();
      }
      setIsCollapsed(!isCollapsed);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          disabled={!folderId}
          data-testid="add-case-button"
          className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
        >
          <CirclePlus className="w-4 shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40 select-none">
            {t("repository.cases.addCase")}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1400px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {isSubmitting && (
              <LoadingSpinnerAlert className="w-[120px] h-[120px] text-primary" />
            )}
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <div>{t("repository.addCase.title")}</div>
                <div>
                  <FormField
                    control={control}
                    name="templateId"
                    render={({ field }) => (
                      <FormItem className="flex items-baseline space-x-2">
                        <FormLabel className="flex items-center">
                          {t("common.fields.template")}
                          <sup>
                            <Asterisk className="w-3 h-3 text-destructive" />
                          </sup>
                          <HelpPopover helpKey="case.template" />
                        </FormLabel>
                        <FormControl>
                          <Controller
                            control={control}
                            name="templateId"
                            render={({ field: { onChange, value } }) => (
                              <Select
                                onValueChange={(val) => {
                                  onChange(Number(val));
                                  handleTemplateChange(Number(val));
                                }}
                                value={value ? value.toString() : ""}
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={t(
                                      "repository.addCase.selectTemplate"
                                    )}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {templateOptions.map((template) => (
                                      <SelectItem
                                        key={template.value}
                                        value={template.value}
                                      >
                                        {template.label}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </DialogTitle>
              <DialogDescription>
                {folder?.name ? (
                  <span>
                    {t("repository.parentFolder")}: {folder.name}
                  </span>
                ) : (
                  <span>{t("repository.rootFolder")}</span>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="flex h-fit min-w-[300px]">
              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="add-case-panels"
              >
                <ResizablePanel
                  order={1}
                  ref={panelRef}
                  defaultSize={80}
                  collapsedSize={0}
                  minSize={0}
                  collapsible
                  className={`p-0 m-0 mr-4 ${
                    isTransitioning ? "transition-all duration-300 ease-in-out" : ""
                  }`}
                >
                  <div className="mb-4 min-w-[300px] mx-1">
                    <FormField
                      control={control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center">
                            {t("repository.addCase.name")}
                            <sup>
                              <Asterisk className="w-3 h-3 text-destructive" />
                            </sup>
                            <HelpPopover helpKey="case.name" />
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder={t(
                                "repository.addCase.namePlaceholder"
                              )}
                              data-testid="case-name-input"
                              {...field}
                              disabled={!isTemplateReady}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="my-4 mx-1 min-w-[100px] w-fit">
                    <FormField
                      control={control}
                      name="workflowId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center">
                            {t("common.fields.state")}
                            <sup>
                              <Asterisk className="w-3 h-3 text-destructive" />
                            </sup>
                            <HelpPopover helpKey="case.state" />
                          </FormLabel>
                          <FormControl>
                            <Controller
                              control={control}
                              name="workflowId"
                              render={({ field: { onChange, value } }) => (
                                <Select
                                  onValueChange={(val) => onChange(Number(val))}
                                  value={value ? value.toString() : ""}
                                >
                                  <SelectTrigger>
                                    <SelectValue
                                      placeholder={t(
                                        "repository.addCase.selectState"
                                      )}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {workflowOptions.map((workflow) => (
                                        <SelectItem
                                          key={workflow.value}
                                          value={workflow.value}
                                        >
                                          {workflow.label}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {selectedTemplateId && (
                    <div className="space-y-4">
                      {templates
                        ?.find((template) => template.id === selectedTemplateId)
                        ?.caseFields.map((caseField: any) => (
                          <RenderField
                            field={caseField}
                            key={caseField.caseFieldId}
                            control={control}
                            canEditRestricted={canEditRestrictedPerm}
                            projectId={Number(projectId)}
                          />
                        ))}
                    </div>
                  )}
                </ResizablePanel>
                <ResizableHandle withHandle className="w-1" />
                <div>
                  <Button
                    onClick={toggleCollapse}
                    variant="secondary"
                    className="p-0 -ml-1 rounded-l-none"
                    type="button"
                  >
                    {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
                  </Button>
                </div>
                <ResizablePanel
                  order={2}
                  collapsedSize={0}
                  minSize={0}
                  collapsible
                  className="p-0 m-0 min-w-0 ml-4"
                >
                  <FormField
                    control={control}
                    name="estimate"
                    render={({ field }) => (
                      <div className="min-w-[50px] mx-1">
                        <FormItem>
                          <FormLabel className="flex items-center">
                            {t("common.fields.estimate")}
                            <HelpPopover helpKey="case.estimate" />
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="text"
                              placeholder={t(
                                "repository.addCase.estimatePlaceholder"
                              )}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      </div>
                    )}
                  />
                  <div className="mb-1.5">
                    <FormField
                      control={control}
                      name="automated"
                      render={({ field }) => (
                        <FormItem>
                          <div className="mt-4 flex items-center space-x-2 ">
                            <FormLabel className="flex items-center">
                              {t("common.fields.automated")}
                              <HelpPopover helpKey="case.automated" />
                            </FormLabel>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="mb-1.5">
                    <FormLabel className="flex items-center">
                      {t("common.fields.tags")}
                      <HelpPopover helpKey="case.tags" />
                    </FormLabel>
                  </div>
                  <ManageTags
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    canCreateTags={showAddEditTagsPerm}
                  />
                  <div className="mt-4 mb-1.5">
                    <FormLabel className="flex items-center">
                      {t("common.fields.issues")}
                      <HelpPopover helpKey="case.issues" />
                    </FormLabel>
                  </div>
                  {folder?.project ? (
                    <UnifiedIssueManager
                      projectId={folder.project.id}
                      linkedIssueIds={linkedIssueIds}
                      setLinkedIssueIds={setLinkedIssueIds}
                      entityType="testCase"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("common.ui.loadingIssueTracker")}
                    </p>
                  )}
                  <div className="my-8">
                    <UploadAttachments onFileSelect={handleFileSelect} />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button
                variant="outline"
                type="button"
                onClick={handleCancel}
                data-testid="case-cancel-button"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isLoadingSharedStepGroups}
                data-testid="case-submit-button"
              >
                {isSubmitting
                  ? t("common.actions.submitting")
                  : isLoadingSharedStepGroups
                    ? t("common.loading")
                    : t("repository.addCase.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
