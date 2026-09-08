"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { ReportBuilder } from "~/components/reports/ReportBuilder";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";

export default function ProjectReportsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("admin.menu");
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

  // Reports access is a per-project area permission, not a system access
  // level. ProjectMenu renders the Reports link off this same Reporting
  // grant, so gating the page on ADMIN/PROJECTADMIN 404'd every USER whose
  // effective project role carries Reporting. `useProjectPermissions`
  // resolves system admins and project admins to all-areas-granted, so they
  // keep the access they had.
  const { permissions: reportingPerms, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Reporting);
  const canSeeReports = !!(
    reportingPerms &&
    (reportingPerms.canAddEdit || reportingPerms.canDelete)
  );

  // Access control check - must hold Reporting permissions on this project
  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;

    if (!project || !canSeeReports) {
      notFound();
    }
  }, [project, projectLoading, permissionsLoading, canSeeReports, session]);

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
            <CardTitle>{t("reports")}</CardTitle>
            <HelpPopover helpKey="projectReports" />
          </SectionHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ReportBuilder mode="project" projectId={projectId} />
        </CardContent>
      </Card>
    </main>
  );
}
