"use client";

import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useFindFirstProjects } from "~/lib/hooks";
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

  const { data: project, isLoading: projectLoading } = useFindFirstProjects(
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
    { enabled: isAuthenticated },
  );

  useEffect(() => {
    if (!projectLoading && project && session?.user) {
      const isAssignedToThisProject =
        Array.isArray(project.assignedUsers) &&
        project.assignedUsers.length > 0;
      const hasAccess =
        session.user.access === "ADMIN" ||
        (session.user.access === "PROJECTADMIN" && isAssignedToThisProject);
      if (!hasAccess) notFound();
    } else if (!projectLoading && !project && session?.user) {
      notFound();
    }
  }, [project, projectLoading, session]);

  if (isAuthLoading || projectLoading) {
    return <Loading />;
  }
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
    <main className="space-y-6">
      <Card id="junit">
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{tParameters("tabJunit")}</span>
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground pt-2">
            {tJunit("description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <JunitIterationPropertyForm
            projectId={projectId}
            initialNames={
              (project.junitIterationPropertyNames as
                | readonly string[]
                | undefined) ?? []
            }
          />
        </CardContent>
      </Card>

      <Card id="datasets">
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{tDatasets("title")}</span>
            </CardTitle>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              data-testid="dataset-create-button"
            >
              <Plus className="h-4 w-4" />
              {tDatasets("newButton")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground pt-2">
            {tDatasets("description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <DatasetsList projectId={projectId} />
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
