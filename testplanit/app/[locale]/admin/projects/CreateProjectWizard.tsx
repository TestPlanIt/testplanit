"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { ProjectAccessType, Prisma, WorkflowScope } from "@prisma/client";
import { optionalImageUrlSchema } from "~/lib/schemas/imageUrl";
import { toast } from "sonner";
import {
  useCreateProjects,
  useFindManyTemplates,
  useFindManyMilestoneTypes,
  useFindManyWorkflows,
  useCreateTemplateProjectAssignment,
  useCreateMilestoneTypesAssignment,
  useCreateManyProjectWorkflowAssignment,
  useFindManyStatus,
  useCreateManyProjectStatusAssignment,
  useFindManyUser,
  useCreateManyProjectAssignment,
  useCreateRepositories,
  useFindManyRoles,
  useFindManyGroups,
  useUpsertUserProjectPermission,
  useUpsertGroupProjectPermission,
  useFindManyIntegration,
  useFindManyLlmIntegration,
  useCreateProjectIntegration,
  useCreateProjectLlmIntegration,
} from "~/lib/hooks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HelpPopover } from "@/components/ui/help-popover";
import UploadProjectIcon from "@/components/UploadProjectIcon";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { DatePickerField } from "@/components/forms/DatePickerField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CirclePlus,
  Workflow,
  Plug,
  Users,
  Boxes,
  LayoutList,
  CircleCheckBig,
  Shield,
  Building,
  Bot,
  ExternalLink,
  PlayCircle,
  Compass,
  ListChecks,
  Asterisk,
  Check,
  Milestone,
} from "lucide-react";

import {
  ProjectUserPermissions,
  UserPermissionFormState,
} from "./ProjectUserPermissions";
import {
  ProjectGroupPermissions,
  GroupPermissionFormState,
} from "./ProjectGroupPermissions";

enum WizardStep {
  PROJECT_DETAILS = 0,
  TEMPLATES = 1,
  WORKFLOWS = 2,
  INTEGRATIONS = 3,
  PERMISSIONS = 4,
}

const stepTitles = [
  "admin.projects.wizard.steps.details",
  "admin.projects.wizard.steps.templates",
  "admin.projects.wizard.steps.workflows",
  "admin.projects.wizard.steps.integrations",
  "admin.projects.wizard.steps.permissions",
];

const stepIcons = [Boxes, LayoutList, Workflow, Plug, Users];

// Validation schema for step 1
const createStep1Schema = (t: any) =>
  z.object({
    iconUrl: optionalImageUrlSchema,
    name: z.string().min(1, {
      message: t("admin.projects.wizard.errors.nameRequired"),
    }),
    note: z.string().optional(),
    isCompleted: z.boolean(),
    completedAt: z.date().optional().nullable(),
    defaultAccessType: z.nativeEnum(ProjectAccessType),
    defaultRoleId: z.string().nullable(),
  });

// Validation schema for step 2
const createStep2Schema = (t: any) =>
  z.object({
    selectedTemplates: z.array(z.number()).min(1, {
      message: t("admin.projects.wizard.errors.templateRequired"),
    }),
  });

// Validation schema for step 3
const createStep3Schema = (t: any) =>
  z.object({
    selectedWorkflows: z.array(z.number()).min(1, {
      message: t("admin.projects.wizard.errors.workflowRequired"),
    }),
    selectedStatuses: z.array(z.number()).min(1, {
      message: t("admin.projects.wizard.errors.statusRequired"),
    }),
    selectedMilestoneTypes: z.array(z.number()).min(0),
  });

// Combined form schema
const FormSchema = z.object({
  // Step 1: Project Details
  iconUrl: optionalImageUrlSchema,
  name: z.string().min(1),
  note: z.string().optional(),
  isCompleted: z.boolean(),
  completedAt: z.date().optional().nullable(),
  defaultAccessType: z.nativeEnum(ProjectAccessType),
  defaultRoleId: z.string().nullable(),

  // Step 2: Templates
  selectedTemplates: z.array(z.number()),

  // Step 3: Workflows & Statuses
  selectedWorkflows: z.array(z.number()),
  selectedStatuses: z.array(z.number()),
  selectedMilestoneTypes: z.array(z.number()),

  // Step 4: Integrations
  selectedIntegrations: z.array(z.number()),
  selectedLlmIntegrations: z.array(z.number()),

  // Step 5: Permissions
  assignedUsers: z.array(z.string()).optional(),
  userPermissions: z
    .record(
      z.string(),
      z.object({
        accessType: z.string(),
        roleId: z.string().nullable(),
      })
    )
    .optional(),
  groupPermissions: z
    .record(
      z.string(),
      z.object({
        accessType: z.string(),
        roleId: z.string().nullable(),
      })
    )
    .optional(),
});

type CreateProjectFormData = z.infer<typeof FormSchema>;

interface CreateProjectWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateProjectWizard({
  isOpen,
  onClose,
}: CreateProjectWizardProps) {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const defaultUserId = session?.user?.id;

  const [currentStep, setCurrentStep] = useState(WizardStep.PROJECT_DETAILS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [localSelectedTemplates, setLocalSelectedTemplates] = useState<
    number[]
  >([]);
  const [isValidatingName, setIsValidatingName] = useState(false);
  const [nameValidationMessage, setNameValidationMessage] = useState<
    string | null
  >(null);

  // Hooks for creating project
  const { mutateAsync: createProject } = useCreateProjects();
  const { mutateAsync: createRepository } = useCreateRepositories();
  const { mutateAsync: createTemplateProjectAssignment } =
    useCreateTemplateProjectAssignment();
  const { mutateAsync: createMilestoneTypesAssignment } =
    useCreateMilestoneTypesAssignment();
  const { mutateAsync: createManyProjectWorkflowAssignment } =
    useCreateManyProjectWorkflowAssignment();
  const { mutateAsync: createManyProjectStatusAssignment } =
    useCreateManyProjectStatusAssignment();
  const { mutateAsync: createManyProjectAssignment } =
    useCreateManyProjectAssignment();
  const { mutateAsync: createProjectIntegration } =
    useCreateProjectIntegration();
  const { mutateAsync: createProjectLlmIntegration } =
    useCreateProjectLlmIntegration();
  const upsertUserPermission = useUpsertUserProjectPermission();
  const upsertGroupPermission = useUpsertGroupProjectPermission();

  // Fetch data for wizard steps
  const { data: templates, isLoading: templatesLoading } = useFindManyTemplates(
    {
      where: { isDeleted: false, isEnabled: true },
      include: {
        caseFields: {
          include: {
            caseField: {
              include: {
                type: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { templateName: "asc" },
    },
    { enabled: isOpen }
  );

  const { data: milestoneTypes, isLoading: milestoneTypesLoading } =
    useFindManyMilestoneTypes(
      {
        where: { isDeleted: false },
        orderBy: { name: "asc" },
        include: {
          icon: true,
        },
      },
      { enabled: isOpen }
    );

  const { data: workflows, isLoading: workflowsLoading } = useFindManyWorkflows(
    {
      where: { isDeleted: false, isEnabled: true },
      orderBy: { order: "asc" },
      include: {
        icon: true,
        color: true,
      },
    },
    { enabled: isOpen }
  );

  const { data: statuses, isLoading: statusesLoading } = useFindManyStatus(
    {
      where: { isDeleted: false, isEnabled: true },
      orderBy: { order: "asc" },
      include: {
        color: true,
      },
    },
    { enabled: isOpen }
  );

  const { data: integrations, isLoading: integrationsLoading } =
    useFindManyIntegration(
      {
        where: { isDeleted: false, status: "ACTIVE" },
        orderBy: { name: "asc" },
      },
      { enabled: isOpen }
    );

  const { data: llmIntegrations, isLoading: llmIntegrationsLoading } =
    useFindManyLlmIntegration(
      {
        where: { isDeleted: false },
        orderBy: { name: "asc" },
      },
      { enabled: isOpen }
    );

  const { data: roles, isLoading: rolesLoading } = useFindManyRoles(
    { where: { isDeleted: false }, orderBy: { name: "asc" } },
    { enabled: isOpen }
  );

  const { data: allUsers, isLoading: allUsersLoading } = useFindManyUser(
    {
      where: { isActive: true, isDeleted: false },
      include: { role: true },
      orderBy: { name: "asc" },
    },
    { enabled: isOpen }
  );

  const { data: allGroups, isLoading: groupsLoading } = useFindManyGroups(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      include: {
        assignedUsers: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true },
        },
      },
    },
    { enabled: isOpen }
  );

  // Function to validate project name uniqueness using dedicated API endpoint
  const validateProjectName = useCallback(
    async (name: string): Promise<boolean> => {
      if (!name || name.trim() === "") {
        return false;
      }

      setIsValidatingName(true);
      setNameValidationMessage(null);

      try {
        const response = await fetch("/api/admin/validate-project-name", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name }),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error("Name validation failed:", data);
          setNameValidationMessage(
            t("admin.projects.wizard.errors.validationFailed")
          );
          return false;
        }

        if (!data.isUnique) {
          setNameValidationMessage(data.message);
          return false;
        }

        setNameValidationMessage(null);
        return true;
      } catch (error) {
        console.error("Failed to validate project name:", error);
        setNameValidationMessage(
          t("admin.projects.wizard.errors.validationFailed")
        );
        return false;
      } finally {
        setIsValidatingName(false);
      }
    },
    [t]
  );

  // Initialize default values
  const defaultValues = useMemo(() => {
    const defaultTemplate = templates?.find((t) => t.isDefault);
    const defaultMilestoneType = milestoneTypes?.find((mt) => mt.isDefault);
    // Select ALL workflows by default, not just the ones marked as default
    const allWorkflowIds = workflows?.map((w) => w.id) || [];

    const initialUserPermissions: Record<string, UserPermissionFormState> = {};
    if (defaultUserId) {
      initialUserPermissions[defaultUserId] = {
        accessType: "PROJECT_DEFAULT",
        roleId: "NONE",
      };
    }

    const initialGroupPermissions: Record<string, GroupPermissionFormState> =
      {};
    allGroups?.forEach((group) => {
      initialGroupPermissions[group.id.toString()] = {
        accessType: "PROJECT_DEFAULT",
        roleId: "NONE",
      };
    });

    return {
      iconUrl: null,
      name: "",
      note: "",
      isCompleted: false,
      completedAt: null,
      defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      defaultRoleId: "NONE",
      selectedTemplates: defaultTemplate ? [defaultTemplate.id] : [],
      selectedWorkflows: allWorkflowIds, // Select ALL workflows
      selectedStatuses:
        statuses?.filter((s) => s.isEnabled)?.map((s) => s.id) || [],
      selectedMilestoneTypes: defaultMilestoneType
        ? [defaultMilestoneType.id]
        : [],
      selectedIntegrations: [],
      selectedLlmIntegrations: [],
      assignedUsers: defaultUserId ? [defaultUserId] : [],
      userPermissions: initialUserPermissions,
      groupPermissions: initialGroupPermissions,
    };
  }, [
    templates,
    milestoneTypes,
    workflows,
    statuses,
    defaultUserId,
    allGroups,
  ]);

  const form = useForm<CreateProjectFormData>({
    resolver: zodResolver(FormSchema),
    defaultValues: defaultValues,
  });

  const {
    watch,
    setValue,
    formState: { errors },
    reset,
    control,
    handleSubmit,
    setError,
    getValues,
  } = form;

  const isCompleted = watch("isCompleted");
  const defaultAccessType = watch("defaultAccessType");
  const selectedWorkflows = watch("selectedWorkflows");
  const selectedStatuses = watch("selectedStatuses");
  const selectedMilestoneTypes = watch("selectedMilestoneTypes");
  const selectedIntegrations = watch("selectedIntegrations");
  const selectedLlmIntegrations = watch("selectedLlmIntegrations");

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      reset(defaultValues);
      setCurrentStep(WizardStep.PROJECT_DETAILS);
      setValidationErrors({});
      // Initialize local state with default templates
      const defaultTemplate = templates?.find((t) => t.isDefault);
      setLocalSelectedTemplates(defaultTemplate ? [defaultTemplate.id] : []);
      // Clear validation messages
      setNameValidationMessage(null);
    }
  }, [isOpen, reset, defaultValues, templates]);

  // Handle default access type changes
  useEffect(() => {
    if (defaultAccessType !== ProjectAccessType.SPECIFIC_ROLE) {
      setValue("defaultRoleId", "NONE");
    }
  }, [defaultAccessType, setValue]);

  // Handle completion status changes
  useEffect(() => {
    if (!isCompleted) {
      setValue("completedAt", null);
    }
  }, [isCompleted, setValue]);

  // Validate current step
  const validateCurrentStep = async (): Promise<boolean> => {
    setValidationErrors({});

    switch (currentStep) {
      case WizardStep.PROJECT_DETAILS:
        const projectName = getValues("name");

        // Check for unique name using API endpoint
        const isNameUnique = await validateProjectName(projectName);
        if (!isNameUnique) {
          setValidationErrors({
            name:
              nameValidationMessage ||
              t("admin.projects.wizard.errors.nameNotUnique"),
          });
          return false;
        }

        const step1Schema = createStep1Schema(t);
        const step1Result = step1Schema.safeParse({
          iconUrl: getValues("iconUrl"),
          name: projectName,
          note: getValues("note"),
          isCompleted: getValues("isCompleted"),
          completedAt: getValues("completedAt"),
          defaultAccessType: getValues("defaultAccessType"),
          defaultRoleId: getValues("defaultRoleId"),
        });

        if (!step1Result.success) {
          const errors: Record<string, string> = {};
          step1Result.error.issues.forEach((issue) => {
            errors[issue.path[0] as string] = issue.message;
          });
          setValidationErrors(errors);
          return false;
        }

        if (
          getValues("defaultAccessType") === ProjectAccessType.SPECIFIC_ROLE &&
          (getValues("defaultRoleId") === "NONE" || !getValues("defaultRoleId"))
        ) {
          setValidationErrors({
            defaultRoleId: t("admin.projects.wizard.errors.roleRequired"),
          });
          return false;
        }
        return true;

      case WizardStep.TEMPLATES:
        // Sync local state to form before validation
        setValue("selectedTemplates", localSelectedTemplates);
        const step2Schema = createStep2Schema(t);
        const step2Result = step2Schema.safeParse({
          selectedTemplates: localSelectedTemplates,
        });

        if (!step2Result.success) {
          const errors: Record<string, string> = {};
          step2Result.error.issues.forEach((issue) => {
            errors[issue.path[0] as string] = issue.message;
          });
          setValidationErrors(errors);
          return false;
        }
        return true;

      case WizardStep.WORKFLOWS:
        const step3Schema = createStep3Schema(t);
        const step3Result = step3Schema.safeParse({
          selectedWorkflows: getValues("selectedWorkflows"),
          selectedStatuses: getValues("selectedStatuses"),
          selectedMilestoneTypes: getValues("selectedMilestoneTypes"),
        });

        if (!step3Result.success) {
          const errors: Record<string, string> = {};
          step3Result.error.issues.forEach((issue) => {
            errors[issue.path[0] as string] = issue.message;
          });
          setValidationErrors(errors);
          return false;
        }
        return true;

      case WizardStep.INTEGRATIONS:
        // Integrations are optional
        return true;

      case WizardStep.PERMISSIONS:
        // Permissions have defaults
        return true;

      default:
        return true;
    }
  };

  const handleNext = async () => {
    // Prevent any form submission while navigating
    const isValid = await validateCurrentStep();
    if (isValid) {
      const nextStep = Math.min(currentStep + 1, WizardStep.PERMISSIONS);
      setCurrentStep(nextStep);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, WizardStep.PROJECT_DETAILS));
  };

  const toggleTemplate = useCallback((templateId: number) => {
    setLocalSelectedTemplates((current) => {
      if (current.includes(templateId)) {
        return current.filter((id) => id !== templateId);
      } else {
        return [...current, templateId];
      }
    });
  }, []);

  const toggleWorkflow = (workflowId: number) => {
    const current = getValues("selectedWorkflows");
    if (current.includes(workflowId)) {
      setValue(
        "selectedWorkflows",
        current.filter((id) => id !== workflowId)
      );
    } else {
      setValue("selectedWorkflows", [...current, workflowId]);
    }
  };

  const toggleStatus = (statusId: number) => {
    const current = getValues("selectedStatuses");
    if (current.includes(statusId)) {
      setValue(
        "selectedStatuses",
        current.filter((id) => id !== statusId)
      );
    } else {
      setValue("selectedStatuses", [...current, statusId]);
    }
  };

  const toggleMilestoneType = (milestoneTypeId: number) => {
    const current = getValues("selectedMilestoneTypes");
    if (current.includes(milestoneTypeId)) {
      setValue(
        "selectedMilestoneTypes",
        current.filter((id) => id !== milestoneTypeId)
      );
    } else {
      setValue("selectedMilestoneTypes", [...current, milestoneTypeId]);
    }
  };

  const toggleIntegration = (integrationId: number) => {
    const current = getValues("selectedIntegrations");
    if (current.includes(integrationId)) {
      setValue(
        "selectedIntegrations",
        current.filter((id) => id !== integrationId)
      );
    } else {
      setValue("selectedIntegrations", [...current, integrationId]);
    }
  };

  const toggleLlmIntegration = (llmIntegrationId: number) => {
    const current = getValues("selectedLlmIntegrations");
    if (current.includes(llmIntegrationId)) {
      setValue(
        "selectedLlmIntegrations",
        current.filter((id) => id !== llmIntegrationId)
      );
    } else {
      setValue("selectedLlmIntegrations", [...current, llmIntegrationId]);
    }
  };

  const onSubmit = async (data: CreateProjectFormData) => {
    // Guard: Only allow submission from the last step
    if (currentStep !== WizardStep.PERMISSIONS) {
      return;
    }

    setIsSubmitting(true);
    let newProjectId: number | undefined = undefined;

    try {
      // Ensure templates are synced from local state
      if (localSelectedTemplates.length > 0) {
        data.selectedTemplates = localSelectedTemplates;
      }

      // Validation check before submission
      if (!data.name || data.name.trim() === "") {
        toast.error(t("admin.projects.wizard.errors.nameRequired"));
        setIsSubmitting(false);
        return;
      }

      if (!data.selectedTemplates || data.selectedTemplates.length === 0) {
        toast.error(t("admin.projects.wizard.errors.templateRequired"));
        setIsSubmitting(false);
        return;
      }

      if (!data.selectedWorkflows || data.selectedWorkflows.length === 0) {
        toast.error(t("admin.projects.wizard.errors.workflowRequired"));
        setIsSubmitting(false);
        return;
      }

      if (!data.selectedStatuses || data.selectedStatuses.length === 0) {
        toast.error(t("admin.projects.wizard.errors.statusRequired"));
        setIsSubmitting(false);
        return;
      }

      console.log("Submitting project with data:", {
        name: data.name,
        selectedTemplates: data.selectedTemplates,
        selectedWorkflows: data.selectedWorkflows,
        selectedStatuses: data.selectedStatuses,
        userId: session?.user.id,
      });

      // Create the project
      const defaultRoleIdToSend =
        data.defaultRoleId === "NONE" || data.defaultRoleId === null
          ? null
          : parseInt(data.defaultRoleId, 10);

      const createData: Prisma.ProjectsCreateInput = {
        name: data.name,
        note: data.note || undefined,
        isCompleted: data.isCompleted,
        completedAt: data.isCompleted ? data.completedAt : null,
        createdAt: new Date(),
        creator: {
          connect: { id: session?.user.id },
        },
        ...(data.iconUrl && { iconUrl: data.iconUrl }),
        defaultAccessType: data.defaultAccessType,
        ...(defaultRoleIdToSend !== null && {
          defaultRole: {
            connect: { id: defaultRoleIdToSend },
          },
        }),
      };

      const newProject = await createProject({
        data: createData,
      });

      newProjectId = newProject?.id;

      if (!newProjectId) {
        throw new Error(t("admin.projects.wizard.errors.creationFailed"));
      }

      // Create repository
      await createRepository({
        data: {
          project: { connect: { id: newProjectId } },
        },
      });

      // Setup templates, workflows, statuses, and milestone types
      const setupPromises: Promise<any>[] = [];

      // Assign templates
      for (const templateId of data.selectedTemplates) {
        setupPromises.push(
          createTemplateProjectAssignment({
            data: {
              projectId: newProjectId,
              templateId: templateId,
            },
          })
        );
      }

      // Assign workflows
      if (data.selectedWorkflows.length > 0) {
        setupPromises.push(
          createManyProjectWorkflowAssignment({
            data: data.selectedWorkflows.map((workflowId) => ({
              workflowId,
              projectId: newProjectId!,
            })),
          })
        );
      }

      // Assign statuses
      if (data.selectedStatuses.length > 0) {
        setupPromises.push(
          createManyProjectStatusAssignment({
            data: data.selectedStatuses.map((statusId) => ({
              statusId,
              projectId: newProjectId!,
            })),
          })
        );
      }

      // Assign milestone types
      for (const milestoneTypeId of data.selectedMilestoneTypes) {
        setupPromises.push(
          createMilestoneTypesAssignment({
            data: {
              projectId: newProjectId,
              milestoneTypeId: milestoneTypeId,
            },
          })
        );
      }

      // Assign integrations
      for (const integrationId of data.selectedIntegrations) {
        setupPromises.push(
          createProjectIntegration({
            data: {
              projectId: newProjectId,
              integrationId: integrationId,
              isActive: true,
            },
          })
        );
      }

      // Assign LLM integrations
      for (const llmIntegrationId of data.selectedLlmIntegrations) {
        setupPromises.push(
          createProjectLlmIntegration({
            data: {
              projectId: newProjectId,
              llmIntegrationId: llmIntegrationId,
              isActive: true,
            },
          })
        );
      }

      await Promise.all(setupPromises);

      // Assign users and permissions
      const usersToAssign = Object.keys(data.userPermissions || {}).filter(
        (userId) => data.userPermissions?.[userId] !== undefined
      );

      if (usersToAssign.length > 0) {
        await createManyProjectAssignment({
          data: usersToAssign.map((userId) => ({
            userId: userId,
            projectId: newProjectId!,
          })),
        });
      }

      // Setup user permissions
      const userPermissionsToUpsert: Prisma.UserProjectPermissionUpsertArgs[] =
        [];
      const submittedUserPermissions = data.userPermissions || {};

      for (const userId in submittedUserPermissions) {
        const perm = submittedUserPermissions[userId];
        if (perm.accessType !== "PROJECT_DEFAULT") {
          const permRoleId =
            perm.roleId === "NONE" || perm.roleId === null
              ? null
              : parseInt(perm.roleId, 10);

          if (
            perm.accessType === ProjectAccessType.SPECIFIC_ROLE &&
            permRoleId === null
          ) {
            continue;
          }

          userPermissionsToUpsert.push({
            where: { userId_projectId: { userId, projectId: newProjectId! } },
            create: {
              userId,
              projectId: newProjectId!,
              accessType: perm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
            update: {
              accessType: perm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
          });
        }
      }

      if (userPermissionsToUpsert.length > 0) {
        for (const upsertArg of userPermissionsToUpsert) {
          await upsertUserPermission.mutateAsync(upsertArg);
        }
      }

      // Setup group permissions
      const groupPermissionsToUpsert: Prisma.GroupProjectPermissionUpsertArgs[] =
        [];
      const submittedGroupPermissions = data.groupPermissions || {};

      for (const groupIdStr in submittedGroupPermissions) {
        const perm = submittedGroupPermissions[groupIdStr];
        if (perm.accessType !== "PROJECT_DEFAULT") {
          const groupId = parseInt(groupIdStr, 10);
          const permRoleId =
            perm.roleId === "NONE" || perm.roleId === null
              ? null
              : parseInt(perm.roleId, 10);

          if (
            perm.accessType === ProjectAccessType.SPECIFIC_ROLE &&
            permRoleId === null
          ) {
            continue;
          }

          groupPermissionsToUpsert.push({
            where: { groupId_projectId: { groupId, projectId: newProjectId! } },
            create: {
              groupId,
              projectId: newProjectId!,
              accessType: perm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
            update: {
              accessType: perm.accessType as ProjectAccessType,
              roleId: permRoleId,
            },
          });
        }
      }

      if (groupPermissionsToUpsert.length > 0) {
        for (const upsertArg of groupPermissionsToUpsert) {
          await upsertGroupPermission.mutateAsync(upsertArg);
        }
      }

      toast.success(t("admin.projects.wizard.success.created"));
      onClose();
    } catch (err: any) {
      console.error("Failed to create project:", err);
      console.error("Error details:", err.info || err.message);

      // Check for specific error types
      if (err.info?.prisma && err.info?.code === "P2002") {
        toast.error(tCommon("errors.projectNameExists"));
        setError("name", {
          type: "custom",
          message: tCommon("errors.projectNameExists"),
        });
      } else if (err.info?.message) {
        // Show the actual error message from the API
        toast.error(err.info.message);
      } else if (err.message) {
        toast.error(err.message);
      } else {
        toast.error(t("admin.projects.wizard.errors.creationFailed"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading =
    templatesLoading ||
    milestoneTypesLoading ||
    workflowsLoading ||
    statusesLoading ||
    integrationsLoading ||
    llmIntegrationsLoading ||
    rolesLoading ||
    allUsersLoading ||
    groupsLoading;

  const isLastStep = currentStep === WizardStep.PERMISSIONS;
  const canProceed = () => {
    switch (currentStep) {
      case WizardStep.PROJECT_DETAILS:
        return getValues("name").length > 0;
      case WizardStep.TEMPLATES:
        return localSelectedTemplates.length > 0;
      case WizardStep.WORKFLOWS:
        return selectedWorkflows.length > 0 && selectedStatuses.length > 0;
      default:
        return true;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case WizardStep.PROJECT_DETAILS:
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left Column */}
            <div className="space-y-4">
              <FormField
                control={control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.name")}
                      <sup>
                        <Asterisk className="w-3 h-3 text-destructive" />
                      </sup>
                      <HelpPopover helpKey="project.name" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t(
                          "admin.projects.wizard.placeholders.projectName"
                        )}
                      />
                    </FormControl>
                    {validationErrors.name && (
                      <p className="text-destructive text-sm mt-1">
                        {validationErrors.name}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="iconUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.icon")}
                      <HelpPopover helpKey="project.icon" />
                    </FormLabel>
                    <FormControl>
                      <UploadProjectIcon
                        onUpload={field.onChange}
                        initialUrl={field.value ?? undefined}
                      />
                    </FormControl>
                    {validationErrors.iconUrl && (
                      <p className="text-destructive text-sm mt-1">
                        {validationErrors.iconUrl}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("fields.description")}
                      <HelpPopover helpKey="project.description" />
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={tCommon("fields.placeholders.description")}
                        className="resize-none"
                        maxLength={256}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              <div className="space-y-2">
                <FormLabel className="flex items-center">
                  {t("admin.projects.wizard.labels.defaultProjectAccess")}
                  <HelpPopover helpKey="project.defaultAccess" />
                </FormLabel>
                <FormField
                  control={control}
                  name="defaultAccessType"
                  render={() => {
                    const currentAccessType = getValues("defaultAccessType");
                    const currentRoleId = getValues("defaultRoleId");
                    let combinedValue = "";

                    if (currentAccessType === ProjectAccessType.NO_ACCESS) {
                      combinedValue = "NO_ACCESS";
                    } else if (
                      currentAccessType === ProjectAccessType.GLOBAL_ROLE
                    ) {
                      combinedValue = "GLOBAL_ROLE";
                    } else if (
                      currentAccessType === ProjectAccessType.SPECIFIC_ROLE &&
                      currentRoleId &&
                      currentRoleId !== "NONE"
                    ) {
                      combinedValue = `ROLE_${currentRoleId}`;
                    } else {
                      combinedValue = "GLOBAL_ROLE";
                    }

                    const handleAccessChange = (value: string) => {
                      if (value === "NO_ACCESS") {
                        setValue(
                          "defaultAccessType",
                          ProjectAccessType.NO_ACCESS
                        );
                        setValue("defaultRoleId", "NONE");
                      } else if (value === "GLOBAL_ROLE") {
                        setValue(
                          "defaultAccessType",
                          ProjectAccessType.GLOBAL_ROLE
                        );
                        setValue("defaultRoleId", "NONE");
                      } else if (value.startsWith("ROLE_")) {
                        const roleId = value.substring(5);
                        setValue(
                          "defaultAccessType",
                          ProjectAccessType.SPECIFIC_ROLE
                        );
                        setValue("defaultRoleId", roleId);
                      }
                    };

                    // Determine which hint to show based on current access type
                    const getAccessHintKey = () => {
                      if (currentAccessType === ProjectAccessType.NO_ACCESS) {
                        return "admin.projects.wizard.labels.accessHints.noAccess";
                      } else if (
                        currentAccessType === ProjectAccessType.GLOBAL_ROLE
                      ) {
                        return "admin.projects.wizard.labels.accessHints.globalRole";
                      } else {
                        return "admin.projects.wizard.labels.accessHints.specificRole";
                      }
                    };

                    return (
                      <FormItem>
                        <Select
                          onValueChange={handleAccessChange}
                          value={combinedValue}
                          disabled={rolesLoading}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "admin.projects.wizard.placeholders.selectDefaultAccess"
                                )}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="NO_ACCESS">
                              {t(
                                "admin.projects.wizard.labels.access.noAccess"
                              )}
                            </SelectItem>
                            <SelectItem value="GLOBAL_ROLE">
                              {t(
                                "admin.projects.wizard.labels.access.globalRole"
                              )}
                            </SelectItem>
                            <SelectSeparator />
                            {roles?.map((role) => (
                              <SelectItem
                                key={role.id}
                                value={`ROLE_${role.id}`}
                              >
                                {role.name}
                                {role.isDefault &&
                                  ` (${tCommon("fields.default")})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription className="text-xs">
                          {t(getAccessHintKey() as any)}
                        </FormDescription>
                        {validationErrors.defaultRoleId && (
                          <p className="text-destructive text-sm mt-1">
                            {validationErrors.defaultRoleId}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>

              <FormField
                control={control}
                name="isCompleted"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0 pt-4 border-t">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="flex items-center mt-0!">
                      {tCommon("fields.completed")}
                      <HelpPopover helpKey="project.completed" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isCompleted && (
                <DatePickerField
                  control={control}
                  name="completedAt"
                  label={tCommon("fields.completedOn")}
                  placeholder={tCommon("placeholders.date")}
                  helpKey="project.completedAt"
                />
              )}
            </div>
          </div>
        );

      case WizardStep.TEMPLATES:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {t("admin.projects.wizard.descriptions.templates")}
              </AlertDescription>
            </Alert>

            {validationErrors.selectedTemplates && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {validationErrors.selectedTemplates}
                </AlertDescription>
              </Alert>
            )}

            <ScrollArea className="h-[400px] border rounded-lg">
              <div className="p-4 space-y-4">
                {templates?.map((template) => {
                  const isSelected = localSelectedTemplates.includes(
                    template.id
                  );
                  return (
                    <div
                      key={template.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleTemplate(template.id);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                              isSelected
                                ? "border-primary bg-primary"
                                : "border-gray-300"
                            }`}
                          >
                            {isSelected && (
                              <Check className="w-3 h-3 text-primary-foreground" />
                            )}
                          </div>
                          <div className="text-base font-semibold">
                            {template.templateName}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {template.isDefault && (
                            <Badge variant="secondary">
                              {tCommon("fields.default")}
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {template.caseFields.length}{" "}
                            {t("admin.projects.wizard.labels.fields")}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {template.caseFields.slice(0, 5).map((cf) => (
                          <Badge key={cf.caseFieldId} variant="outline">
                            {cf.caseField.displayName}
                          </Badge>
                        ))}
                        {template.caseFields.length > 5 && (
                          <Badge variant="outline">
                            {`+${template.caseFields.length - 5}`}{" "}
                            {t("admin.projects.wizard.labels.more")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {t("admin.projects.wizard.labels.selected")}:{" "}
                {localSelectedTemplates.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const defaultTemplate = templates?.find((t) => t.isDefault);
                  if (defaultTemplate) {
                    setLocalSelectedTemplates([defaultTemplate.id]);
                    setValue("selectedTemplates", [defaultTemplate.id]);
                  }
                }}
              >
                {t("admin.projects.wizard.actions.selectDefault")}
              </Button>
            </div>
          </div>
        );

      case WizardStep.WORKFLOWS:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {t("admin.projects.wizard.descriptions.workflows")}
              </AlertDescription>
            </Alert>

            {(validationErrors.selectedWorkflows ||
              validationErrors.selectedStatuses) && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {validationErrors.selectedWorkflows ||
                    validationErrors.selectedStatuses}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-4">
              {/* Workflows Section - Grouped by Scope */}
              <div className="space-y-4">
                <Label className="text-base flex items-center gap-2">
                  <Workflow className="h-4 w-4" />
                  {t("admin.projects.wizard.labels.workflows")}
                  <sup>
                    <Asterisk className="w-3 h-3 text-destructive" />
                  </sup>
                </Label>

                {/* Test Cases Workflows */}
                {workflows?.some((w) => w.scope === WorkflowScope.CASES) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ListChecks className="h-4 w-4" />
                        {t("admin.projects.wizard.labels.testCases")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {workflows
                          ?.filter((w) => w.scope === WorkflowScope.CASES)
                          .map((workflow) => (
                            <div
                              key={workflow.id}
                              className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
                            >
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={selectedWorkflows.includes(
                                    workflow.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleWorkflow(workflow.id)
                                  }
                                />
                                <WorkflowStateDisplay
                                  state={{
                                    name: workflow.name,
                                    icon: {
                                      name: workflow.icon.name as IconName,
                                    },
                                    color: workflow.color,
                                  }}
                                  size="sm"
                                />
                              </div>
                              {workflow.isDefault && (
                                <Badge variant="secondary">
                                  {tCommon("fields.default")}
                                </Badge>
                              )}
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Test Runs Workflows */}
                {workflows?.some((w) => w.scope === WorkflowScope.RUNS) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <PlayCircle className="h-4 w-4" />
                        {t("admin.projects.wizard.labels.testRuns")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {workflows
                          ?.filter((w) => w.scope === WorkflowScope.RUNS)
                          .map((workflow) => (
                            <div
                              key={workflow.id}
                              className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
                            >
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={selectedWorkflows.includes(
                                    workflow.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleWorkflow(workflow.id)
                                  }
                                />
                                <WorkflowStateDisplay
                                  state={{
                                    name: workflow.name,
                                    icon: {
                                      name: workflow.icon.name as IconName,
                                    },
                                    color: workflow.color,
                                  }}
                                  size="sm"
                                />
                              </div>
                              {workflow.isDefault && (
                                <Badge variant="secondary">
                                  {tCommon("fields.default")}
                                </Badge>
                              )}
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Sessions Workflows */}
                {workflows?.some((w) => w.scope === WorkflowScope.SESSIONS) && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Compass className="h-4 w-4" />
                        {t("admin.projects.wizard.labels.sessions")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {workflows
                          ?.filter((w) => w.scope === WorkflowScope.SESSIONS)
                          .map((workflow) => (
                            <div
                              key={workflow.id}
                              className="flex items-center justify-between p-2 border rounded hover:bg-muted/50"
                            >
                              <div className="flex items-center gap-3">
                                <Checkbox
                                  checked={selectedWorkflows.includes(
                                    workflow.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleWorkflow(workflow.id)
                                  }
                                />
                                <WorkflowStateDisplay
                                  state={{
                                    name: workflow.name,
                                    icon: {
                                      name: workflow.icon.name as IconName,
                                    },
                                    color: workflow.color,
                                  }}
                                  size="sm"
                                />
                              </div>
                              {workflow.isDefault && (
                                <Badge variant="secondary">
                                  {tCommon("fields.default")}
                                </Badge>
                              )}
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Statuses Section */}
              <div className="space-y-2">
                <Label className="text-base flex items-center gap-2">
                  <CircleCheckBig className="h-4 w-4" />
                  {t("admin.projects.wizard.labels.statuses")}
                  <sup>
                    <Asterisk className="w-3 h-3 text-destructive" />
                  </sup>
                </Label>
                <div className="space-y-2">
                  {statuses?.map((status) => (
                    <div
                      key={status.id}
                      className="flex items-center justify-between p-2 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedStatuses.includes(status.id)}
                          onCheckedChange={() => toggleStatus(status.id)}
                        />
                        <StatusDotDisplay
                          name={status.name}
                          color={status.color?.value}
                          dotClassName="w-3 h-3 rounded-full"
                          nameClassName="text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Milestone Types Section */}
              <div className="space-y-2">
                <Label className="text-base flex items-center gap-2">
                  <Milestone className="h-4 w-4" />
                  {t("admin.projects.wizard.labels.milestoneTypes")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("admin.projects.wizard.descriptions.milestoneTypes")}
                </p>
                <div className="space-y-2">
                  {milestoneTypes?.map((milestoneType) => (
                    <div
                      key={milestoneType.id}
                      className="flex items-center justify-between p-2 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedMilestoneTypes.includes(
                            milestoneType.id
                          )}
                          onCheckedChange={() =>
                            toggleMilestoneType(milestoneType.id)
                          }
                        />
                        <div className="flex items-center gap-2">
                          {milestoneType.icon && (
                            <DynamicIcon
                              name={milestoneType.icon.name as IconName}
                              className="h-4 w-4"
                            />
                          )}
                          <Label>{milestoneType.name}</Label>
                        </div>
                      </div>
                      {milestoneType.isDefault && (
                        <Badge variant="secondary">
                          {tCommon("fields.default")}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case WizardStep.INTEGRATIONS:
        const hasIntegrations =
          (integrations?.length || 0) > 0 || (llmIntegrations?.length || 0) > 0;

        return (
          <div className="space-y-4">
            {!hasIntegrations ? (
              <Alert>
                <AlertDescription className="flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {t("admin.projects.wizard.descriptions.noIntegrations")}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Alert>
                  <AlertDescription className="flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    {t("admin.projects.wizard.descriptions.integrations")}
                  </AlertDescription>
                </Alert>

                {integrations && integrations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <ExternalLink className="h-4 w-4" />
                        {t("admin.projects.wizard.labels.issueTrackers")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {integrations.map((integration: any) => (
                          <div
                            key={integration.id}
                            className="flex items-center justify-between p-3 border rounded hover:bg-muted/50"
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={selectedIntegrations.includes(
                                  integration.id
                                )}
                                onCheckedChange={() =>
                                  toggleIntegration(integration.id)
                                }
                              />
                              <div>
                                <Label>{integration.name}</Label>
                                {integration.provider && (
                                  <p className="text-xs text-muted-foreground">
                                    {integration.provider}
                                  </p>
                                )}
                              </div>
                            </div>
                            {integration.isActive && (
                              <Badge variant="secondary">
                                {tCommon("status.active")}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {llmIntegrations && llmIntegrations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        {t("admin.projects.wizard.labels.aiModels")}
                      </CardTitle>
                      <CardDescription>
                        {t("admin.projects.wizard.descriptions.aiModels")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {llmIntegrations.map((llmIntegration: any) => (
                          <div
                            key={llmIntegration.id}
                            className="flex items-center justify-between p-3 border rounded hover:bg-muted/50"
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={selectedLlmIntegrations.includes(
                                  llmIntegration.id
                                )}
                                onCheckedChange={() =>
                                  toggleLlmIntegration(llmIntegration.id)
                                }
                              />
                              <div>
                                <Label>{llmIntegration.name}</Label>
                                <p className="text-xs text-muted-foreground">
                                  {llmIntegration.model}
                                </p>
                              </div>
                            </div>
                            <Badge variant="outline">
                              {llmIntegration.provider}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        );

      case WizardStep.PERMISSIONS:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertDescription className="flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {t("admin.projects.wizard.descriptions.permissions")}
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    {t("admin.projects.wizard.labels.users")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ProjectUserPermissions
                    projectId={0}
                    allUsers={allUsers}
                    defaultProjectAccessType={defaultAccessType}
                    defaultProjectRoleId={getValues("defaultRoleId")}
                    roles={roles}
                    control={control as any}
                    setValue={setValue as any}
                    watch={watch as any}
                    getValues={getValues as any}
                    isLoading={allUsersLoading || rolesLoading}
                    assignedUsersList={
                      defaultUserId ? [{ userId: defaultUserId }] : []
                    }
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    {t("admin.projects.wizard.labels.groups")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ProjectGroupPermissions
                    projectId={0}
                    allGroups={allGroups?.map((g) => ({
                      ...g,
                      users: g.assignedUsers,
                    }))}
                    defaultProjectAccessType={defaultAccessType}
                    defaultProjectRoleId={getValues("defaultRoleId")}
                    roles={roles}
                    control={control as any}
                    setValue={setValue as any}
                    watch={watch as any}
                    getValues={getValues as any}
                    isLoading={groupsLoading || rolesLoading}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(newOpenState) => {
        if (!isSubmitting && !newOpenState) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[900px] lg:max-w-[1200px] max-h-[90vh] flex flex-col overflow-hidden">
        <Form {...form}>
          <form
            onSubmit={(e) => {
              // Completely prevent default form submission
              e.preventDefault();
              return false;
            }}
            onKeyDown={(e) => {
              // Prevent Enter key from submitting the form
              if (e.key === "Enter" && e.target instanceof HTMLElement) {
                // Allow Enter in textarea elements
                if (e.target.tagName === "TEXTAREA") {
                  return;
                }
                // Prevent Enter from submitting the form in all other cases
                e.preventDefault();
              }
            }}
            className="flex flex-col flex-1 min-h-0 mt-4"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CirclePlus className="h-5 w-5" />
                {t("admin.projects.wizard.title")}
              </DialogTitle>
              <DialogDescription>
                {t("admin.projects.wizard.description")}
              </DialogDescription>
            </DialogHeader>

            {/* Progress indicator */}
            <div className="flex items-center gap-2 mb-4">
              {stepTitles.map((_, index) => {
                const Icon = stepIcons[index];
                return (
                  <div key={index} className="flex items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        index < currentStep
                          ? "bg-primary text-primary-foreground"
                          : index === currentStep
                            ? "bg-primary/10 text-primary border-2 border-primary"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {index < currentStep ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>
                    {index < stepTitles.length - 1 && (
                      <div
                        className={`w-12 h-0.5 mx-2 ${
                          index < currentStep ? "bg-primary" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-sm text-muted-foreground mb-2">
              {t(stepTitles[currentStep] as any)}
            </div>

            <ScrollArea className="flex-1 min-h-0 pr-4 *:data-radix-scroll-area-viewport:max-h-[calc(90vh-280px)]">
              {renderStepContent()}
            </ScrollArea>

            <DialogFooter className="flex items-center justify-between shrink-0 pt-4">
              <div className="flex items-center gap-2">
                {currentStep > WizardStep.PROJECT_DETAILS && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={isSubmitting}
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    {tCommon("actions.previous")}
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  {tCommon("actions.cancel")}
                </Button>

                {isLastStep ? (
                  <Button
                    type="button"
                    disabled={isSubmitting || isLoading || !canProceed()}
                    onClick={async (e) => {
                      e.preventDefault();

                      // Extra safety: ensure we're on the right step
                      if (currentStep !== WizardStep.PERMISSIONS) {
                        return;
                      }
                      // Prevent double-submission
                      if (isSubmitting) {
                        return;
                      }

                      // Manually trigger form submission
                      await handleSubmit(onSubmit)();
                    }}
                  >
                    {isSubmitting ? (
                      t("admin.projects.wizard.actions.creating")
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        {t("admin.projects.wizard.actions.create")}
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleNext}
                    disabled={isLoading || !canProceed()}
                  >
                    {tCommon("actions.next")}
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                )}
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
