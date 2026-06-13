/* eslint-disable react-hooks/refs */
"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateIssue } from "@/lib/hooks/issue";
import { useFindManyProjectIntegration } from "@/lib/hooks/project-integration";
import { useFindManyIntegrationProject } from "~/lib/hooks";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { AlertCircle, Asterisk, ExternalLink, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";

// INT-05: description accepts either a plain string (manual issue create
// flow) or a TipTap doc (programmatic prefill from a failed iteration).
// The form's RHF schema continues to use string — the doc shape is held
// outside the form, serialized to markdown for the textarea preview, and
// re-attached at submit time if the user did not edit.
const tiptapDocSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()),
});
type TiptapDocValue = z.infer<typeof tiptapDocSchema>;

const createIssueSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.string().optional().default("medium"),
  issueType: z.string().optional(),
  // Only used for Simple URL integrations, where the issue ID becomes the
  // externalId substituted into the Base URL template.
  externalId: z.string().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
});

type CreateIssueFormValues = z.infer<typeof createIssueSchema>;

// Public defaults shape — broadened to accept a TipTap doc on description
// for the INT-05 prefill path. The dialog narrows internally.
type CreateIssueDialogDefaults = Omit<
  Partial<CreateIssueFormValues>,
  "description"
> & {
  description?: string | TiptapDocValue;
};

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onIssueCreated?: (issue: any) => void;
  defaultValues?: CreateIssueDialogDefaults;
  entityType?:
    | "testCase"
    | "session"
    | "sessionResult"
    | "testRun"
    | "testRunResult"
    | "testRunStepResult";
  entityId?: number;
}

function isTiptapDocValue(value: unknown): value is TiptapDocValue {
  return tiptapDocSchema.safeParse(value).success;
}

export function CreateIssueDialog({
  open,
  onOpenChange,
  projectId,
  onIssueCreated,
  defaultValues,
  entityType,
  entityId,
}: CreateIssueDialogProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [isCreating, setIsCreating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [_isCheckingAuth, setIsCheckingAuth] = useState(false);
  const [selectedIssueType, setSelectedIssueType] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isDefaultSet, setIsDefaultSet] = useState(false);
  const [issueTypeFields, setIssueTypeFields] = useState<any[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, any>
  >({});

  // INT-05: when defaultValues.description is a TipTap doc we hold the
  // doc in a ref + compute its markdown preview to seed the textarea.
  // If the user does not edit the textarea before submit, we send the
  // ORIGINAL doc to the API so Jira/ADO can render their native rich
  // formats (D-15). If the user edits, we send the edited string.
  const initialDescription = defaultValues?.description;
  const isInitialDescriptionDoc = isTiptapDocValue(initialDescription);
  const initialMarkdownPreview = useMemo(() => {
    if (isInitialDescriptionDoc) {
      try {
        return tiptapToMarkdown(initialDescription);
      } catch (err) {
        console.error("Failed to render TipTap doc to markdown preview", err);
        return "";
      }
    }
    return typeof initialDescription === "string" ? initialDescription : "";
  }, [initialDescription, isInitialDescriptionDoc]);

  // Stable ref to the original doc — used at submit to decide whether to
  // restore the doc shape.
  const originalDocRef = useRef<TiptapDocValue | null>(
    isInitialDescriptionDoc ? (initialDescription as TiptapDocValue) : null
  );

  const form = useForm<CreateIssueFormValues>({
    resolver: standardSchemaResolver(createIssueSchema) as any,
    defaultValues: {
      title: defaultValues?.title || "",
      description: initialMarkdownPreview,
      priority: defaultValues?.priority || "medium",
      issueType: defaultValues?.issueType || undefined,
      externalId: defaultValues?.externalId || "",
      customFields: {},
    },
  });

  // ZenStack hook for creating issues
  const createIssue = useCreateIssue();

  // Fetch project integrations
  const { data: projectIntegrations } = useFindManyProjectIntegration({
    where: {
      projectId,
      isActive: true,
    },
    include: {
      integration: true,
    },
  });

  const activeIntegration = projectIntegrations?.[0];
  const integrationId = activeIntegration?.integrationId;

  // Fetch active IntegrationProject records for multi-project support (D-09, D-10)
  const { data: integrationProjects } = useFindManyIntegrationProject(
    {
      where: {
        projectIntegrationId: activeIntegration?.id || "",
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { externalProjectName: "asc" }],
    },
    {
      enabled: !!activeIntegration?.id,
    }
  );

  // Track which IntegrationProject the user has selected for issue creation
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );

  // Auto-select default project when dialog opens or integrationProjects loads.
  // Also resets selection when dialog closes.
  useEffect(() => {
    if (!open) {
      setSelectedProjectId(null);
      return;
    }
    if (
      integrationProjects &&
      integrationProjects.length > 0 &&
      !selectedProjectId
    ) {
      const defaultProject =
        integrationProjects.find((ip) => ip.isDefault) ||
        integrationProjects[0];
      setSelectedProjectId(defaultProject.id);
    }
  }, [open, integrationProjects, selectedProjectId]);

  // Derive the selected project record
  const selectedProject = useMemo(() => {
    if (!integrationProjects || integrationProjects.length === 0) return null;
    return (
      integrationProjects.find((ip) => ip.id === selectedProjectId) || null
    );
  }, [integrationProjects, selectedProjectId]);

  // The effective project key for API calls — from IntegrationProject when available,
  // falling back to legacy config fields for backward compatibility
  const effectiveProjectKey = useMemo(() => {
    if (selectedProject) {
      return (
        selectedProject.externalProjectKey ||
        selectedProject.externalProjectId ||
        ""
      );
    }
    // Backward compat: fall back to config when no IntegrationProject records exist
    const config = (activeIntegration?.config as Record<string, any>) || {};
    return config.externalProjectKey || config.externalProjectId || "";
  }, [selectedProject, activeIntegration]);

  // Check if this is a Simple URL integration
  const isSimpleUrlIntegration =
    activeIntegration?.integration?.provider === "SIMPLE_URL";

  // Determine if we should use integration based on project configuration
  // For Simple URL integrations, we always create internal issues
  const useIntegration = !!activeIntegration && !isSimpleUrlIntegration;

  // Check if external integration is properly configured
  // Prefer IntegrationProject records; fall back to legacy config check
  const isIntegrationConfigured = useMemo(() => {
    if (!useIntegration || !activeIntegration) return true; // Not using integration or no integration
    if (integrationProjects && integrationProjects.length > 0) return true;
    // Backward compat: check config fields when no IntegrationProject records exist
    const config = activeIntegration.config as Record<string, any>;
    return !!(config?.externalProjectKey || config?.externalProjectId);
  }, [useIntegration, activeIntegration, integrationProjects]);

  // Get default issue type — from selected IntegrationProject when available (per Plan 65-02),
  // falling back to legacy config field for backward compatibility
  const defaultIssueType = useMemo(() => {
    if (selectedProject?.defaultIssueType) {
      return {
        id: selectedProject.defaultIssueType,
        name:
          selectedProject.defaultIssueTypeName ||
          selectedProject.defaultIssueType,
      };
    }
    // Backward compat: read from config when no IntegrationProject records exist
    if (!activeIntegration?.config) return null;
    const config = activeIntegration.config as Record<string, any>;
    if (!config.defaultIssueType) return null;
    return {
      id: config.defaultIssueType,
      name: config.defaultIssueTypeName || config.defaultIssueType,
    };
  }, [selectedProject, activeIntegration?.config]);

  // Check authentication status
  const checkAuth = useCallback(async () => {
    if (!integrationId) return { authenticated: false };

    try {
      const response = await fetch(
        `/api/integrations/${integrationId}/auth/check`
      );
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Auth check failed:", error);
      return { authenticated: false };
    }
  }, [integrationId]);

  const fetchIssueTypes = useCallback(
    async (query: string, page: number, pageSize: number) => {
      if (!activeIntegration) return [];

      try {
        const response = await fetch(
          `/api/integrations/${activeIntegration.integrationId}/issue-types`
        );
        if (response.ok) {
          const data = await response.json();
          const issueTypes = data.issueTypes || [];

          // Filter by query if provided
          const filtered = query
            ? issueTypes.filter((type: any) =>
                type.name.toLowerCase().includes(query.toLowerCase())
              )
            : issueTypes;

          // Paginate results
          const start = page * pageSize;
          const end = start + pageSize;
          return {
            results: filtered.slice(start, end),
            total: filtered.length,
          };
        } else if (response.status === 401) {
          const errorData = await response.json();
          setAuthError(errorData.authUrl || "Authentication required");
        }
      } catch (error) {
        console.error("Failed to fetch issue types:", error);
      }
      return { results: [], total: 0 };
    },
    [activeIntegration]
  );

  // Check authentication on mount for external integrations
  useEffect(() => {
    const checkAuthStatus = async () => {
      if (!useIntegration || !activeIntegration) return;

      setIsCheckingAuth(true);
      try {
        const authStatus = await checkAuth();
        if (!authStatus.authenticated) {
          setAuthError(authStatus.authUrl || "Authentication required");
        }
      } catch (error) {
        console.error("Auth check failed:", error);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    void checkAuthStatus();
  }, [useIntegration, activeIntegration, checkAuth]);

  // Fetch issue type fields when issue type changes
  const fetchIssueTypeFields = useCallback(async () => {
    if (!selectedIssueType || !activeIntegration) return;

    setLoadingFields(true);
    try {
      const response = await fetch(
        `/api/integrations/${activeIntegration.integrationId}/issue-type-fields?issueTypeId=${selectedIssueType.id}&projectKey=${encodeURIComponent(effectiveProjectKey)}`
      );
      if (response.ok) {
        const data = await response.json();
        setIssueTypeFields(data.fields || []);
      }
    } catch (error) {
      console.error("Failed to fetch issue type fields:", error);
    } finally {
      setLoadingFields(false);
    }
  }, [selectedIssueType, activeIntegration, effectiveProjectKey]);

  // Fetch fields when issue type changes
  useEffect(() => {
    if (selectedIssueType) {
      void fetchIssueTypeFields();
    }
  }, [selectedIssueType, fetchIssueTypeFields]);

  // Set default issue type when dialog opens
  useEffect(() => {
    if (defaultIssueType && !isDefaultSet && open) {
      setSelectedIssueType(defaultIssueType);
      setIsDefaultSet(true);
    }
  }, [defaultIssueType, isDefaultSet, open]);

  // Reset default flag when dialog closes
  useEffect(() => {
    if (!open) {
      setIsDefaultSet(false);
      setSelectedIssueType(null);
      setIssueTypeFields([]);
      setCustomFieldValues({});
    }
  }, [open]);

  const onSubmit = async (values: CreateIssueFormValues) => {
    setIsCreating(true);
    setAuthError(null);

    try {
      let issue;

      if (isSimpleUrlIntegration && activeIntegration) {
        // Ensure we have a valid session
        if (!session?.user?.id) {
          throw new Error("Authentication required");
        }

        // Simple URL link-outs require the issue ID as externalId
        const externalId = values.externalId?.trim();
        if (!externalId) {
          form.setError("externalId", {
            message: t("common.errors.fieldRequired"),
          });
          setIsCreating(false);
          return;
        }

        const createData: any = {
          name: externalId,
          title: values.title,
          externalId,
          description: values.description || "",
          status: "open",
          priority: values.priority || "medium",
          project: {
            connect: { id: projectId },
          },
          integration: {
            connect: { id: activeIntegration.integrationId },
          },
          createdBy: {
            connect: { id: session?.user?.id },
          },
        };

        // Add entity linking information - these are many-to-many relationships
        if (entityType && entityId) {
          switch (entityType) {
            case "testCase":
              createData.repositoryCases = {
                connect: [{ id: entityId }],
              };
              break;
            case "session":
              createData.sessions = {
                connect: [{ id: entityId }],
              };
              break;
            case "sessionResult":
              createData.sessionResults = {
                connect: [{ id: entityId }],
              };
              break;
            case "testRun":
              createData.testRuns = {
                connect: [{ id: entityId }],
              };
              break;
            case "testRunResult":
              createData.testRunResults = {
                connect: [{ id: entityId }],
              };
              break;
            case "testRunStepResult":
              createData.testRunStepResults = {
                connect: [{ id: entityId }],
              };
              break;
          }
        }

        issue = await createIssue.mutateAsync({
          data: createData,
          include: {
            integration: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
      } else if (!useIntegration || !activeIntegration) {
        // Create internal issue without integration using ZenStack hook
        if (!session?.user?.id) {
          throw new Error("Authentication required");
        }

        const createData: any = {
          name: values.title,
          title: values.title,
          description: values.description || "",
          status: "open",
          priority: values.priority || "medium",
          project: {
            connect: { id: projectId },
          },
          createdBy: {
            connect: { id: session.user.id },
          },
        };

        // Add entity linking information - these are many-to-many relationships
        if (entityType && entityId) {
          switch (entityType) {
            case "testCase":
              createData.repositoryCases = {
                connect: [{ id: entityId }],
              };
              break;
            case "session":
              createData.sessions = {
                connect: [{ id: entityId }],
              };
              break;
            case "sessionResult":
              createData.sessionResults = {
                connect: [{ id: entityId }],
              };
              break;
            case "testRun":
              createData.testRuns = {
                connect: [{ id: entityId }],
              };
              break;
            case "testRunResult":
              createData.testRunResults = {
                connect: [{ id: entityId }],
              };
              break;
            case "testRunStepResult":
              createData.testRunStepResults = {
                connect: [{ id: entityId }],
              };
              break;
          }
        }

        issue = await createIssue.mutateAsync({
          data: createData,
        });
      } else {
        // Use existing external integration logic for other providers (JIRA, GitHub, etc.)
        const endpoint = `/api/integrations/${activeIntegration.integrationId}/create-issue`;

        // INT-05: if the dialog was opened with a TipTap doc and the user
        // did NOT edit the textarea (its current value still equals the
        // markdown preview produced from that doc), send the ORIGINAL doc
        // so Jira/ADO can render their native rich formats. If the user
        // edited, send the edited string (their changes win).
        const submittedDescription: any =
          originalDocRef.current &&
          values.description === initialMarkdownPreview
            ? originalDocRef.current
            : values.description;

        const payload: any = {
          projectId: projectId.toString(),
          title: values.title,
          description: submittedDescription,
          priority: values.priority,
          customFields: customFieldValues,
          // Include internal TestPlanIt project ID for database storage
          testplanitProjectId: projectId,
        };

        // Use the effective project key — from selected IntegrationProject when available,
        // falling back to config fields for backward compatibility
        payload.projectId = effectiveProjectKey;
        // Use the selected issue type (only for providers that support it)
        if (selectedIssueType) {
          payload.issueType = selectedIssueType.id;
        } else if (activeIntegration.integration?.provider !== "GITHUB") {
          // Try common issue type IDs as fallback (for Jira, Azure DevOps, etc.)
          const commonTypes = ["10001", "10002", "10003", "10004", "10005"];
          payload.issueType = commonTypes[0];
        }

        // Add entity linking information
        if (entityType && entityId) {
          switch (entityType) {
            case "testCase":
              payload.testCaseId = entityId.toString();
              break;
            case "session":
              payload.sessionId = entityId.toString();
              break;
            case "testRun":
              payload.testRunId = entityId.toString();
              break;
            case "testRunResult":
              payload.testRunResultId = entityId.toString();
              break;
            case "testRunStepResult":
              payload.testRunStepResultId = entityId.toString();
              break;
          }
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (response.status === 401) {
          const errorData = await response.json();
          setAuthError(
            errorData.authUrl || errorData.error || errorData.message
          );
          return;
        }

        if (!response.ok) {
          const error = await response.json();
          // Check if it's an authentication issue
          if (
            error.message &&
            error.message.includes("authentication required")
          ) {
            setAuthError(error.message);
            return;
          }
          throw new Error(
            error.error || error.message || "Failed to create issue"
          );
        }

        issue = await response.json();
      }

      toast.success(t("issues.created"), {
        description:
          useIntegration && activeIntegration
            ? t("issues.createdInExternal", {
                provider: activeIntegration.integration.provider,
              })
            : isSimpleUrlIntegration
              ? t("issues.createdInternalSimpleUrl")
              : t("issues.createdInternal"),
      });

      onIssueCreated?.(issue);
      onOpenChange(false);
      form.reset();
      setCustomFieldValues({});
    } catch (error: any) {
      toast.error(t("common.errors.error"), {
        description: error.message || t("issues.createError"),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleAuthenticate = (authUrl: string) => {
    // Open OAuth window
    const width = 600;
    const height = 700;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    window.open(
      authUrl,
      "_blank",
      `width=${width},height=${height},left=${left},top=${top}`
    );
  };

  const renderField = (field: any) => {
    // Handle different field types
    if (field.allowedValues && field.allowedValues.length > 0) {
      // Dropdown field
      return (
        <Select
          value={customFieldValues[field.key] || ""}
          onValueChange={(value) =>
            setCustomFieldValues((prev) => ({ ...prev, [field.key]: value }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder={`Select ${field.name}`} />
          </SelectTrigger>
          <SelectContent>
            {field.allowedValues.map((option: any) => (
              <SelectItem
                key={option.id || option.value}
                value={option.id || option.value}
              >
                {option.name || option.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    } else if (field.schema?.type === "array") {
      // Multi-select or tags field
      return (
        <Input
          id={field.key}
          placeholder={`Enter ${field.name} (comma-separated)`}
          value={customFieldValues[field.key]?.join(", ") || ""}
          onChange={(e) => {
            const values = e.target.value
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v);
            setCustomFieldValues((prev) => ({ ...prev, [field.key]: values }));
          }}
        />
      );
    } else if (field.schema?.type === "number") {
      // Number field
      return (
        <Input
          id={field.key}
          type="number"
          value={customFieldValues[field.key] || ""}
          onChange={(e) =>
            setCustomFieldValues((prev) => ({
              ...prev,
              [field.key]: e.target.value ? Number(e.target.value) : null,
            }))
          }
        />
      );
    } else {
      // Default to text input
      return (
        <Input
          id={field.key}
          value={customFieldValues[field.key] || ""}
          onChange={(e) =>
            setCustomFieldValues((prev) => ({
              ...prev,
              [field.key]: e.target.value,
            }))
          }
        />
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("issues.createIssue")}</DialogTitle>
          <DialogDescription>
            {activeIntegration && !isSimpleUrlIntegration
              ? t("issues.createIssueDescriptionWithIntegration", {
                  provider: activeIntegration.integration.provider,
                })
              : isSimpleUrlIntegration
                ? t("issues.createIssueDescriptionSimpleUrl")
                : t("issues.createIssueDescription")}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              // This dialog is portaled but remains a React descendant of the
              // page's edit form (e.g. repository case details). React events
              // bubble through the portal up the React tree, so without this the
              // inner submit also triggers the outer form's onSubmit. Stop it
              // here so "Create" only creates the issue.
              e.stopPropagation();
              void form.handleSubmit(onSubmit as any)(e);
            }}
            className="space-y-4"
          >
            {/* Removed integration status display - was causing rendering issues */}

            {authError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("issues.authenticationRequired")}</AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>{t("issues.authRequiredDescription")}</span>
                  {(authError.startsWith("http") ||
                    authError.startsWith("/")) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAuthenticate(authError)}
                    >
                      {t("issues.authenticate")}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Check if external integration is configured */}
            {useIntegration &&
              activeIntegration &&
              !authError &&
              !isIntegrationConfigured && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>
                    {t("issues.integrationNotConfigured")}
                  </AlertTitle>
                  <AlertDescription>
                    {t("issues.integrationNotConfiguredDescription")}
                  </AlertDescription>
                </Alert>
              )}

            {/* Project selector — only shown when 2+ active IntegrationProject records exist (D-09) */}
            {useIntegration &&
              activeIntegration &&
              !authError &&
              integrationProjects &&
              integrationProjects.length >= 2 && (
                <div className="space-y-2">
                  <Label>{t("issues.projectSelectorLabel")}</Label>
                  <Select
                    value={selectedProjectId || ""}
                    onValueChange={(value) => setSelectedProjectId(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("issues.selectProject")} />
                    </SelectTrigger>
                    <SelectContent>
                      {integrationProjects.map((ip) => (
                        <SelectItem key={ip.id} value={ip.id}>
                          {ip.externalProjectName} {"("}
                          {ip.externalProjectKey}
                          {")"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

            {/* Only show issue type selector for providers that support it (not GitHub) */}
            {useIntegration &&
              activeIntegration &&
              !authError &&
              activeIntegration.integration?.provider !== "GITHUB" &&
              activeIntegration.integration?.provider !== "GITEA" &&
              isIntegrationConfigured && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("issues.issueType")}
                  </label>
                  <AsyncCombobox
                    value={selectedIssueType}
                    onValueChange={setSelectedIssueType}
                    fetchOptions={fetchIssueTypes}
                    renderOption={(type) => type.name}
                    getOptionValue={(type) => type.id}
                    placeholder={t("issues.selectIssueType")}
                    className="w-full"
                    showTotal
                  />
                </div>
              )}

            {isSimpleUrlIntegration && (
              <FormField
                control={form.control as any}
                name="externalId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="inline-flex items-center gap-0.5">
                      {t("common.fields.id")}
                      <sup>
                        <Asterisk className="w-3 h-3 text-destructive" />
                      </sup>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("common.placeholders.issueIdExample")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control as any}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.fields.title")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control as any}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.fields.description")}</FormLabel>
                  {isInitialDescriptionDoc && (
                    <p
                      data-testid="iteration-context-hint"
                      className="text-xs text-muted-foreground"
                    >
                      {t("issues.iterationContextHint")}
                    </p>
                  )}
                  <FormControl>
                    <Textarea {...field} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {["JIRA", "AZURE_DEVOPS"].includes(
              activeIntegration?.integration?.provider ?? ""
            ) && (
              <FormField
                control={form.control as any}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.fields.priority")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="low">
                          {t("common.priority.low")}
                        </SelectItem>
                        <SelectItem value="medium">
                          {t("common.priority.medium")}
                        </SelectItem>
                        <SelectItem value="high">
                          {t("common.priority.high")}
                        </SelectItem>
                        <SelectItem value="urgent">
                          {t("issues.priorityUrgent")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Dynamic fields based on issue type */}
            {loadingFields && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">
                  {t("common.loading")}
                </span>
              </div>
            )}

            {!loadingFields && issueTypeFields.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium">
                  {t("issues.additionalFields")}
                </h4>
                {issueTypeFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>
                      {field.name}
                      {field.required && (
                        <sup>
                          <Asterisk className="w-3 h-3 text-destructive" />
                        </sup>
                      )}
                    </Label>
                    {renderField(field)}
                  </div>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isCreating}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !isIntegrationConfigured}
              >
                {isCreating && <Loader2 className=" h-4 w-4 animate-spin" />}
                {t("common.actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
