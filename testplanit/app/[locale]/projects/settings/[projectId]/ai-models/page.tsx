"use client";

import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import {
  useFindFirstProjects,
  useFindManyLlmIntegration,
  useFindManyProjectLlmIntegration,
  useUpdateProjects,
} from "~/lib/hooks";
import { useFindManyPromptConfig } from "~/lib/hooks/prompt-config";
import { FeatureOverrides } from "./feature-overrides";
import { LlmIntegrationsList } from "./llm-integrations-list";

export default function ProjectAiModelsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("projects.settings.aiModels");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();

  // Fetch project data (allow global admin access or project assignment)
  const { data: project, isLoading: projectLoading } = useFindFirstProjects(
    {
      where: {
        id: projectId,
      },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        promptConfigId: true,
        assignedUsers: {
          where: {
            user: {
              id: session?.user?.id || "",
            },
          },
          select: {
            user: {
              select: {
                access: true,
              },
            },
          },
        },
      },
    },
    {
      enabled: status === "authenticated", // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );

  // Fetch available LLM integrations
  const { data: llmIntegrations, isLoading: integrationsLoading } =
    useFindManyLlmIntegration({
      where: {
        isDeleted: false,
        status: "ACTIVE",
      },
      include: {
        llmProviderConfig: true,
      },
      orderBy: {
        name: "asc",
      },
    });

  // Fetch project LLM integrations
  const {
    data: projectLlmIntegrations,
    isLoading: projectIntegrationsLoading,
  } = useFindManyProjectLlmIntegration({
    where: {
      projectId,
      isActive: true,
    },
    include: {
      llmIntegration: {
        include: {
          llmProviderConfig: true,
        },
      },
    },
  });

  const currentIntegration = projectLlmIntegrations?.[0];

  // Fetch available prompt configurations
  const { data: promptConfigs } = useFindManyPromptConfig({
    where: { isDeleted: false, isActive: true },
    orderBy: { name: "asc" },
  });

  const { mutateAsync: updateProject } = useUpdateProjects();
  const [updatingPromptConfig, setUpdatingPromptConfig] = useState(false);

  const handlePromptConfigChange = async (value: string) => {
    setUpdatingPromptConfig(true);
    try {
      await updateProject({
        where: { id: projectId },
        data: {
          promptConfigId: value === "system-default" ? null : value,
        },
      });
      toast.success(t("promptConfigChanged"));
    } catch (error: any) {
      console.error("Error updating prompt config:", error);
      toast.error(tCommon("errors.error"), {
        description: error?.info?.message || error?.message,
      });
    } finally {
      setUpdatingPromptConfig(false);
    }
  };

  useEffect(() => {
    if (!projectLoading && project && session?.user) {
      // Check access to settings:
      // 1. System ADMIN users always have access
      // 2. System PROJECTADMIN users have access to any project they can see
      // 3. TODO: Users with Project Admin role on this specific project
      const hasAccess =
        session.user.access === "ADMIN" ||
        session.user.access === "PROJECTADMIN";

      if (!hasAccess) {
        notFound();
      }
    } else if (!projectLoading && !project && session?.user) {
      notFound();
    }
  }, [project, projectLoading, session]);

  // Wait for session to load
  if (isAuthLoading) {
    return <Loading />;
  }

  // Wait for all data to load - this prevents the flash
  if (projectLoading || integrationsLoading || projectIntegrationsLoading) {
    return <Loading />;
  }

  // NOW check if project exists - only after loading is complete
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {tCommon("errors.projectNotFound")}
          </h2>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{tGlobal("admin.menu.llm")}</span>
            </CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("availableModels")}</CardTitle>
              <CardDescription>
                {t("availableModelsDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {llmIntegrations && llmIntegrations.length > 0 ? (
                <LlmIntegrationsList
                  integrations={llmIntegrations}
                  projectId={projectId}
                  currentIntegration={currentIntegration}
                />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t("noModelsAvailable")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("promptConfig")}</CardTitle>
              <CardDescription>{t("promptConfigDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={project.promptConfigId || "system-default"}
                onValueChange={handlePromptConfigChange}
                disabled={updatingPromptConfig}
              >
                <SelectTrigger className="w-full md:w-100">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system-default">
                    {t("useSystemDefault")}
                  </SelectItem>
                  {promptConfigs?.map((config) => (
                    <SelectItem key={config.id} value={config.id}>
                      {config.name}
                      {config.isDefault && (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger className="ml-1" asChild>
                              <Badge variant="secondary">
                                <Star className="h-3 w-3 fill-current text-primary-background" />
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {tCommon("defaultOption")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <FeatureOverrides
            projectId={projectId}
            integrations={llmIntegrations ?? []}
            projectDefaultIntegration={currentIntegration}
            promptConfigId={project.promptConfigId ?? null}
          />
        </CardContent>
      </Card>
    </main>
  );
}
