"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import { ChevronRight } from "lucide-react";
import {
  useFindFirstProjects,
  useFindManyLlmIntegration,
  useFindManyProjectLlmIntegration,
} from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LlmIntegrationsList } from "./llm-integrations-list";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Loading } from "@/components/Loading";
import { notFound } from "next/navigation";

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
            <CardTitle className="flex items-center gap-2">
              <Link
                href={`/projects/settings/${projectId}`}
                className="hover:underline"
              >
                {tCommon("tabs.settings")}
              </Link>
              <ChevronRight className="h-5 w-5" />
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

          {currentIntegration && (
            <Card>
              <CardHeader>
                <CardTitle>{t("currentModelSettings")}</CardTitle>
                <CardDescription>
                  {t("currentModelDescription", {
                    name: currentIntegration.llmIntegration.name,
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium">
                      {tCommon("fields.provider")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {currentIntegration.llmIntegration.provider.replace(
                        "_",
                        " "
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {tCommon("actions.status")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {currentIntegration.llmIntegration.status}
                    </p>
                  </div>
                  {currentIntegration.llmIntegration.llmProviderConfig && (
                    <>
                      <div>
                        <p className="text-sm font-medium">
                          {tGlobal("admin.llm.defaultModel")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {
                            currentIntegration.llmIntegration.llmProviderConfig
                              .defaultModel
                          }
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {t("monthlyBudget")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {`$${Number(
                            currentIntegration.llmIntegration.llmProviderConfig
                              .monthlyBudget || 0
                          ).toFixed(2)}`}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
