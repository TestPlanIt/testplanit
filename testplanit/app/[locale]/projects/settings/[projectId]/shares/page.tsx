"use client";

import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ShareLinkList } from "@/components/share/ShareLinkList";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useFindFirstProjects } from "~/lib/hooks";

export default function ProjectSharesPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("reports.shareDialog.manageShares");
  const tCommon = useTranslations("common");

  // Fetch project data (allow global admin access or project assignment)
  const { data: project, isLoading: projectLoading } = useFindFirstProjects(
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

  // Access control check - must be ADMIN or PROJECTADMIN
  useEffect(() => {
    if (!projectLoading && project && session?.user) {
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

  // Wait for data to load
  if (projectLoading) {
    return <Loading />;
  }

  // Project not found after loading
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-100 h-full">
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
              <span>{t("title")}</span>
            </CardTitle>
          </div>
          <CardDescription className="uppercase">
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
