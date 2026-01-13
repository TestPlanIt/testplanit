"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import {
  useFindManyRepositoryCaseVersions,
  useFindManyTemplates,
  useUpdateRepositoryCases,
  useFindManyWorkflows,
  useUpdateCaseFieldValues,
  useCreateAttachments,
  useUpdateAttachments,
  useCreateSteps,
  useUpdateManySteps,
  useCreateCaseFieldVersionValues,
  useCreateCaseFieldValues,
  useDeleteManyCaseFieldValues,
  useFindManyTags,
  useFindManyRepositoryFolders,
  useFindManyIssue,
  useFindFirstProjects,
  useFindManyJUnitTestSuite,
  useFindManyJUnitTestStep,
  useFindManyJUnitAttachment,
  useFindManyJUnitProperty,
  useFindManySharedStepGroup,
} from "~/lib/hooks";
import { AttachmentChanges } from "@/components/AttachmentsDisplay";
import { useFindFirstRepositoryCasesFiltered } from "~/hooks/useRepositoryCasesWithFilteredFields";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller, FormProvider } from "react-hook-form";
import { z } from "zod/v4";
import { Attachments, Prisma } from "@prisma/client";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import FieldValueRenderer from "./FieldValueRenderer";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { ExtendedCases } from "../columns";
import { TemplateNameDisplay } from "@/components/TemplateNameDisplay";
import { Loading } from "@/components/Loading";
import { emptyEditorContent } from "~/app/constants";
import { IconName } from "~/types/globals";
import { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  CircleSlash2,
  Save,
  SquarePen,
  ArrowLeft,
  LockIcon,
  Asterisk,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatSeconds } from "@/components/DurationDisplay";
import { DeleteCaseModal } from "../DeleteCase";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import DynamicIcon from "@/components/DynamicIcon";
import parseDuration from "parse-duration";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import BreadcrumbComponent from "@/components/BreadcrumbComponent";
import { FolderNode } from "../TreeView";
import TestCaseFormControls from "./TestCaseFormControl";
import { VersionSelect } from "@/components/VersionSelect";
import { Link } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import TestResultHistory from "@/components/TestResultHistory";
import { MAX_DURATION } from "~/app/constants";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import {
  FolderSelect,
  transformFolders,
} from "@/components/forms/FolderSelect";
import LinkedCasesPanel from "@/components/LinkedCasesPanel";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";

// Type Definitions (ensure these are present and correct)
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

// Helper function to parse JsonValue to TipTap content (ensure this is present)
const parseJsonToTipTap = (
  jsonValue: Prisma.JsonValue | undefined | null
): object => {
  if (jsonValue === null || jsonValue === undefined) {
    return emptyEditorContent;
  }
  if (typeof jsonValue === "string") {
    try {
      const parsed = JSON.parse(jsonValue);
      return typeof parsed === "object" && parsed !== null
        ? parsed
        : emptyEditorContent;
    } catch (e) {
      return emptyEditorContent;
    }
  }
  if (typeof jsonValue === "object") {
    return jsonValue;
  }
  return emptyEditorContent;
};

// Utility function to get a cookie value
function getCookie(name: string) {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
  return null;
}

// Utility function to set a cookie
function setCookie(name: string, value: string, days: number) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/`;
}

// Utility function to get a number from a cookie or a default value
const getInitialPanelRightWidth = () => {
  if (typeof window === "undefined") return 100; // Default value for server-side rendering
  const storedWidth = getCookie("testDetailsPanelWidth");
  return storedWidth ? parseInt(storedWidth, 10) : 100;
};

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

  const makeOptional = (schema: any) => {
    // If not required, allow the type, undefined, or null
    return isRequired ? schema : schema.optional().nullable();
  };

  switch (field.caseField.type.type) {
    case "Checkbox":
      // Checkbox doesn't strictly need nullable(), as it usually defaults to false/true
      // But adding it for consistency with how null might be stored/retrieved
      return makeOptional(z.boolean().nullable());
    case "Date":
      // Date already correctly handles nullable when optional
      return isRequired ? z.date() : z.date().optional().nullable();
    case "Multi-Select":
      return makeOptional(z.array(z.number()));
    case "Dropdown":
      return makeOptional(z.number());
    case "Integer":
      return makeOptional(addMinMax(z.int()));
    case "Number":
      return makeOptional(addMinMax(z.number()));
    case "Link":
      return makeOptional(z.url());
    case "Text String":
      return makeOptional(z.string());
    case "Text Long":
      return makeOptional(
        z.string().refine(
          (val) => {
            // If optional, null/undefined/empty string passes automatically before refine
            if (
              !isRequired &&
              (val === null || val === undefined || val === "")
            )
              return true;
            // If required, null/undefined/empty string fails
            if (isRequired && (val === null || val === undefined || val === ""))
              return false;
            try {
              const parsed = JSON.parse(val);
              if (isRequired) {
                return (
                  JSON.stringify(parsed) !== JSON.stringify(emptyEditorContent)
                );
              }
              return true; // If optional and not empty/null/undefined, it's valid if parsable
            } catch {
              return false;
            }
          },
          {
            message: isRequired ? "This field is required" : "Invalid content",
          }
        )
      );
    case "Steps":
      return makeOptional(
        z.array(
          z.object({
            step: z.looseObject({}),
            expectedResult: z.looseObject({}).optional(),
            isShared: z.boolean().optional(),
            sharedStepGroupId: z.number().optional().nullable(),
            originalId: z.number().optional().nullable(),
          })
        )
      );
    default:
      return makeOptional(z.string());
  }
};

const createFormSchema = (fields: any[]) => {
  const baseSchema = {
    name: z.string().min(2, {
      error: "Please enter a name for the Test Case",
    }),
    workflowId: z.number({
      error: (issue) =>
        issue.input === undefined ? "Please select a State" : undefined,
    }),
    folderId: z.number({
      error: (issue) =>
        issue.input === undefined ? "Please select a Folder" : undefined,
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
    tags: z.array(z.number()).optional().nullable(),
    issues: z.array(z.number()).optional().nullable(),
    steps: z
      .array(
        z.object({
          step: z.looseObject({}),
          expectedResult: z.looseObject({}).optional(),
          isShared: z.boolean().optional(),
          sharedStepGroupId: z.number().optional().nullable(),
          originalId: z.number().optional().nullable(),
        })
      )
      .optional(),
    templateId: z.number().nullable(),
  };

  const dynamicSchema = fields.reduce(
    (schema, field) => {
      const fieldName = field.caseField.id.toString();
      if (field.caseField.displayName !== "Steps") {
        schema[fieldName] = mapFieldToZodType(field);
      }
      return schema;
    },
    {} as Record<string, z.ZodTypeAny>
  );

  const fullSchema = z.object({
    ...baseSchema,
    ...dynamicSchema,
  });

  return fullSchema;
};

export default function TestCaseDetails() {
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const router = useRouter();
  const { projectId, caseId } = useParams();
  const t = useTranslations();

  // Parse and validate projectId
  const projectIdParam = projectId as string;
  const numericProjectId = parseInt(projectIdParam, 10);
  const isValidProjectId = !isNaN(numericProjectId);

  // Fetch permissions
  const { permissions: projectPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(
      isValidProjectId ? numericProjectId : -1,
      "TestCaseRepository"
    );

  // Extract canAddEdit permission
  const canAddEdit = projectPermissions?.canAddEdit ?? false;

  // Fetch Tags permissions (ADDED)
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(
      isValidProjectId ? numericProjectId : -1,
      ApplicationArea.Tags
    );
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const canAddEditTagsPerm = canAddEditTags || isSuperAdmin; // Correct variable name

  // Fetch Restricted Fields permission (NEW)
  const {
    permissions: restrictedFieldsPermissions,
    isLoading: isLoadingRestrictedPermissions,
  } = useProjectPermissions(
    isValidProjectId ? numericProjectId : -1,
    ApplicationArea.TestCaseRestrictedFields
  );
  const canEditRestricted = restrictedFieldsPermissions?.canAddEdit ?? false;
  const canEditRestrictedPerm = canEditRestricted || isSuperAdmin; // NEW

  const panelRightRef = useRef<ImperativePanelHandle>(null);
  const panelLeftRef = useRef<ImperativePanelHandle>(null);
  const [panelRightWidth, setPanelRightWidth] = useState<number>(
    getInitialPanelRightWidth()
  );
  const [isCollapsedRight, setIsCollapsedRight] = useState<boolean>(false);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [folderHierarchy, setFolderHierarchy] = useState<FolderNode[]>([]);
  const [breadcrumbItems, setBreadcrumbItems] = useState<FolderNode[]>([]);

  const { data: allIssues } = useFindManyIssue({
    where: { isDeleted: false },
    select: { id: true, name: true, externalId: true },
  });

  const isFormInitialized = useRef(false);

  const { data: project, isLoading: isProjectLoading } = useFindFirstProjects(
    {
      where: { id: Number(projectId) },
      select: {
        name: true,
        projectIntegrations: {
          where: { isActive: true },
          include: {
            integration: true,
          },
        },
      },
    },
    {
      enabled: isAuthenticated, // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );
  // Use the active project integration instead of issueConfigId
  const activeIntegration = project?.projectIntegrations?.[0];

  const { data, isLoading, refetch, error } =
    useFindFirstRepositoryCasesFiltered(
      {
        where: { id: Number(caseId), isDeleted: false },
        include: {
          state: {
            select: {
              id: true,
              name: true,
              icon: { select: { name: true } },
              color: { select: { value: true } },
            },
          },
          project: true,
          folder: true,
          creator: true,
          template: {
            select: {
              id: true,
              templateName: true,
              caseFields: {
                select: {
                  caseFieldId: true,
                  caseField: {
                    select: {
                      id: true,
                      defaultValue: true,
                      displayName: true,
                      isRequired: true,
                      isRestricted: true,
                      type: { select: { type: true } },
                      fieldOptions: {
                        select: {
                          fieldOption: {
                            select: {
                              id: true,
                              icon: true,
                              iconColor: true,
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
                orderBy: { order: "asc" },
              },
            },
          },
          caseFieldValues: {
            select: {
              id: true,
              value: true,
              fieldId: true,
              field: {
                select: {
                  id: true,
                  displayName: true,
                  type: { select: { type: true } },
                },
              },
            },
            where: { field: { isEnabled: true, isDeleted: false } },
          },
          attachments: {
            orderBy: { createdAt: "desc" },
            where: { isDeleted: false },
          },
          steps: {
            where: { isDeleted: false },
            orderBy: { order: "asc" },
            include: {
              sharedStepGroup: true,
            },
          },
          tags: {
            where: { isDeleted: false },
            orderBy: { name: "asc" },
          },
          issues: {
            where: { isDeleted: false },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              title: true,
              externalId: true,
              externalUrl: true,
              externalStatus: true,
              externalKey: true,
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
          },
          testRuns: {
            select: {
              id: true,
              isCompleted: true,
              testRun: {
                select: {
                  isDeleted: true,
                  id: true,
                  name: true,
                  isCompleted: true,
                  milestone: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              results: {
                select: {
                  id: true,
                  status: {
                    select: {
                      name: true,
                      color: {
                        select: {
                          value: true,
                        },
                      },
                    },
                  },
                  executedBy: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  executedAt: true,
                  editedBy: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                  editedAt: true,
                  notes: true,
                  elapsed: true,
                  attempt: true,
                  stepResults: {
                    include: {
                      stepStatus: {
                        select: {
                          name: true,
                          color: {
                            select: {
                              value: true,
                            },
                          },
                        },
                      },
                      step: true,
                    },
                    orderBy: {
                      step: {
                        order: "asc",
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
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        enabled: isAuthenticated, // Only query when session is authenticated
        retry: 3, // Retry a few times in case of race conditions
        retryDelay: 1000, // Wait 1 second between retries
      }
    );

  const { data: versions } = useFindManyRepositoryCaseVersions({
    where: { repositoryCaseId: Number(caseId) },
    orderBy: { version: "desc" },
  });

  const { data: templates } = useFindManyTemplates({
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
                orderBy: { fieldOption: { order: "asc" } },
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
  });

  const { data: tags } = useFindManyTags({
    where: {
      isDeleted: false,
    },
    orderBy: {
      name: "asc",
    },
  });

  const testcase = data as any as ExtendedCases;

  const { data: folders, isLoading: isFoldersLoading } =
    useFindManyRepositoryFolders(
      {
        where: { projectId: Number(projectId), isDeleted: false },
        orderBy: { order: "asc" },
      },
      {
        optimisticUpdate: true,
      }
    );

  const [isEditMode, setIsEditMode] = useState(false);

  // Correct placement for useFindManySharedStepGroup hook
  const {
    data: sharedStepGroupsDataFromHook,
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
      { enabled: !!projectId && isEditMode }
    );

  // Before formSchema useState
  const transformedFolders = React.useMemo(() => {
    return transformFolders(folders || []);
  }, [folders]);

  const [formSchema, setFormSchema] = useState(
    createFormSchema(testcase?.template?.caseFields || [])
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
    orderBy: {
      order: "asc",
    },
  });

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

  const templateOptions =
    templates?.map((template) => ({
      value: template.id.toString(),
      label: template.templateName,
    })) || [];

  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pendingAttachmentChanges, setPendingAttachmentChanges] =
    useState<AttachmentChanges>({ edits: [], deletes: [] });

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    testcase?.template.id
  );

  const methods = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
  });

  const {
    reset,
    control,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    getValues,
  } = methods;

  // Restore handleTemplateChange
  const handleTemplateChange = useCallback(
    (val: number | null) => {
      setSelectedTemplateId(val);
    },
    [setSelectedTemplateId]
  );

  // Effect 1: Initialize selectedTemplateId and form initialization state
  useEffect(() => {
    if (testcase && templates && !isFormInitialized.current) {
      setSelectedTemplateId(testcase.template.id ?? null);
      isFormInitialized.current = true;
    }
  }, [testcase, templates, setSelectedTemplateId]);

  // Effect 2: React to selectedTemplateId changes to update schema and form defaults
  useEffect(() => {
    if (!isFormInitialized.current || !testcase || !templates) return;

    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    const caseFieldsForSchema =
      selectedTemplate?.caseFields || (selectedTemplateId === null ? [] : []);
    const newSchema = createFormSchema(caseFieldsForSchema);
    setFormSchema(newSchema);

    // Get current form values to preserve external issues
    const currentValues = getValues();

    // Restore defaultValues logic
    const defaultValues: Record<string, any> = {
      name: testcase.name,
      workflowId: testcase.state.id,
      folderId: testcase.folderId,
      estimate: testcase.estimate ? formatSeconds(testcase.estimate) : "",
      automated: testcase.automated,
      tags: testcase.tags?.map((tag: any) => tag.id) || [],
      // Preserve existing issues value if it's already set (from external issues)
      issues:
        currentValues.issues ||
        testcase.issues?.map((issue: any) => issue.id) ||
        [],
      steps:
        testcase.steps?.map((stepP: any) => ({
          step: parseJsonToTipTap(stepP.step),
          expectedResult: parseJsonToTipTap(stepP.expectedResult),
          isShared: !!stepP.sharedStepGroupId,
          sharedStepGroupId: stepP.sharedStepGroupId,
          sharedStepGroupName: stepP.sharedStepGroup?.name,
          originalId: stepP.id,
        })) || [],
      templateId: selectedTemplateId,
    };

    caseFieldsForSchema.forEach((fieldMeta) => {
      const fieldIdStr = fieldMeta.caseField.id.toString();
      const originalValueForField = testcase.caseFieldValues?.find(
        (cfv) => cfv.fieldId === fieldMeta.caseField.id
      );
      if (originalValueForField) {
        if (fieldMeta.caseField.type.type === "Date") {
          defaultValues[fieldIdStr] = originalValueForField.value
            ? new Date(originalValueForField.value as string)
            : null;
        } else {
          defaultValues[fieldIdStr] =
            originalValueForField.value === null
              ? undefined
              : originalValueForField.value;
        }
      } else {
        defaultValues[fieldIdStr] = undefined;
      }
    });
    reset(defaultValues);
  }, [
    selectedTemplateId,
    testcase,
    templates,
    reset,
    setFormSchema,
    getValues,
    // parseJsonToTipTap, formatSeconds, emptyEditorContent are assumed stable
  ]);

  const viewVersion = (version: string) => {
    router.push(`/projects/repository/${projectId}/${caseId}/${version}`);
  };

  const toggleCollapseRight = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsTransitioning(true);
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
        setCookie("testDetailsPanelWidth", "0.1", 30);
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const toggleCollapseLeft = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsTransitioning(true);
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
        setCookie("testDetailsPanelWidth", "100", 30);
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const { mutate: updateRepositoryCases } = useUpdateRepositoryCases();
  const { mutateAsync: updateCaseFieldValues } = useUpdateCaseFieldValues();
  const { mutateAsync: createCaseFieldVersionValues } =
    useCreateCaseFieldVersionValues();
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const { mutateAsync: updateAttachments } = useUpdateAttachments();
  const { mutateAsync: createSteps } = useCreateSteps();
  const { mutateAsync: updateManySteps } = useUpdateManySteps();
  const { mutateAsync: createCaseFieldValues } = useCreateCaseFieldValues();
  const { mutateAsync: deleteManyCaseFieldValues } =
    useDeleteManyCaseFieldValues();

  // Restore handleEditModeToggle
  const handleEditModeToggle = () => {
    if (!isEditMode) {
      setSelectedTemplateId(testcase.template.id ?? null);
    }
    setIsEditMode(!isEditMode);
  };

  const handleCancel = () => {
    setIsEditMode(false);
    setSelectedTemplateId(testcase.template.id ?? null);
    setPendingAttachmentChanges({ edits: [], deletes: [] });
    setSelectedFiles([]);
    // Form will be reset through the template change effect
  };

  const handleSave = async (data: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);

    // Ensure data.steps is an array
    const steps = Array.isArray(data.steps) ? data.steps : [];

    if (isLoadingSharedStepGroups && steps.some((s: any) => s.isShared)) {
      console.error(
        "Shared step definitions are still loading. Please wait and try again."
      );
      setIsSubmitting(false);
      return;
    }
    if (!sharedStepGroupsDataFromHook && steps.some((s: any) => s.isShared)) {
      console.error(
        "Could not load shared step definitions, but form uses shared steps. Cannot save version correctly."
      );
      setIsSubmitting(false);
      return;
    }

    try {
      const estimateDuration = data.estimate
        ? parseDuration(data.estimate as string)
        : null;
      const estimateInSeconds =
        estimateDuration != null ? Math.round(estimateDuration / 1000) : null;

      // Ensure arrays are properly typed
      const tagsArray = Array.isArray(data.tags) ? data.tags : [];
      const issuesArray = Array.isArray(data.issues) ? data.issues : [];

      // Update the test case, incrementing currentVersion
      await updateRepositoryCases({
        where: { id: Number(caseId) },
        data: {
          name: data.name as string,
          stateId: data.workflowId as number,
          folderId: data.folderId as number,
          estimate: estimateInSeconds,
          automated: data.automated as boolean,
          currentVersion: testcase.currentVersion + 1,
          templateId: data.templateId || undefined,
          tags: {
            set: tagsArray.map((tagId: number) => ({ id: tagId })),
          },
          issues: {
            set: issuesArray
              .filter((id: any) => id != null)
              .map((issueId: number) => ({
                id: issueId,
              })),
          },
        },
      });

      // Refetch to ensure we have the updated currentVersion from the database
      const refetchResult = await refetch();
      const updatedTestCase = refetchResult.data as ExtendedCases;

      if (!updatedTestCase) {
        throw new Error("Failed to refetch updated test case");
      }

      if (data.steps) {
        const existingSteps = testcase?.steps || [];
        interface FormStepData {
          step: any;
          expectedResult?: any;
          isShared?: boolean;
          sharedStepGroupId?: number | null;
          originalId?: number | null;
          placeholderId?: string;
        }
        const submittedSteps: FormStepData[] = data.steps as FormStepData[];

        const stepsToDelete = existingSteps.filter(
          (existingStep) =>
            !submittedSteps.some(
              (submittedStep: FormStepData) =>
                (submittedStep.originalId &&
                  submittedStep.originalId === existingStep.id) ||
                (submittedStep.placeholderId &&
                  submittedStep.placeholderId ===
                    (existingStep as any).placeholderId)
            )
        );
        if (stepsToDelete.length > 0) {
          await updateManySteps({
            where: { id: { in: stepsToDelete.map((s) => s.id) } },
            data: { isDeleted: true },
          });
        }

        const stepPromises = submittedSteps.map(
          async (step: FormStepData, index: number) => {
            if (step.originalId) {
              const existingDatabaseStep = existingSteps.find(
                (s) => s.id === step.originalId
              );
              const updateData: Prisma.StepsUpdateInput = {};
              let requiresUpdate = false;
              if (index !== existingDatabaseStep?.order) {
                updateData.order = index;
                requiresUpdate = true;
              }
              if (step.isShared && step.sharedStepGroupId) {
                if (
                  existingDatabaseStep?.sharedStepGroupId !==
                  step.sharedStepGroupId
                ) {
                  updateData.sharedStepGroup = {
                    connect: { id: step.sharedStepGroupId },
                  };
                  requiresUpdate = true;
                }
                const emptyContentStr = JSON.stringify(emptyEditorContent);
                if (existingDatabaseStep?.step !== emptyContentStr) {
                  updateData.step = emptyContentStr;
                  requiresUpdate = true;
                }
                if (existingDatabaseStep?.expectedResult !== emptyContentStr) {
                  updateData.expectedResult = emptyContentStr;
                  requiresUpdate = true;
                }
              } else {
                if (existingDatabaseStep?.sharedStepGroupId) {
                  updateData.sharedStepGroup = { disconnect: true };
                  requiresUpdate = true;
                }
                const currentStepContent = JSON.stringify(
                  step.step || emptyEditorContent
                );
                if (
                  existingDatabaseStep?.step !== currentStepContent ||
                  updateData.sharedStepGroup?.disconnect
                ) {
                  updateData.step = currentStepContent;
                  requiresUpdate = true;
                }
                const currentExpectedResultContent = JSON.stringify(
                  step.expectedResult || emptyEditorContent
                );
                if (
                  existingDatabaseStep?.expectedResult !==
                    currentExpectedResultContent ||
                  updateData.sharedStepGroup?.disconnect
                ) {
                  updateData.expectedResult = currentExpectedResultContent;
                  requiresUpdate = true;
                }
              }
              if (requiresUpdate) {
                return updateManySteps({
                  where: { id: step.originalId },
                  data: updateData,
                });
              }
            } else {
              const createData: Prisma.StepsCreateInput = {
                order: index,
                testCase: { connect: { id: Number(caseId) } },
              };
              if (step.isShared && step.sharedStepGroupId) {
                createData.step = JSON.stringify(emptyEditorContent);
                createData.expectedResult = JSON.stringify(emptyEditorContent);
                createData.sharedStepGroup = {
                  connect: { id: step.sharedStepGroupId },
                };
              } else {
                createData.step = JSON.stringify(
                  step.step || emptyEditorContent
                );
                createData.expectedResult = JSON.stringify(
                  step.expectedResult || emptyEditorContent
                );
              }
              return createSteps({ data: createData });
            }
            return Promise.resolve();
          }
        );
        await Promise.all(stepPromises);
      } else if (testcase?.steps && testcase.steps.length > 0) {
        await updateManySteps({
          where: { id: { in: testcase.steps.map((s) => s.id) } },
          data: { isDeleted: true },
        });
      }

      const prependString = session?.user?.id;
      const sanitizedFolder = `${projectId}`;

      // Apply pending attachment edits
      const editPromises = pendingAttachmentChanges.edits.map(async (edit) => {
        await updateAttachments({
          where: { id: edit.id },
          data: {
            name: edit.name,
            note: edit.note,
          },
        });
      });

      // Apply pending attachment deletes (soft delete)
      const deletePromises = pendingAttachmentChanges.deletes.map(
        async (attachmentId) => {
          await updateAttachments({
            where: { id: attachmentId },
            data: { isDeleted: true },
          });
        }
      );

      // Wait for all pending changes to be applied
      await Promise.all([...editPromises, ...deletePromises]);

      const createAttachmentsPromises = selectedFiles.map(async (file) => {
        const fileUrl = await fetchSignedUrl(
          file,
          `/api/get-attachment-url/`,
          `${sanitizedFolder}/${prependString}`
        );
        const newAttachment = await createAttachments({
          data: {
            testCase: { connect: { id: Number(caseId) } },
            url: fileUrl,
            name: file.name,
            note: "",
            mimeType: file.type,
            size: BigInt(file.size),
            createdBy: { connect: { id: session!.user.id } },
          },
        });
        return {
          id: newAttachment?.id || 0,
          testCaseId: newAttachment?.testCaseId || 0,
          url: fileUrl,
          name: file.name,
          note: "",
          isDeleted: false,
          mimeType: file.type,
          size: BigInt(file.size),
          createdAt: new Date(),
          createdById: session!.user.id,
        };
      });
      const newAttachments = await Promise.all(createAttachmentsPromises);

      // Get existing attachments, applying pending edits and filtering out deleted ones
      // Explicitly pick only primitive fields to avoid relation objects
      const existingAttachmentsForVersion = (testcase.attachments || [])
        .filter((att) => !pendingAttachmentChanges.deletes.includes(att.id))
        .map((att) => {
          const edit = pendingAttachmentChanges.edits.find(
            (e) => e.id === att.id
          );
          return {
            id: att.id,
            testCaseId: att.testCaseId,
            url: att.url,
            name: edit?.name ?? att.name,
            note: edit?.note ?? att.note,
            isDeleted: att.isDeleted,
            mimeType: att.mimeType,
            size: BigInt(att.size),
            createdAt: att.createdAt,
            createdById: att.createdById,
          };
        });

      const allAttachmentsForVersion = [
        ...existingAttachmentsForVersion,
        ...newAttachments,
      ];
      // Explicitly pick only the fields needed for version JSON storage
      // Avoid spreading to prevent relation objects from being included
      const attachmentsJson = allAttachmentsForVersion.map((attachment) => ({
        id: attachment.id,
        testCaseId: attachment.testCaseId,
        url: attachment.url,
        name: attachment.name,
        note: attachment.note,
        isDeleted: attachment.isDeleted,
        mimeType: attachment.mimeType,
        size: attachment.size.toString(),
        createdAt:
          attachment.createdAt instanceof Date
            ? attachment.createdAt.toISOString()
            : attachment.createdAt,
        createdById: attachment.createdById,
      }));

      const tagNames = tagsArray
        .map(
          (tagId: number) =>
            tags?.find((tag: { id: number; name: string }) => tag.id === tagId)
              ?.name
        )
        .filter((name): name is string => !!name);
      const issuesDataForVersion = issuesArray
        .filter((id: any) => id != null)
        .map((issueId: number) => {
          const issue = allIssues?.find((iss) => iss.id === issueId);
          return issue
            ? { id: issue.id, name: issue.name, externalId: issue.externalId }
            : null;
        })
        .filter(Boolean);

      const resolvedStepsForVersion: any[] = [];
      if (data.steps && Array.isArray(data.steps)) {
        for (const stepItem of data.steps as any[]) {
          if (stepItem.isShared && stepItem.sharedStepGroupId) {
            const group = sharedStepGroupsDataFromHook?.find(
              (g: SharedStepGroupWithItems) =>
                g.id === stepItem.sharedStepGroupId
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
                    "Error parsing sharedItem.step (page.tsx):",
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
                    "Error parsing sharedItem.expectedResult (page.tsx):",
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
                `Shared step group ID ${stepItem.sharedStepGroupId} (Name: "${stepItem.sharedStepGroupName || "N/A"}") not found or has no items. SKIPPED in version (page.tsx).`
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

      // Create version snapshot using centralized API endpoint
      // Note: The test case was already updated with currentVersion + 1 above and refetched
      const versionResponse = await fetch(
        `/api/repository/cases/${updatedTestCase.id}/versions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // No version specified - will use currentVersion (already incremented and refetched)
            // Preserve original creator metadata
            creatorId: updatedTestCase.creatorId,
            creatorName: updatedTestCase.creator.name,
            // Don't pass createdAt - let it default to current time for edits
            overrides: {
              name: data.name as string,
              stateId: data.workflowId as number,
              stateName:
                workflows?.find((w) => w.id === data.workflowId)?.name ||
                updatedTestCase.state?.name ||
                "Unknown",
              automated: data.automated as boolean,
              estimate: estimateInSeconds,
              steps: resolvedStepsForVersion,
              tags: tagNames,
              issues: issuesDataForVersion,
              attachments: attachmentsJson,
              order: updatedTestCase.order,
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

      const formFields = Object.entries(data)
        .filter(
          ([key]) =>
            ![
              "name",
              "workflowId",
              "estimate",
              "automated",
              "tags",
              "steps",
              "templateId",
              "folderId",
              "issues",
            ].includes(key)
        )
        .map(([fieldId, value]) => {
          const selectedTemplateForFieldLookup = templates?.find(
            (template) => template.id === data.templateId
          );
          const caseField = selectedTemplateForFieldLookup?.caseFields.find(
            (field) => field.caseField.id.toString() === fieldId
          );
          return {
            fieldId: Number(fieldId),
            value,
            displayName: caseField?.caseField.displayName || fieldId.toString(),
          };
        })
        .filter(({ fieldId }) => !isNaN(fieldId));

      const createCaseFieldVersionValuesPromises = formFields.map(
        async ({ displayName, value }: { displayName: string; value: any }) => {
          await createCaseFieldVersionValues({
            data: {
              version: { connect: { id: newCaseVersion.id } },
              field: displayName,
              value: value,
            },
          });
        }
      );
      await Promise.all(createCaseFieldVersionValuesPromises);

      // Sync CaseFieldValues (the main table that's displayed on the details page)
      const existingFieldValues = testcase.caseFieldValues || [];
      const caseFieldValuesSyncPromises = formFields.map(
        async ({ fieldId, value }: { fieldId: number; value: any }) => {
          const existingValue = existingFieldValues.find(
            (cfv) => cfv.fieldId === fieldId
          );

          if (existingValue) {
            // Update existing field value
            await updateCaseFieldValues({
              where: { id: existingValue.id },
              data: { value: value ?? null },
            });
          } else if (value !== undefined && value !== null && value !== "") {
            // Create new field value only if there's an actual value
            await createCaseFieldValues({
              data: {
                testCase: { connect: { id: Number(caseId) } },
                field: { connect: { id: fieldId } },
                value: value,
              },
            });
          }
        }
      );
      await Promise.all(caseFieldValuesSyncPromises);

      setIsSubmitting(false);
      setIsEditMode(false);
      setPendingAttachmentChanges({ edits: [], deletes: [] });
      setSelectedFiles([]);
      refetch();
    } catch (error) {
      console.error("Error in handleSave:", error);
      setIsSubmitting(false);
      return;
    }
  };

  const handleResize = async (size: number) => {
    setPanelRightWidth(size);
    setCookie(
      "testDetailsPanelWidth",
      parseInt(size.toString()).toString(),
      90
    );
  };

  useEffect(() => {
    if (!isLoading && folders) {
      const formattedData = folders.map((folder) => ({
        id: folder.id,
        parent: folder.parentId ?? 0,
        text: folder.name,
        droppable: true,
        hasChildren: folders.some((f) => f.parentId === folder.id),
        data: folder,
        directCaseCount: 0,
        totalCaseCount: 0,
      }));

      const getHierarchy = (folderId: number | null): FolderNode[] => {
        if (!folderId) return [];
        const folder = formattedData.find((f) => f.id === folderId);
        if (!folder) return [];
        return [...getHierarchy(folder.parent as number), folder];
      };

      if (testcase?.folder) {
        const hierarchy = getHierarchy(testcase.folder.id);
        setFolderHierarchy(hierarchy);
        setBreadcrumbItems(hierarchy);
      }
    }
  }, [folders, isLoading, testcase?.folder]);

  // Handle hash-based scrolling (e.g., #comments)
  useEffect(() => {
    if (!isLoading && typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash) {
        setTimeout(() => {
          const element = document.querySelector(hash);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }, [isLoading]);

  // Fetch JUnit-specific data if this is an automated case
  const isJUnitCase = isAutomatedCaseSource(testcase?.source);
  const { data: junitSuites } = useFindManyJUnitTestSuite(
    isJUnitCase
      ? { where: { results: { some: { repositoryCaseId: testcase.id } } } }
      : undefined
  );
  const { data: junitSteps } = useFindManyJUnitTestStep(
    isJUnitCase ? { where: { repositoryCaseId: testcase.id } } : undefined
  );
  const { data: junitAttachments } = useFindManyJUnitAttachment(
    isJUnitCase ? { where: { repositoryCaseId: testcase.id } } : undefined
  );
  const { data: junitProperties } = useFindManyJUnitProperty(
    isJUnitCase ? { where: { repositoryCaseId: testcase.id } } : undefined
  );

  const testcaseForModal: ExtendedCases | undefined = data
    ? (data as any as ExtendedCases)
    : undefined;

  // Wait for all data to load - this prevents the flash
  if (isAuthLoading || isLoading || isLoadingPermissions || isProjectLoading) {
    return <Loading />;
  }

  if (!isValidProjectId) {
    router.push(`/404`);
    return null;
  }

  // NOW check if case exists - only after loading is complete
  if (!data || error) {
    // Use a small delay to prevent race conditions on refresh
    setTimeout(() => {
      router.push(`/projects/repository/${projectId}?page=1&pageSize=10`);
    }, 100);
    return (
      <div className="text-muted-foreground text-center p-4">
        {t("repository.cases.notFound")}
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={handleSubmit(handleSave)}
        className="h-full flex flex-col"
      >
        <div>
          {isSubmitting && (
            <LoadingSpinnerAlert className="w-[120px] h-[120px] text-primary" />
          )}
          <CardHeader>
            <CardTitle>
              <div>
                {isEditMode && !isSubmitting && folders ? (
                  <FormField
                    control={control}
                    name="folderId"
                    render={({ field }) => (
                      <FormItem className="mb-2">
                        <FormControl>
                          <FolderSelect
                            value={
                              field.value as string | number | null | undefined
                            }
                            onChange={(val) => {
                              let numericValue: number | undefined;
                              if (
                                val !== null &&
                                val !== undefined &&
                                val !== ""
                              ) {
                                const n = Number(val);
                                if (!isNaN(n)) {
                                  numericValue = n;
                                }
                              }
                              field.onChange(numericValue);
                            }}
                            folders={transformedFolders}
                            isLoading={isFoldersLoading}
                            disabled={isSubmitting}
                            className="w-full md:w-auto"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <BreadcrumbComponent
                    breadcrumbItems={breadcrumbItems}
                    projectId={Number(projectId)}
                  />
                )}
              </div>
              <div className="flex items-start justify-between text-primary text-xl md:text-2xl max-w-full">
                {isEditMode && !isSubmitting ? (
                  <div className="w-full mr-6 -mt-2">
                    <FormField
                      control={control}
                      name="name"
                      render={({ field }: { field: any }) => (
                        <FormItem>
                          <FormLabel className="sr-only">
                            {t("common.name")}
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              className="text-xl md:text-2xl"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <span className="absolute top-0 left-0 ml-[-18px] mt-2.5">
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2 w-fit">
                    {!isEditMode && (
                      <Link
                        href={`/projects/repository/${projectId}?node=${testcase.folder?.id}`}
                      >
                        <Button variant="outline" size="icon" className="mr-2">
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                    <CaseDisplay
                      id={testcase.id}
                      name={testcase.name}
                      size="xl"
                      source={testcase.source}
                    />
                  </div>
                )}
                <div className="flex items-center space-x-2 w-fit">
                  {!isEditMode && (
                    <VersionSelect
                      versions={versions || []}
                      currentVersion={testcase.currentVersion.toString()}
                      onVersionChange={viewVersion}
                      userDateFormat={session?.user.preferences?.dateFormat}
                      userTimeFormat={session?.user.preferences?.timeFormat}
                    />
                  )}
                  {isEditMode && !isSubmitting ? (
                    <div className="space-y-2 w-full">
                      <div className="flex items-center space-x-2">
                        <Button type="submit" variant="default">
                          <div className="flex items-center">
                            <Save className="w-5 h-5 mr-2" />
                            <div>{t("common.actions.save")}</div>
                          </div>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCancel}
                          disabled={isSubmitting || isLoadingSharedStepGroups}
                        >
                          <div className="flex items-center">
                            <CircleSlash2 className="w-5 h-5 mr-2" />
                            <div>{t("common.cancel")}</div>
                          </div>
                        </Button>
                      </div>
                      {errors.root && (
                        <div
                          className="bg-destructive text-destructive-foreground text-sm p-2"
                          role="alert"
                        >
                          {errors.root.message}
                        </div>
                      )}
                      {/* Do not allow deletion of automated test cases */}
                      {!isAutomatedCaseSource(testcase.source) && (
                        <div className="w-full">
                          <DeleteCaseModal
                            testcase={testcase}
                            showLabel={true}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    canAddEdit && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleEditModeToggle}
                        disabled={isLoadingSharedStepGroups}
                        data-testid="edit-test-case-button"
                      >
                        <div className="flex items-center">
                          <SquarePen className="w-5 h-5 mr-2" />
                          <div>{t("common.actions.edit")}</div>
                        </div>
                      </Button>
                    )
                  )}
                </div>
              </div>
            </CardTitle>
            <CardDescription>
              <div className="flex items-center justify-between">
                {isEditMode && !isSubmitting ? (
                  <div>
                    <FormField
                      control={control}
                      name="workflowId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center">
                            {t("common.fields.state")}
                            <sup>
                              <Asterisk className="w-3 h-3 text-destructive" />
                            </sup>{" "}
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
                                        "common.placeholders.selectState"
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
                ) : (
                  <WorkflowStateDisplay
                    state={{
                      ...testcase.state,
                      icon: {
                        ...testcase.state.icon,
                        name: testcase.state.icon.name as IconName,
                      },
                    }}
                  />
                )}
                {isEditMode ? (
                  <FormField
                    name="templateId"
                    render={({ field }) => (
                      <FormItem>
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
                                      "common.placeholders.selectTemplate"
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
                                        <TemplateNameDisplay
                                          name={template.label}
                                        />
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
                ) : (
                  <TemplateNameDisplay name={testcase.template.templateName} />
                )}
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId="case-detail-panels"
            >
              <ResizablePanel
                order={1}
                ref={panelLeftRef}
                className={`p-0 m-0 min-w-6 ${
                  isTransitioning
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }`}
                collapsedSize={0}
                minSize={0}
                collapsible
                onCollapse={() => setIsCollapsedLeft(true)}
                onExpand={() => setIsCollapsedLeft(false)}
              >
                <div className="mb-4">
                  <ul>
                    {(testcase?.template?.caseFields || []).map(
                      (field, fieldIndex) => {
                        let fieldValue = testcase.caseFieldValues.find(
                          (value) => value.fieldId === field.caseField.id
                        )?.value;
                        if (field.caseField.type.type === "Steps") {
                          fieldValue = testcase.steps || [];
                        }
                        if (
                          !isEditMode &&
                          (!fieldValue || fieldValue === emptyEditorContent)
                        )
                          return null;
                        return (
                          <li
                            key={`case-field-${field.caseField.id}-${fieldIndex}`}
                            className="mb-2 mr-6"
                          >
                            {field.caseField.type.type !== "Steps" && (
                              <div className="font-bold flex items-center">
                                {field.caseField.displayName}
                                {isEditMode && field.caseField.isRequired && (
                                  <sup>
                                    <Asterisk className="w-3 h-3 text-destructive" />
                                  </sup>
                                )}
                                {field.caseField.isRestricted && (
                                  <span
                                    title="Restricted Field"
                                    className="ml-1 text-muted-foreground"
                                  >
                                    <LockIcon className="w-4 h-4 shrink-0 text-muted-foreground/50" />
                                  </span>
                                )}
                              </div>
                            )}
                            <FieldValueRenderer
                              fieldValue={fieldValue}
                              fieldType={field.caseField.type.type}
                              caseId={caseId?.toString() || ""}
                              stepsForDisplay={
                                field.caseField.type.type === "Steps"
                                  ? testcase.steps?.map((s: any) => ({
                                      ...s,
                                      sharedStepGroupName:
                                        s.sharedStepGroup?.name,
                                    })) || []
                                  : undefined
                              }
                              template={{
                                caseFields:
                                  testcase?.template?.caseFields || [],
                              }}
                              fieldId={field.caseField.id}
                              fieldIsRestricted={field.caseField.isRestricted}
                              session={session}
                              isEditMode={isEditMode}
                              isSubmitting={isSubmitting}
                              control={control}
                              errors={errors}
                              canEditRestricted={canEditRestrictedPerm}
                              explicitFieldNameForSteps={
                                field.caseField.type.type === "Steps"
                                  ? "steps"
                                  : undefined
                              }
                              {...(field.caseField.type.type === "Steps" && {
                                projectId: Number(projectIdParam),
                                onSharedStepCreated: refetch,
                              })}
                            />
                            <Separator
                              orientation="horizontal"
                              className="mt-2 bg-primary/30"
                            />
                          </li>
                        );
                      }
                    )}
                  </ul>
                  {/* JUnit-specific info in left panel */}
                  {isJUnitCase && (
                    <div className="space-y-4">
                      {junitSteps && junitSteps.length > 0 && (
                        <div>
                          <div className="font-bold mb-1">
                            {t("common.fields.steps")}
                          </div>
                          <ul className="list-disc ml-6">
                            {junitSteps.map((step, index) => (
                              <li key={`junit-step-${step.id}-${index}`}>
                                {step.name}
                                {step.content ? `: ${step.content}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {junitAttachments && junitAttachments.length > 0 && (
                        <div>
                          <div className="font-bold mb-1">
                            {t("common.fields.attachments")}
                          </div>
                          <ul className="list-disc ml-6">
                            {junitAttachments.map((att, index) => (
                              <li key={`junit-att-${att.id}-${index}`}>
                                {att.name} {"("}
                                {att.type}
                                {")"}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {junitProperties && junitProperties.length > 0 && (
                        <div>
                          <div className="font-bold mb-1">
                            {t("common.fields.properties")}
                          </div>
                          <ul className="list-disc ml-6">
                            {junitProperties.map((prop, index) => (
                              <li key={`junit-prop-${prop.id}-${index}`}>
                                {prop.name}
                                {prop.value ? `: ${prop.value}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ResizablePanel>
              <div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          type="button"
                          onClick={toggleCollapseLeft}
                          variant="secondary"
                          size="sm"
                          data-testid="toggle-left-panel-button"
                          className={`p-0 transform ${
                            isCollapsedLeft
                              ? "rounded-l-none rotate-180"
                              : "rounded-r-none"
                          }`}
                        >
                          <ChevronLeft />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div>
                        {isCollapsedLeft
                          ? t("common.actions.expandLeftPanel")
                          : t("common.actions.collapseLeftPanel")}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ResizableHandle withHandle className="w-1" />
              <div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          type="button"
                          onClick={toggleCollapseRight}
                          variant="secondary"
                          size="sm"
                          data-testid="toggle-right-panel-button"
                          className={`p-0 transform ${
                            isCollapsedRight
                              ? "rounded-l-none"
                              : "rounded-r-none rotate-180"
                          }`}
                        >
                          <ChevronLeft />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div>
                        {isCollapsedRight
                          ? t("common.actions.expandRightPanel")
                          : t("common.actions.collapseRightPanel")}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ResizablePanel
                order={2}
                ref={panelRightRef}
                defaultSize={panelRightWidth || 40}
                onResize={handleResize}
                collapsedSize={0}
                minSize={0}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
                className={`${
                  isTransitioning
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                } w-["${panelRightWidth}%"]`}
              >
                <div
                  className={`${
                    isTransitioning
                      ? "transition-all duration-300 ease-in-out"
                      : ""
                  } w-["${panelRightWidth}%"]`}
                >
                  <TestCaseFormControls
                    isEditMode={isEditMode}
                    isSubmitting={isSubmitting}
                    testcase={testcase}
                    setSelectedFiles={setSelectedFiles}
                    selectedFiles={selectedFiles}
                    handleSelect={handleSelect}
                    selectedAttachmentIndex={selectedAttachmentIndex}
                    selectedAttachments={selectedAttachments}
                    handleClose={handleClose}
                    errors={errors}
                    projectIntegration={activeIntegration}
                    canAddEdit={canAddEdit}
                    canCreateTags={canAddEditTagsPerm}
                    session={session}
                    onAttachmentPendingChanges={setPendingAttachmentChanges}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
            {!isEditMode && !isSubmitting && (
              <div className="mt-6">
                <LinkedCasesPanel
                  caseId={testcase.id}
                  canManageLinks={canAddEdit}
                  projectId={Number(projectId)}
                  session={session}
                />
              </div>
            )}
            {!isEditMode && !isSubmitting && (
              <div className="mt-6">
                <TestResultHistory caseId={testcase.id} session={session} />
              </div>
            )}
          </CardContent>
        </div>
      </form>
    </FormProvider>
  );
}
