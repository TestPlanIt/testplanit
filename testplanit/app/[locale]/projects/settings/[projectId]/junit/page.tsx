"use client";

import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect } from "react";

import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useFindFirstProjects } from "~/lib/hooks";
import { JunitIterationPropertyForm } from "./junit-iteration-property-form";

/**
 * Project-scoped JUnit settings page (sibling to /webhooks, /integrations).
 *
 * Houses the iteration-property-name list — the set of `<property>` names
 * the import path (INT-02) reads on each `<testcase>` to find the
 * iteration index. Future JUnit-related project settings (e.g., custom
 * status mapping, format-specific overrides) can land here as additional
 * sections without restructuring the page.
 *
 * Access: same project-admin policy as the rest of project settings —
 * page-level gate is `session.user.access ∈ {ADMIN, PROJECTADMIN}`, and
 * the PUT endpoint (`/api/projects/[id]/junit-iteration-property-names`)
 * re-enforces.
 */
export default function ProjectJunitSettingsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const tCommon = useTranslations("common");
  const tAdminMenu = useTranslations("admin.menu");

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
    { enabled: isAuthenticated }
  );

  useEffect(() => {
    if (!projectLoading && project && session?.user) {
      const hasAccess =
        session.user.access === "ADMIN" ||
        session.user.access === "PROJECTADMIN";
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
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{tAdminMenu("junit")}</span>
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
          <JunitIterationPropertyForm
            projectId={projectId}
            initialNames={
              (project.junitIterationPropertyNames as readonly string[]) ?? []
            }
          />
        </CardContent>
      </Card>
    </main>
  );
}
