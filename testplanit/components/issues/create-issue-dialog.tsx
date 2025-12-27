"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4";
import { Loader2, AlertCircle, ExternalLink } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/components/ui/use-toast";
import { useFindManyProjectIntegration } from "@/lib/hooks/project-integration";
import { useCreateIssue } from "@/lib/hooks/issue";
import { useSession } from "next-auth/react";
import { Label } from "@/components/ui/label";

const createIssueSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.string().optional().default("medium"),
  issueType: z.string().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
});

type CreateIssueFormValues = z.infer<typeof createIssueSchema>;

interface CreateIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  onIssueCreated?: (issue: any) => void;
  defaultValues?: Partial<CreateIssueFormValues>;
  entityType?:
    | "testCase"
    | "session"
    | "sessionResult"
    | "testRun"
    | "testRunResult"
    | "testRunStepResult";
  entityId?: number;
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
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
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

  const form = useForm<CreateIssueFormValues>({
    resolver: zodResolver(createIssueSchema) as any,
    defaultValues: {
      title: defaultValues?.title || "",
      description: defaultValues?.description || "",
      priority: defaultValues?.priority || "medium",
      issueType: defaultValues?.issueType || undefined,
      customFields: {},
    },
  });

  // ZenStack hook for creating issues
  const createIssue = useCreateIssue();

  // Fetch project integrations
  const { data: projectIntegrations, isLoading: loadingIntegrations } =
    useFindManyProjectIntegration({
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

  // Check if this is a Simple URL integration
  const isSimpleUrlIntegration =
    activeIntegration?.integration?.provider === "SIMPLE_URL";

  // Determine if we should use integration based on project configuration
  // For Simple URL integrations, we always create internal issues
  const useIntegration = !!activeIntegration && !isSimpleUrlIntegration;

  // Check if external integration is properly configured
  const isIntegrationConfigured = useMemo(() => {
    if (!useIntegration || !activeIntegration) return true; // Not using integration or no integration
    const config = activeIntegration.config as Record<string, any>;
    return !!(config?.externalProjectKey || config?.externalProjectId);
  }, [useIntegration, activeIntegration]);

  // Get default issue type from integration config
  const defaultIssueType = useMemo(() => {
    if (!activeIntegration?.config) return null;

    const config = activeIntegration.config as Record<string, any>;
    if (!config.defaultIssueType) return null;

    return {
      id: config.defaultIssueType,
      name: config.defaultIssueTypeName || config.defaultIssueType,
    };
  }, [activeIntegration?.config]);

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

    checkAuthStatus();
  }, [useIntegration, activeIntegration, checkAuth]);

  // Fetch issue type fields when issue type changes
  const fetchIssueTypeFields = useCallback(async () => {
    if (!selectedIssueType || !activeIntegration) return;

    setLoadingFields(true);
    try {
      const config = activeIntegration.config as Record<string, any>;
      const projectKey =
        config?.externalProjectKey || config?.externalProjectId || "";

      const response = await fetch(
        `/api/integrations/${activeIntegration.integrationId}/issue-type-fields?issueTypeId=${selectedIssueType.id}&projectKey=${encodeURIComponent(projectKey)}`
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
  }, [selectedIssueType, activeIntegration]);

  // Fetch fields when issue type changes
  useEffect(() => {
    if (selectedIssueType) {
      fetchIssueTypeFields();
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

        // Use ZenStack hook for Simple URL integrations to create internal issues
        const createData: any = {
          name: values.title, // Both name and title are required
          title: values.title,
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

        const payload: any = {
          projectId: projectId.toString(),
          title: values.title,
          description: values.description,
          priority: values.priority,
          customFields: customFieldValues,
          // Include internal TestPlanIt project ID for database storage
          testplanitProjectId: projectId,
        };

        if (useIntegration && activeIntegration) {
          // Use the project's configured external project ID from config
          const integrationConfig =
            (activeIntegration.config as Record<string, any>) || {};
          // projectId is the external project identifier (e.g., "owner/repo" for GitHub)
          payload.projectId =
            integrationConfig.externalProjectId ||
            integrationConfig.externalProjectKey ||
            "";
          // Use the selected issue type (only for providers that support it)
          if (selectedIssueType) {
            payload.issueType = selectedIssueType.id;
          } else if (activeIntegration.integration?.provider !== "GITHUB") {
            // Try common issue type IDs as fallback (for Jira, Azure DevOps, etc.)
            const commonTypes = ["10001", "10002", "10003", "10004", "10005"];
            payload.issueType = commonTypes[0];
          }
          // For GitHub, we don't need issue type - it doesn't have that concept
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

      toast({
        title: t("issues.created"),
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
      toast({
        title: t("common.errors.error"),
        description: error.message || t("issues.createError"),
        variant: "destructive",
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
            onSubmit={form.handleSubmit(onSubmit as any)}
            className="space-y-4"
          >
            {/* Removed integration status display - was causing rendering issues */}

            {authError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("issues.authenticationRequired")}</AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>{t("issues.authRequiredDescription")}</span>
                  {authError.startsWith("http") && (
                    <Button
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
              (() => {
                const config = activeIntegration.config as Record<string, any>;
                const hasExternalProject =
                  config?.externalProjectKey || config?.externalProjectId;

                if (!hasExternalProject) {
                  return (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>
                        {t("issues.integrationNotConfigured")}
                      </AlertTitle>
                      <AlertDescription>
                        {t("issues.integrationNotConfiguredDescription")}
                      </AlertDescription>
                    </Alert>
                  );
                }
                return null;
              })()}

            {/* Only show issue type selector for providers that support it (not GitHub) */}
            {useIntegration &&
              activeIntegration &&
              !authError &&
              activeIntegration.integration?.provider !== "GITHUB" &&
              (() => {
                const config = activeIntegration.config as Record<string, any>;
                const hasExternalProject =
                  config?.externalProjectKey || config?.externalProjectId;
                return hasExternalProject;
              })() && (
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

            <FormField
              control={form.control as any}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("common.fields.issues")}</FormLabel>
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
                  <FormControl>
                    <Textarea {...field} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                        <span className="text-destructive ml-1">{"*"}</span>
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
