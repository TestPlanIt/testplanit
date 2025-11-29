"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ProjectIntegration, Integration } from "@prisma/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, Save, RefreshCw, AlertCircle } from "lucide-react";
import { useRouter } from "~/lib/navigation";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { HelpPopover } from "@/components/ui/help-popover";
import { useUpdateProjectIntegration } from "~/lib/hooks";

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
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [externalProjects, setExternalProjects] = useState<ExternalProject[]>(
    []
  );
  const [config, setConfig] = useState(
    (projectIntegration.config as Record<string, any>) || {}
  );
  const [needsAuth, setNeedsAuth] = useState(false);
  const [selectedIssueType, setSelectedIssueType] = useState<IssueType | null>(
    config.defaultIssueType
      ? {
          id: config.defaultIssueType,
          name: config.defaultIssueTypeName || config.defaultIssueType,
        }
      : null
  );

  const { mutateAsync: updateProjectIntegration } =
    useUpdateProjectIntegration();

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
    } catch (error) {
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

        {/* Only show external project selection for integrations that support it */}
        {integration.provider !== "SIMPLE_URL" && (
          <div className="space-y-2 max-w-48">
            <div className="flex items-center">
              <Label htmlFor="externalProject">
                {t("integration.externalProject")}
              </Label>
              <HelpPopover helpKey="projects.settings.integrations.externalProjectHelp" />
            </div>
            <Select
              value={config.externalProjectId || ""}
              onValueChange={(value) => {
                const project = externalProjects.find((p) => p.id === value);
                setConfig({
                  ...config,
                  externalProjectId: value,
                  externalProjectKey: project?.key,
                  externalProjectName: project?.name,
                });
              }}
              disabled={isLoadingProjects}
            >
              <SelectTrigger id="externalProject">
                <SelectValue
                  placeholder={t("integration.selectExternalProject")}
                />
              </SelectTrigger>
              <SelectContent>
                {externalProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} {`(${project.key})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={loadExternalProjects}
              disabled={isLoadingProjects}
            >
              {isLoadingProjects ? (
                <Loader2 className=" h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className=" h-4 w-4" />
              )}
              {t("integration.refreshProjects")}
            </Button>
          </div>
        )}

        {integration.provider === "JIRA" && config.externalProjectId && (
          <div className="space-y-2">
            <div className="flex items-center">
              <Label htmlFor="defaultIssueType" className="block">
                {t("integration.defaultIssueType")}
              </Label>
              <HelpPopover helpKey="projects.settings.integrations.defaultIssueTypeHelp" />
            </div>
            <AsyncCombobox
              value={selectedIssueType}
              onValueChange={(value) => {
                setSelectedIssueType(value);
                setConfig({
                  ...config,
                  defaultIssueType: value?.id || undefined,
                  defaultIssueTypeName: value?.name || undefined,
                });
              }}
              fetchOptions={async (query, page, pageSize) => {
                try {
                  // Use the project key from current config state
                  const projectKey = config.externalProjectKey || config.externalProjectId;
                  if (!projectKey) {
                    return { results: [], total: 0 };
                  }

                  const response = await fetch(
                    `/api/integrations/${integration.id}/issue-types?projectKey=${encodeURIComponent(projectKey)}`
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
                  }
                } catch (error) {
                  console.error("Failed to fetch issue types:", error);
                }
                return { results: [], total: 0 };
              }}
              renderOption={(type) => type.name}
              getOptionValue={(type) => type.id}
              placeholder={t("integration.selectDefaultIssueType")}
              className="w-full max-w-xs"
              dropdownClassName="p-0 min-w-[300px] max-w-[400px]"
              showTotal
            />
          </div>
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
            <Button onClick={handleSaveSettings} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className=" h-4 w-4 animate-spin" />
              ) : (
                <Save className=" h-4 w-4" />
              )}
              {t("integration.saveSettings")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
