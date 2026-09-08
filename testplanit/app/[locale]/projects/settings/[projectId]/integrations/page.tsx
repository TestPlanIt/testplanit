"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { IntegrationsList } from "@/components/admin/integrations/integrations-list";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect } from "react";
import { ApplicationArea } from "~/zenstack/models";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { MilestoneSyncSettings } from "./milestone-sync-settings";
import { ProjectIntegrationSettings } from "./project-integration-settings";

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
  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
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
    useClientQueries(schema).projectIntegration.useFindMany({
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
    useClientQueries(schema).integration.useFindMany({
      where: {
        isDeleted: false,
        status: "ACTIVE",
        provider: {
          in: [
            "JIRA",
            "GITHUB",
            "AZURE_DEVOPS",
            "GITLAB",
            "GITEA",
            "REDMINE",
            "MANTISBT",
            "SIMPLE_URL",
          ],
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
      [
        "JIRA",
        "GITHUB",
        "AZURE_DEVOPS",
        "GITLAB",
        "GITEA",
        "REDMINE",
        "MANTISBT",
        "SIMPLE_URL",
      ].includes(pi.integration.provider)
  );

  // Check access to settings. `isProjectAdmin` resolves the full ladder that
  // `authorizeProjectAdminForProject` enforces server-side:
  // 1. System ADMIN users always have access
  // 2. System PROJECTADMIN users, on projects they are assigned to
  // 3. Users with the Project Admin role on this specific project
  // 4. The project's creator
  // Tiers 3 and 4 were the standing TODO here, and 404'd until now.
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;

    if (!project || !isProjectAdmin) {
      notFound();
    }
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  // Wait for session to load
  if (isAuthLoading) {
    return <Loading />;
  }

  // Wait for all data to load - this prevents the flash
  if (
    projectLoading ||
    permissionsLoading ||
    integrationsLoading ||
    projectIntegrationsLoading
  ) {
    return <Loading />;
  }

  // NOW check if project exists - only after loading is complete
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <PageTitle className="mb-2">
            {tCommon("errors.projectNotFound")}
          </PageTitle>
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
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{tGlobal("admin.menu.integrations")}</CardTitle>
            <HelpPopover helpKey="projectIntegrations" />
          </SectionHeader>
          <CardDescription>
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
            <>
              <ProjectIntegrationSettings
                projectIntegration={currentIntegration}
                integration={currentIntegration.integration}
              />
              <MilestoneSyncSettings
                projectIntegration={currentIntegration}
                integration={currentIntegration.integration}
              />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
