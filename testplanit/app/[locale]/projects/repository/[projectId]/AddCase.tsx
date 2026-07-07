import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";
import { ManageTags } from "@/components/ManageTags";
import { ConfigureParametersButton } from "@/components/parameters/ConfigureParametersButton";
import {
  InlineDatasetEditor,
  type InlineDatasetRow,
  type InlineParameter,
} from "@/components/parameters/InlineDatasetEditor";
import {
  pickInlinePayload,
  templateHasStepsField,
} from "~/lib/services/inlineParamsGate";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import UploadAttachments, {
  type LinkAttachmentInput,
} from "@/components/UploadAttachments";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { ApplicationArea } from "~/zenstack/models";
import { useQueryClient } from "@tanstack/react-query";
import { Asterisk, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import parseDuration from "parse-duration";
import React, { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod/v4";
import { emptyEditorContent, MAX_DURATION } from "~/app/constants";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { importGeneratedTestCases } from "~/app/actions/importGeneratedTestCases";
import { IconName } from "~/types/globals";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import RenderField from "./RenderField";

const mapFieldToZodType = (field: any, t: (key: any) => string) => {
  const isRequired = field.caseField.isRequired;

  const _addMinMax = (schema: z.ZodNumber) => {
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
        z
          .string()
          .transform((val) => (val === "" ? undefined : parseInt(val, 10))),
      ]);

      // Apply min/max constraints using refine
      if (
        field.caseField.minValue !== undefined &&
        field.caseField.minValue !== null
      ) {
        const minValue = field.caseField.minValue;
        integerBaseSchema = integerBaseSchema.refine(
          (val) =>
            val === undefined || (typeof val === "number" && val >= minValue),
          { message: `Value must be at least ${minValue}` }
        ) as any;
      }
      if (
        field.caseField.maxValue !== undefined &&
        field.caseField.maxValue !== null
      ) {
        const maxValue = field.caseField.maxValue;
        integerBaseSchema = integerBaseSchema.refine(
          (val) =>
            val === undefined || (typeof val === "number" && val <= maxValue),
          { message: `Value must be at most ${maxValue}` }
        ) as any;
      }

      return isRequired ? integerBaseSchema : integerBaseSchema.optional();

    case "Number":
      let numberBaseSchema = z.union([
        z.number(),
        z
          .string()
          .transform((val) => (val === "" ? undefined : parseFloat(val))),
      ]);

      // Apply min/max constraints using refine
      if (
        field.caseField.minValue !== undefined &&
        field.caseField.minValue !== null
      ) {
        const minValue = field.caseField.minValue;
        numberBaseSchema = numberBaseSchema.refine(
          (val) =>
            val === undefined || (typeof val === "number" && val >= minValue),
          { message: `Value must be at least ${minValue}` }
        ) as any;
      }
      if (
        field.caseField.maxValue !== undefined &&
        field.caseField.maxValue !== null
      ) {
        const maxValue = field.caseField.maxValue;
        numberBaseSchema = numberBaseSchema.refine(
          (val) =>
            val === undefined || (typeof val === "number" && val <= maxValue),
          { message: `Value must be at most ${maxValue}` }
        ) as any;
      }

      return isRequired ? numberBaseSchema : numberBaseSchema.optional();
    case "Link":
      return isRequired
        ? z.string().url()
        : z.union([z.string().url(), z.literal("")]).optional();
    case "Text String":
      return isRequired ? z.string() : z.string().optional();
    case "Text Long":
      return isRequired
        ? z.string().refine(
            (val) => {
              try {
                const parsed = JSON.parse(val);
                return !isTiptapEmpty(parsed);
              } catch {
                return false;
              }
            },
            {
              error: t("common.errors.fieldRequired"),
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

const createFormSchema = (fields: any[], t: (key: any) => string) => {
  const baseSchema = {
    name: z.string().min(2, {
      error: t("common.errors.caseNameRequired"),
    }),
    templateId: z.number({
      error: (issue) =>
        issue.input === undefined
          ? t("common.errors.caseTemplateRequired")
          : undefined,
    }),
    workflowId: z.number({
      error: (issue) =>
        issue.input === undefined
          ? t("common.errors.caseStateRequired")
          : undefined,
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
          error: t("common.validation.invalidDurationFormat"),
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
          error: t("common.errors.estimateTooLarge"),
        }
      ),
    automated: z.boolean().prefault(false),
  };

  const dynamicSchema = fields.reduce(
    (schema, field) => {
      const fieldName = field.caseField.id.toString();
      // Skip Date fields entirely - we'll handle them manually without validation
      if (field.caseField.type.type !== "Date") {
        schema[fieldName] = mapFieldToZodType(field, t);
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

interface AddCaseProps {
  folderId: number;
  open: boolean;
  onClose: () => void;
}

interface FormValues {
  name: string;
  templateId: number;
  workflowId: number;
  estimate?: string;
  automated: boolean;
  [key: string]: any;
}

export function AddCase({ folderId, open, onClose }: AddCaseProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { data: session } = useSession();
  const { projectId } = useParams();
  const numericProjectId = Number(projectId);
  const queryClient = useQueryClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [isTemplateReady, setIsTemplateReady] = useState(false);
  const panelRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);

  const [formSchema, setFormSchema] = useState(() => createFormSchema([], t));
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null
  );
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [linkedIssueIds, setLinkedIssueIds] = useState<number[]>([]);
  // Inline parameters + dataset rows authored in AddCase (PARAM-AddCase).
  // The collapsible section that houses these only renders when the selected
  // template has a Steps field — without steps, parameter `@chip` references
  // have no home, so the section would be empty UX friction.
  const [inlineParameters, setInlineParameters] = useState<InlineParameter[]>(
    []
  );
  const [inlineDatasetRows, setInlineDatasetRows] = useState<
    InlineDatasetRow[]
  >([]);
  const [inlineParamsSheetOpen, setInlineParamsSheetOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<LinkAttachmentInput[]>([]);

  const { data: sharedStepGroupsData, isLoading: isLoadingSharedStepGroups } =
    useClientQueries(schema).sharedStepGroup.useFindMany(
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

  const { data: folder } = useClientQueries(
    schema
  ).repositoryFolders.useFindFirst(
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

  const { data: maxOrder } = useClientQueries(
    schema
  ).repositoryCases.useFindFirst(
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

  const { data: templates } = useClientQueries(schema).templates.useFindMany(
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

  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
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
    orderBy: { order: "asc" },
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

  const firstGatedOrder = (workflows ?? [])
    .filter((w) => w.requiresReview === true)
    .reduce<number | null>(
      (acc, w) => (acc === null || w.order < acc ? w.order : acc),
      null
    );
  const workflowOptions =
    workflows?.map((workflow) => ({
      value: workflow.id.toString(),
      disabledForCreate:
        firstGatedOrder !== null && workflow.order >= firstGatedOrder,
      label: (
        <WorkflowStateDisplay
          state={{
            name: workflow.name,
            icon: { name: workflow.icon.name as IconName },
            color: { value: workflow.color.value },
            requiresReview: workflow.requiresReview,
          }}
          size="sm"
        />
      ),
    })) || [];
  const hasGatedWorkflow = firstGatedOrder !== null;
  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(formSchema) as any,
    mode: "onSubmit",
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
  } = form;

  const { data: tags } = useClientQueries(schema).tags.useFindMany({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
  });

  // allIssues removed - fetched on demand during save to avoid loading all issues

  // Fetch Tags permission
  const { permissions: tagsPermissions } = useProjectPermissions(
    numericProjectId,
    ApplicationArea.Tags
  );
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;

  // Fetch Restricted Fields permission (NEW)
  const { permissions: restrictedFieldsPermissions } = useProjectPermissions(
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
    setSelectedLinks([]);
    onClose();
  };

  const uploadFiles = async () => {
    const prependString = session!.user.id;
    const sanitizedFolder = folder?.repositoryId.toString() || "";

    const uploads = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );

      return {
        url: fileUrl,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        note: "",
      };
    });

    return Promise.all(uploads);
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

  // Per `feedback_addcase_params_steps_field_gated`: the inline section is
  // visible only when the selected template has a Steps field — without
  // steps, parameter `@chip` references have no home. Switching to a
  // template that lacks Steps clears any entered draft so a hidden section
  // can't ship orphaned params on submit. Detection lives in
  // `lib/services/inlineParamsGate.ts` so it has unit-test coverage.
  const templateHasSteps = React.useMemo(
    () =>
      templateHasStepsField(
        templates?.find((tt) => tt.id === selectedTemplateId)
      ),
    [templates, selectedTemplateId]
  );

  useEffect(() => {
    if (!templateHasSteps) {
      setInlineParameters([]);
      setInlineDatasetRows([]);
      setInlineParamsSheetOpen(false);
    }
  }, [templateHasSteps]);

  useEffect(() => {
    const selectedTemplate = templates?.find(
      (template) => template.id === selectedTemplateId
    );
    if (selectedTemplate) {
      setFormSchema(createFormSchema(selectedTemplate.caseFields, t));
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
            defaultValues[fieldIdStr] = caseField.caseField.defaultValue || "";
            break;
          case "Text Long":
            defaultValues[fieldIdStr] =
              caseField.caseField.defaultValue ||
              JSON.stringify(emptyEditorContent);
            break;
        }
      });
      reset(defaultValues as FormValues);
      // Enable the name field after template and fields are ready
      setIsTemplateReady(true);
    }
  }, [selectedTemplateId, templates, defaultWorkflowId, reset, setValue, t]);

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
      setSelectedLinks([]);
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
            defaultValues[fieldIdStr] = caseField.caseField.defaultValue || "";
            break;
          case "Text Long":
            defaultValues[fieldIdStr] =
              caseField.caseField.defaultValue ||
              JSON.stringify(emptyEditorContent);
            break;
        }
      });
      reset(defaultValues as FormValues);
    }
  };

  if (!session || !session.user.access) {
    return null;
  }

  const checkForDuplicates = async (
    caseName: string,
    caseId: number,
    tagNames: string[]
  ) => {
    try {
      const res = await fetch("/api/duplicate-scan/check-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: Number(projectId),
          caseId,
          name: caseName,
          tags: tagNames,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.cases && data.cases.length > 0) {
        const caseLinks = data.cases.map((c: { id: number; name: string }) =>
          React.createElement(
            "a",
            {
              key: c.id,
              href: `/${locale}/projects/repository/${projectId}/${c.id}`,
              target: "_blank",
              rel: "noopener noreferrer",
              style: {
                textDecoration: "underline",
                display: "block",
                marginTop: 4,
              },
            },
            c.name
          )
        );
        toast.warning(t("repository.duplicates.duplicateWarning"), {
          description: React.createElement(
            "div",
            null,
            t("repository.duplicates.duplicateWarningDescription", {
              count: data.cases.length,
            }),
            ...caseLinks,
            React.createElement(
              "a",
              {
                href: `/${locale}/projects/repository/${projectId}/duplicates`,
                target: "_blank",
                rel: "noopener noreferrer",
                style: {
                  textDecoration: "underline",
                  fontWeight: 500,
                  display: "block",
                  marginTop: 8,
                },
              },
              t("repository.duplicates.duplicateWarningReview")
            )
          ),
          duration: 15000,
        });
      }
    } catch {
      // Silently ignore — duplicate check is advisory only
    }
  };

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);

    // Manual validation for required date fields (since we excluded them from Zod schema)
    const selectedTemplate = templates?.find(
      (t) => t.id === selectedTemplateId
    );
    if (selectedTemplate) {
      for (const fieldMeta of selectedTemplate.caseFields) {
        if (
          fieldMeta.caseField.type.type === "Date" &&
          fieldMeta.caseField.isRequired
        ) {
          const fieldIdStr = fieldMeta.caseField.id.toString();
          const value = data[fieldIdStr];
          if (!value || !(value instanceof Date) || isNaN(value.getTime())) {
            form.setError(fieldIdStr, {
              type: "manual",
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

        // Steps row stored on the test case (one entry per row in the form,
        // shared-step rows pointing at a group via sharedStepGroupId)
        const stepRowsForCase: Array<{
          step: any;
          expectedResult: any;
          sharedStepGroupId?: number;
        }> = [];
        // Steps array embedded in the version snapshot (shared-step rows
        // are EXPANDED into their constituent items)
        const expandedStepsForVersion: Array<{
          step: any;
          expectedResult: any;
        }> = [];

        if (formSteps?.value && Array.isArray(formSteps.value)) {
          for (const stepItem of formSteps.value) {
            stepRowsForCase.push({
              step: stepItem.step || emptyEditorContent,
              expectedResult: stepItem.expectedResult || emptyEditorContent,
              sharedStepGroupId: stepItem.sharedStepGroupId,
            });

            if (stepItem.isShared && stepItem.sharedStepGroupId) {
              const group = sharedStepGroupsData?.find(
                (g) => g.id === stepItem.sharedStepGroupId
              );
              if (group?.items?.length) {
                for (const sharedItem of group.items) {
                  let parsedStepContent: any = emptyEditorContent;
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

                  let parsedExpectedResultContent: any = emptyEditorContent;
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
                  expandedStepsForVersion.push({
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
              expandedStepsForVersion.push({
                step: stepItem.step || emptyEditorContent,
                expectedResult: stepItem.expectedResult || emptyEditorContent,
              });
            }
          }
        }

        // Files upload to S3 first; external links (text/uri-list) need no
        // upload — they're already in the IssueData-shaped form the
        // backend persists.
        const uploadedAttachments = [
          ...(selectedFiles.length > 0 ? await uploadFiles() : []),
          ...selectedLinks.map((link) => ({
            url: link.url,
            name: link.name,
            mimeType: link.mimeType,
            size: link.size,
            note: link.note ?? "",
          })),
        ];

        const tagNamesForVersion = selectedTags.map(
          (tagId) => tags?.find((tag) => tag.id === tagId)?.name || ""
        );

        let versionIssues: {
          id: number;
          name: string;
          externalId: string | null;
        }[] = [];
        if (linkedIssueIds.length > 0) {
          try {
            const res = await fetch(
              `/api/model/issue/findMany?q=${encodeURIComponent(
                JSON.stringify({
                  where: { id: { in: linkedIssueIds } },
                  select: { id: true, name: true, externalId: true },
                })
              )}`
            );
            if (res.ok) {
              const json = await res.json();
              versionIssues = (json.data ?? json) || [];
            }
          } catch (e) {
            console.error("Failed to fetch linked issues for version:", e);
          }
        }

        const fieldValuesById: Record<string, any> = {};
        const versionFieldValues: { field: string; value: any }[] = [];
        for (const { fieldId, value, displayName } of dynamicFields) {
          if (displayName === "Steps") continue;
          fieldValuesById[fieldId] = value;
          versionFieldValues.push({ field: displayName, value });
        }

        const selectedTemplate = templates?.find(
          (tt) => tt.id === convertedData.templateId
        );

        const result = await importGeneratedTestCases({
          projectId: Number(projectId),
          projectName: folder?.project?.name || "",
          repositoryId: folder?.repositoryId || 0,
          folderId,
          folderName: folder?.name || "",
          templateId: convertedData.templateId,
          templateName: selectedTemplate?.templateName || "",
          stateId: convertedData.workflowId,
          stateName:
            workflows?.find((w) => w.id === convertedData.workflowId)?.name ||
            "",
          maxOrder: maxOrder?.order ?? 0,
          autoGenerateTags: false,
          source: "MANUAL",
          testCases: [
            {
              id: crypto.randomUUID(),
              name: convertedData.name,
              fieldValues: {},
              fieldValuesById,
              versionFieldValues,
              estimate: estimateInSeconds,
              automated: convertedData.automated,
              tagIds: selectedTags,
              issueIds: linkedIssueIds,
              versionTags: tagNamesForVersion,
              versionIssues,
              attachments: uploadedAttachments,
              steps: stepRowsForCase,
              // PARAM-AddCase: forward inline state when the user has
              // actually authored columns. The Sheet is the only path that
              // populates `inlineParameters`, and the `templateHasSteps`
              // effect zeroes the array on template switch, so a non-empty
              // array signals authored draft columns. Trimming +
              // undefined-when-empty live in `pickInlinePayload` so the
              // edge cases get unit-test coverage.
              ...pickInlinePayload(inlineParameters, inlineDatasetRows),
            },
          ],
          fieldMappings: [],
        });

        if (result.status === "error" || result.importedIds.length === 0) {
          throw new Error(
            result.message || result.errors[0] || "Import failed"
          );
        }

        const newCaseId = result.importedIds[0];

        // Close the modal before kicking off cache invalidations so the user
        // perceives Save → close as ~immediate. The invalidations resolve in
        // the background and the repo view re-renders as soon as they land.
        // Scoping by projectId + dropping `refetchType: "all"` (refetching
        // even inactive queries app-wide) takes typical post-save latency
        // from "freeze 1-2s" to a single render of the visible folder view.
        onClose();
        setIsSubmitting(false);

        const projectIdForCache = numericProjectId;
        void queryClient.invalidateQueries({
          predicate: (query) => {
            if (!Array.isArray(query.queryKey)) return false;
            const [root, model, , args] = query.queryKey as [
              string,
              string,
              string,
              { where?: { projectId?: number } } | undefined,
            ];
            if (root !== "zenstack" || model !== "RepositoryCases")
              return false;
            const projectIdArg = args?.where?.projectId;
            return (
              projectIdArg === undefined || projectIdArg === projectIdForCache
            );
          },
        });
        void queryClient.invalidateQueries({ queryKey: ["folderStats"] });

        checkForDuplicates(
          convertedData.name,
          newCaseId,
          tagNamesForVersion
        ).catch(() => {});
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
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[600px] lg:max-w-[1400px]"
        data-testid="add-case-dialog"
      >
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <div>{t("repository.addCase.title")}</div>
                <div>
                  <FormField
                    control={control}
                    name="templateId"
                    render={({ field: _field }) => (
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
                  id="add-case-left"
                  order={1}
                  ref={panelRef}
                  defaultSize={80}
                  collapsedSize={0}
                  minSize={0}
                  collapsible
                  className={`p-0 m-0 me-4 ${
                    isTransitioning
                      ? "transition-all duration-300 ease-in-out"
                      : ""
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
                      render={({ field: _field }) => (
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
                                  <SelectTrigger className="w-fit">
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
                                          disabled={workflow.disabledForCreate}
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
                          {hasGatedWorkflow && (
                            <FormDescription>
                              {t(
                                "reviews.transitionGate.gatedStatesNotSelectable"
                              )}
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {selectedTemplateId && (
                    <div className="space-y-4">
                      {templates
                        ?.find((template) => template.id === selectedTemplateId)
                        ?.caseFields.map((caseField: any) => {
                          const isStepsField =
                            caseField.caseField?.type?.type === "Steps";
                          return (
                            <React.Fragment key={caseField.caseFieldId}>
                              {/* Mirror the case details page: the Configure
                              Parameters button sits right above the Steps
                              field renderer. Same component, same placement,
                              same affordance. In AddCase it opens a Sheet
                              that hosts the InlineDatasetEditor instead of
                              the live (caseId-bound) ConfigureParametersSheet
                              — the case doesn't exist yet at this point. */}
                              {isStepsField && (
                                <div className="flex justify-end">
                                  <ConfigureParametersButton
                                    parameterCount={inlineParameters.length}
                                    canEdit
                                    onOpen={() =>
                                      setInlineParamsSheetOpen(true)
                                    }
                                  />
                                </div>
                              )}
                              <RenderField
                                field={caseField}
                                control={control}
                                canEditRestricted={canEditRestrictedPerm}
                                projectId={Number(projectId)}
                              />
                            </React.Fragment>
                          );
                        })}
                    </div>
                  )}
                </ResizablePanel>
                <ResizableHandle withHandle className="w-1" />
                <div>
                  <Button
                    onClick={toggleCollapse}
                    variant="secondary"
                    className="p-0 -ms-1 rounded-s-none"
                    type="button"
                  >
                    {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
                  </Button>
                </div>
                <ResizablePanel
                  id="add-case-right"
                  order={2}
                  collapsedSize={0}
                  minSize={0}
                  collapsible
                  className="p-0 m-0 min-w-0 ms-4"
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
                    <UploadAttachments
                      onFileSelect={handleFileSelect}
                      allowLinks
                      onLinksChange={setSelectedLinks}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            {templateHasSteps && (
              <Sheet
                open={inlineParamsSheetOpen}
                onOpenChange={setInlineParamsSheetOpen}
              >
                <SheetContent
                  side="right"
                  className="sm:max-w-2xl overflow-y-auto"
                  data-testid="addcase-inline-params-sheet"
                >
                  <SheetHeader>
                    <SheetTitle>{t("parameters.sheetTitle")}</SheetTitle>
                    <SheetDescription>
                      {t("parameters.sheetDescription")}
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4">
                    <InlineDatasetEditor
                      parameters={inlineParameters}
                      rows={inlineDatasetRows}
                      onChange={({ parameters, rows }) => {
                        setInlineParameters(parameters);
                        setInlineDatasetRows(rows);
                      }}
                      testIdPrefix="addcase-inline-dataset"
                    />
                  </div>
                </SheetContent>
              </Sheet>
            )}
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
                disabled={
                  isSubmitting || isLoadingSharedStepGroups || !isTemplateReady
                }
                data-testid="case-submit-button"
              >
                {isSubmitting && <Loader2 className="animate-spin" />}
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
