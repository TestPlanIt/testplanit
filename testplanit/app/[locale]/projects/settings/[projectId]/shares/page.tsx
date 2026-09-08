"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ShareLinkList } from "@/components/share/ShareLinkList";
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

export default function ProjectSharesPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("reports.shareDialog.manageShares");
  const tCommon = useTranslations("common");

  // Fetch project data (allow global admin access or project assignment)
  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
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
      enabled: status === "authenticated",
      retry: 3,
      retryDelay: 1000,
    }
  );

  // Project-admin authority, resolved server-side by
  // `authorizeProjectAdminForProject`: system ADMIN, the project's creator, a
  // holder of the per-project "Project Admin" role, or a system PROJECTADMIN
  // assigned to this project. Gating on `session.user.access` alone 404'd the
  // creator/role-holder tiers that the settings APIs already accept.
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  // Access control check - must hold project-admin authority here
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

  // Wait for data to load
  if (projectLoading || permissionsLoading) {
    return <Loading />;
  }

  // Project not found after loading
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-100 h-full">
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
            <CardTitle>{t("title")}</CardTitle>
            <HelpPopover helpKey="projectShares" />
          </SectionHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShareLinkList projectId={projectId} showProjectColumn={false} />
        </CardContent>
      </Card>
    </main>
  );
}
