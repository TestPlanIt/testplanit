"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import { ChevronRight } from "lucide-react";
import {
  useFindFirstProjects,
  useFindManyIntegration,
  useFindManyProjectIntegration,
} from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IntegrationsList } from "@/components/admin/integrations/integrations-list";
import { ProjectIntegrationSettings } from "./project-integration-settings";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Loading } from "@/components/Loading";
import { notFound } from "next/navigation";

export default function ProjectIntegrationsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("projects.settings.integrations");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

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
      enabled: isAuthenticated,
    }
  );

  // Fetch project integrations
  const { data: projectIntegrations, isLoading: projectIntegrationsLoading } =
    useFindManyProjectIntegration({
      where: {
        projectId,
        isActive: true,
      },
      include: {
        integration: true,
      },
    });

  // Get issue tracking integrations configured by admins
  const { data: integrations, isLoading: integrationsLoading } =
    useFindManyIntegration({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        provider: {
          in: ["JIRA", "GITHUB", "AZURE_DEVOPS", "SIMPLE_URL"],
        },
      },
      orderBy: {
        name: "asc",
      },
    });

  // Get current active integration for this project (filter for issue tracking types)
  const currentIntegration = projectIntegrations?.find(
    (pi: any) =>
      pi.isActive &&
      ["JIRA", "GITHUB", "AZURE_DEVOPS", "SIMPLE_URL"].includes(
        pi.integration.provider
      )
  );

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
              <span>{tGlobal("admin.menu.integrations")}</span>
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
              <CardTitle>{t("availableIntegrations")}</CardTitle>
              <CardDescription>{t("availableDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {integrations && integrations.length > 0 ? (
                <IntegrationsList
                  integrations={integrations}
                  projectId={projectId}
                  currentIntegration={currentIntegration}
                />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t("noIntegrationAssigned")}
                </div>
              )}
            </CardContent>
          </Card>

          {currentIntegration && (
            <ProjectIntegrationSettings
              projectIntegration={currentIntegration}
              integration={currentIntegration.integration}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
