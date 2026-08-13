"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ApplicationArea } from "~/zenstack/models";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { DatasetCreateDialog } from "../datasets/dataset-create-dialog";
import { DatasetsList } from "../datasets/datasets-list";
import { JunitIterationPropertyForm } from "../junit/junit-iteration-property-form";

export default function ProjectParametersSettingsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const tDatasets = useTranslations("projects.settings.datasets");
  const tJunit = useTranslations("projects.settings.junitIterationProperties");
  const tParameters = useTranslations("projects.settings.parameters");
  const tCommon = useTranslations("common");

  const [createOpen, setCreateOpen] = useState(false);

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        junitIterationPropertyNames: true,
        assignedUsers: {
          where: { user: { id: session?.user?.id || "" } },
          select: { user: { select: { access: true } } },
        },
      },
    },
    { enabled: isAuthenticated }
  );

  // `isProjectAdmin` resolves the same ladder server-side
  // (`authorizeProjectAdminForProject`), including the PROJECTADMIN
  // must-be-assigned rule this guard used to spell out inline, plus the
  // project-creator and per-project "Project Admin" role tiers it missed.
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;

    if (!project || !isProjectAdmin) notFound();
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  if (isAuthLoading || projectLoading || permissionsLoading) {
    return <Loading />;
  }
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
    <main className="space-y-6">
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{tParameters("title")}</CardTitle>
            <HelpPopover helpKey="projectParameters" />
          </SectionHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card id="junit">
            <CardHeader>
              <CardTitle>{tParameters("tabJunit")}</CardTitle>
              <CardDescription>{tJunit("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <JunitIterationPropertyForm
                projectId={projectId}
                initialNames={
                  (project.junitIterationPropertyNames as
                    readonly string[] | undefined) ?? []
                }
              />
            </CardContent>
          </Card>

          <Card id="datasets">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{tDatasets("title")}</CardTitle>
                <Button
                  onClick={() => setCreateOpen(true)}
                  data-testid="dataset-create-button"
                  aria-label={tDatasets("newButton")}
                  className="group gap-0 transition-all duration-200 hover:gap-2"
                >
                  <CirclePlus className="h-4 w-4" />
                  <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                    {tDatasets("newButton")}
                  </span>
                </Button>
              </div>
              <CardDescription>{tDatasets("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <DatasetsList projectId={projectId} />
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <DatasetCreateDialog
        projectId={projectId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </main>
  );
}
