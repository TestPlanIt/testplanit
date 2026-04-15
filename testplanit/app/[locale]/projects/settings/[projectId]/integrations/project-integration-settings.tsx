"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Integration, ProjectIntegration } from "@prisma/client";
import { AlertCircle, Loader2, Save, Star, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useFindManyIntegrationProject,
  useUpdateIntegrationProject,
  useUpdateProjectIntegration,
  useUpsertIntegrationProject,
} from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";

interface ProjectIntegrationSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
}

interface ExternalProject {
  id: string;
  key: string;
  name: string;
}

interface IssueType {
  id: string;
  name: string;
}

export function ProjectIntegrationSettings({
  projectIntegration,
  integration,
}: ProjectIntegrationSettingsProps) {
  const t = useTranslations("projects.settings.integrations");
  const tGlobal = useTranslations();
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [_isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [externalProjects, setExternalProjects] = useState<ExternalProject[]>(
    []
  );
  const [config, _setConfig] = useState(
    (projectIntegration.config as Record<string, any>) || {}
  );
  const [needsAuth, setNeedsAuth] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedNewProjects, setSelectedNewProjects] = useState<
    ExternalProject[]
  >([]);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null
  );
  const [isAddingProjects, setIsAddingProjects] = useState(false);

  const { mutateAsync: updateProjectIntegration } =
    useUpdateProjectIntegration();

  const { data: integrationProjects, isLoading: isLoadingLinkedProjects } =
    useFindManyIntegrationProject({
      where: {
        projectIntegrationId: projectIntegration.id,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { externalProjectName: "asc" }],
    });

  const { mutateAsync: upsertIntegrationProject } =
    useUpsertIntegrationProject();
  const { mutateAsync: updateIntegrationProject } =
    useUpdateIntegrationProject();

  const loadExternalProjects = useCallback(async () => {
    setIsLoadingProjects(true);

    try {
      const response = await fetch(
        `/api/integrations/${integration.id}/projects`
      );

      if (response.status === 401) {
        setNeedsAuth(true);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load projects");
      }

      const data = await response.json();
      setExternalProjects(data.projects || []);
    } catch {
      toast.error(t("integration.loadProjectsError"));
    } finally {
      setIsLoadingProjects(false);
    }
  }, [integration.id, t]);

  const checkAuthAndLoadProjects = useCallback(async () => {
    // Check if user has auth for this integration
    const authResponse = await fetch(
      `/api/integrations/${integration.id}/auth/check`
    );

    if (!authResponse.ok) {
      setNeedsAuth(true);
      return;
    }

    loadExternalProjects();
  }, [integration.id, loadExternalProjects]);

  useEffect(() => {
    // Only check auth and load projects for integrations that support it
    if (integration.provider !== "SIMPLE_URL") {
      checkAuthAndLoadProjects();
    }
  }, [checkAuthAndLoadProjects, integration.provider]);

  const canSave = useMemo(() => {
    return true;
  }, []);

  const handleSaveSettings = async () => {
    setIsSaving(true);

    try {
      await updateProjectIntegration({
        where: {
          id: projectIntegration.id,
        },
        data: {
          config,
        },
      });

      toast.success(t("integration.settingsSaved"));
      router.refresh();
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(t("integration.saveSettingsError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAuthorize = () => {
    // Redirect to OAuth flow
    const params = new URLSearchParams({
      projectIntegrationId: projectIntegration.id,
      integrationId: integration.id.toString(),
      returnUrl: window.location.pathname,
    });

    window.location.href = `/api/integrations/oauth/${integration.provider.toLowerCase()}/auth?${params}`;
  };

  const handleSetDefault = async (id: string) => {
    try {
      // Unset current default first
      const currentDefault = integrationProjects?.find((ip) => ip.isDefault);
      if (currentDefault && currentDefault.id !== id) {
        await updateIntegrationProject({
          where: { id: currentDefault.id },
          data: { isDefault: false },
        });
      }
      // Set new default
      await updateIntegrationProject({
        where: { id },
        data: { isDefault: true },
      });
    } catch (error) {
      console.error("Failed to set default project:", error);
      toast.error(t("integration.saveSettingsError"));
    }
  };

  const handleRemoveProject = async (id: string) => {
    try {
      const removedProject = integrationProjects?.find((ip) => ip.id === id);
      await updateIntegrationProject({
        where: { id },
        data: { isActive: false },
      });
      setConfirmingRemoveId(null);

      // If removed project was default and others remain, set first remaining as default
      if (removedProject?.isDefault) {
        const remaining = integrationProjects?.filter(
          (ip) => ip.id !== id && ip.isActive
        );
        if (remaining && remaining.length > 0) {
          await updateIntegrationProject({
            where: { id: remaining[0].id },
            data: { isDefault: true },
          });
        }
      }
    } catch (error) {
      console.error("Failed to remove project:", error);
      toast.error(t("integration.saveSettingsError"));
    }
  };

  const handleAddProjects = async () => {
    if (selectedNewProjects.length === 0) return;
    setIsAddingProjects(true);

    try {
      const hasExistingLinkedProjects =
        integrationProjects && integrationProjects.length > 0;
      let isFirstProject = !hasExistingLinkedProjects;

      for (const project of selectedNewProjects) {
        await upsertIntegrationProject({
          where: {
            projectIntegrationId_externalProjectId: {
              projectIntegrationId: projectIntegration.id,
              externalProjectId: project.id,
            },
          },
          create: {
            projectIntegrationId: projectIntegration.id,
            externalProjectId: project.id,
            externalProjectKey: project.key,
            externalProjectName: project.name,
            isActive: true,
            isDefault: isFirstProject,
          },
          update: {
            isActive: true,
            isDefault: isFirstProject,
            externalProjectKey: project.key,
            externalProjectName: project.name,
          },
        });
        isFirstProject = false;
      }

      setSelectedNewProjects([]);
      setShowAddPanel(false);
    } catch (error: any) {
      console.error("Failed to add projects:", error);
      const message = error?.info?.message || error?.message || "Unknown error";
      toast.error(`${t("integration.saveSettingsError")}: ${message}`);
    } finally {
      setIsAddingProjects(false);
    }
  };

  // Projects that haven't been linked yet
  const availableToAdd = useMemo(() => {
    const linkedIds = new Set(
      integrationProjects?.map((ip) => ip.externalProjectId) || []
    );
    return externalProjects.filter((p) => !linkedIds.has(p.id));
  }, [externalProjects, integrationProjects]);

  if (needsAuth) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("integration.authorizationRequired")}</CardTitle>
          <CardDescription>
            {t("integration.authorizationRequiredDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t("integration.authorizationMessage")}
            </AlertDescription>
          </Alert>
          <Button onClick={handleAuthorize} className="mt-4">
            {t("integration.authorizeIntegration", { name: integration.name })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle>
            {t("integration.integrationSettings", { name: integration.name })}
          </CardTitle>
          <CardDescription>
            {t("integration.integrationSettingsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Show a simple message for SIMPLE_URL integrations */}
          {integration.provider === "SIMPLE_URL" && (
            <Alert>
              <AlertDescription>
                {t("integration.simpleUrlDescription")}
              </AlertDescription>
            </Alert>
          )}

          {/* Linked External Projects card for integrations that support it */}
          {integration.provider !== "SIMPLE_URL" && (
            <Card
              className={
                integrationProjects && integrationProjects.length > 0
                  ? "border-primary"
                  : undefined
              }
            >
              <CardHeader>
                <CardTitle className="text-base">
                  {t("integration.linkedProjects")}
                </CardTitle>
                <CardDescription>
                  {t("integration.linkedProjectsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isLoadingLinkedProjects ? (
                  <div className="space-y-2">
                    <div className="h-11 w-full animate-pulse rounded bg-muted" />
                    <div className="h-11 w-full animate-pulse rounded bg-muted" />
                    <div className="h-11 w-full animate-pulse rounded bg-muted" />
                  </div>
                ) : !integrationProjects || integrationProjects.length === 0 ? (
                  <div>
                    {!showAddPanel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowAddPanel(true);
                          if (externalProjects.length === 0) {
                            loadExternalProjects();
                          }
                        }}
                      >
                        {t("integration.addProjects")}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {integrationProjects?.map((ip) => (
                      <div
                        key={ip.id}
                        className="group rounded-md border px-3 py-2 space-y-2"
                      >
                        <div className="flex items-center gap-2 min-h-[36px]">
                          <span className="flex-1 text-sm font-medium">
                            {ip.externalProjectName}
                          </span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {ip.externalProjectKey}
                          </Badge>

                          {/* Sync status badge */}
                          {ip.syncStatus === "syncing" && (
                            <Badge variant="secondary">
                              {t("integration.syncStatusSyncing")}
                            </Badge>
                          )}
                          {ip.syncStatus === "completed" && (
                            <Badge className="bg-success text-success-foreground">
                              {t("integration.syncStatusCompleted")}
                            </Badge>
                          )}
                          {ip.syncStatus === "error" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="destructive">
                                  {t("integration.syncStatusError")}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>{ip.syncError}</TooltipContent>
                            </Tooltip>
                          )}

                          {/* Default star */}
                          {ip.isDefault ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Star className="h-4 w-4 fill-primary text-primary shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("integration.defaultIndicator")}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleSetDefault(ip.id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                  aria-label={t("integration.setAsDefault")}
                                >
                                  <Star className="h-4 w-4 text-muted-foreground" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("integration.setAsDefault")}
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {/* Remove button */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="destructive"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={() => setConfirmingRemoveId(ip.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("integration.removeProject")}
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {/* Per-project default issue type (Jira only) */}
                        {integration.provider === "JIRA" && (
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground whitespace-nowrap">
                              {t("integration.defaultIssueType")}
                            </Label>
                            <AsyncCombobox<IssueType>
                              value={
                                ip.defaultIssueType
                                  ? {
                                      id: ip.defaultIssueType,
                                      name:
                                        ip.defaultIssueTypeName ||
                                        ip.defaultIssueType,
                                    }
                                  : null
                              }
                              onValueChange={(value) => {
                                updateIntegrationProject({
                                  where: { id: ip.id },
                                  data: {
                                    defaultIssueType: value?.id || null,
                                    defaultIssueTypeName: value?.name || null,
                                  },
                                });
                              }}
                              fetchOptions={async (query, page, pageSize) => {
                                try {
                                  const response = await fetch(
                                    `/api/integrations/${integration.id}/issue-types?projectKey=${encodeURIComponent(ip.externalProjectKey)}`
                                  );
                                  if (response.ok) {
                                    const data = await response.json();
                                    const issueTypes = data.issueTypes || [];
                                    const filtered = query
                                      ? issueTypes.filter((type: any) =>
                                          type.name
                                            .toLowerCase()
                                            .includes(query.toLowerCase())
                                        )
                                      : issueTypes;
                                    const start = page * pageSize;
                                    return {
                                      results: filtered.slice(
                                        start,
                                        start + pageSize
                                      ),
                                      total: filtered.length,
                                    };
                                  }
                                } catch (error) {
                                  console.error(
                                    "Failed to fetch issue types:",
                                    error
                                  );
                                }
                                return { results: [], total: 0 };
                              }}
                              renderOption={(type) => type.name}
                              getOptionValue={(type) => type.id}
                              placeholder={t(
                                "integration.selectDefaultIssueType"
                              )}
                              className="flex-1 max-w-xs h-8 text-xs"
                              dropdownClassName="p-0 min-w-[250px] max-w-[350px]"
                            />
                          </div>
                        )}

                        {/* Inline remove confirmation */}
                        {confirmingRemoveId === ip.id && (
                          <div className="p-3 bg-muted rounded-md text-sm space-y-2">
                            <p>{t("integration.removeProjectConfirmation")}</p>
                            <div className="flex gap-2">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleRemoveProject(ip.id)}
                              >
                                {t("integration.confirmRemove")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmingRemoveId(null)}
                              >
                                {t("integration.keepProject")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Projects panel toggle */}
                {!showAddPanel &&
                  integrationProjects &&
                  integrationProjects.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddPanel(true);
                        if (externalProjects.length === 0) {
                          loadExternalProjects();
                        }
                      }}
                    >
                      {t("integration.addProjects")}
                    </Button>
                  )}

                {/* Add Projects inline panel */}
                {showAddPanel && (
                  <div className="border rounded-md p-3 space-y-3">
                    <MultiAsyncCombobox<ExternalProject>
                      value={selectedNewProjects}
                      onValueChange={setSelectedNewProjects}
                      fetchOptions={async (query, page, pageSize) => {
                        // Load external projects if not already loaded
                        if (externalProjects.length === 0) {
                          await loadExternalProjects();
                        }
                        const filtered = availableToAdd.filter(
                          (p) =>
                            !query ||
                            p.name
                              .toLowerCase()
                              .includes(query.toLowerCase()) ||
                            p.key.toLowerCase().includes(query.toLowerCase())
                        );
                        const start = page * pageSize;
                        return {
                          results: filtered.slice(start, start + pageSize),
                          total: filtered.length,
                        };
                      }}
                      renderOption={(project) => (
                        <span>
                          {project.name}{" "}
                          <span className="text-muted-foreground">
                            {"("}
                            {project.key}
                            {")"}
                          </span>
                        </span>
                      )}
                      getOptionValue={(project) => project.id}
                      getOptionLabel={(project) =>
                        `${project.name} (${project.key})`
                      }
                      placeholder={t("integration.addProjects")}
                      hideSelected
                    />

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleAddProjects}
                        disabled={
                          selectedNewProjects.length === 0 || isAddingProjects
                        }
                      >
                        {isAddingProjects ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        {t("integration.addSelected")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowAddPanel(false);
                          setSelectedNewProjects([]);
                        }}
                      >
                        {tGlobal("common.cancel")}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Automatic sync via webhooks is not yet implemented - hiding this option
          {integration.provider !== "SIMPLE_URL" && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="syncEnabled"
                  checked={config.syncEnabled || false}
                  onCheckedChange={(checked) =>
                    setConfig({ ...config, syncEnabled: !!checked })
                  }
                />
                <Label
                  htmlFor="syncEnabled"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {t("integration.automaticSync")}
                </Label>
                <HelpPopover helpKey="projects.settings.integrations.automaticSyncHelp" />
              </div>
            </div>
          )}
          */}

          {/* Only show save button if there are settings to save */}
          {integration.provider !== "SIMPLE_URL" && (
            <div className="flex justify-end">
              <Button
                onClick={handleSaveSettings}
                disabled={isSaving || !canSave}
              >
                {isSaving ? (
                  <Loader2 className=" h-4 w-4 animate-spin" />
                ) : (
                  <Save className=" h-4 w-4" />
                )}
                {tGlobal("admin.notifications.save")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
