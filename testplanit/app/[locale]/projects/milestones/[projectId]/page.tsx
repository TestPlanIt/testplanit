"use client";

import * as React from "react";
import { useEffect, useState, use } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { useFindFirstProjects, useFindManyMilestones } from "~/lib/hooks";
import { useTranslations } from "next-intl";
import { AddMilestoneModal } from "@/projects/milestones/[projectId]/AddMilestoneModal";
import MilestoneDisplay from "@/projects/milestones/[projectId]/MilestoneDisplay";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectIcon } from "@/components/ProjectIcon";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { Loading } from "@/components/Loading";

interface ProjectMilestonesProps {
  params: Promise<{ projectId: string }>;
}

const ProjectMilestones: React.FC<ProjectMilestonesProps> = ({ params }) => {
  const { projectId } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const [isClientLoading, setIsClientLoading] = useState(true);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();

  const { permissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(projectId, ApplicationArea.Milestones);
  const canAddEdit = permissions?.canAddEdit ?? false;

  const { data: project, isLoading: isLoadingProject } = useFindFirstProjects(
    {
      where: {
        AND: [
          {
            isDeleted: false,
          },
          { id: parseInt(projectId) },
        ],
      },
    },
    {
      enabled: isAuthenticated, // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );

  const { data: incompleteMilestones } = useFindManyMilestones({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isCompleted: false },
        { isDeleted: false },
      ],
    },
    orderBy: [
      { startedAt: "asc" },
      { completedAt: "asc" },
      { isStarted: "asc" },
    ],
    include: {
      milestoneType: { include: { icon: true } },
      children: {
        include: {
          milestoneType: true,
        },
      },
    },
  });

  const { data: completedMilestones } = useFindManyMilestones({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isCompleted: true },
        { isDeleted: false },
      ],
    },
    orderBy: [{ completedAt: "desc" }],
    include: {
      milestoneType: { include: { icon: true } },
      children: {
        include: {
          milestoneType: true,
        },
      },
    },
  });

  const isLoading =
    isAuthLoading ||
    isLoadingProject ||
    isClientLoading ||
    isLoadingPermissions;

  useEffect(() => {
    // Don't make routing decisions until session is loaded
    if (isAuthLoading) {
      return;
    }

    // Only redirect to 404 if we're sure the user doesn't have access
    if (!isLoadingProject && project === null && isAuthenticated) {
      router.push("/404");
      return;
    }

    if (project && typeof project !== "string") {
      setIsClientLoading(false);
    }
  }, [project, router, isAuthLoading, isAuthenticated, isLoadingProject]);

  // Wait for session to load
  if (isAuthLoading) {
    return <Loading />;
  }

  // Wait for all data to load - this prevents the flash
  if (isLoading) {
    return <Loading />;
  }

  // NOW check if project exists - only after loading is complete
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {t("common.errors.projectNotFound")}
          </h2>
          <p className="text-muted-foreground">
            {t("common.errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (session && session.user.access !== "NONE") {
    return (
      <Card className="flex w-full min-w-[400px]">
        <div className="flex-1 w-full">
          <CardHeader>
            <CardTitle>
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <div>
                  <CardTitle>
                    {t("common.fields.milestone", { count: 2 })}
                  </CardTitle>
                </div>
                {canAddEdit && (
                  <div>
                    <AddMilestoneModal />
                  </div>
                )}
              </div>
            </CardTitle>
            <CardDescription className="uppercase">
              <span className="flex items-center gap-2 uppercase shrink-0">
                <ProjectIcon iconUrl={project?.iconUrl} />
                {project?.name}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            <Tabs defaultValue="active">
              <TabsList className="w-full">
                <TabsTrigger value="active" className="w-1/2">
                  {t("common.status.active")}
                </TabsTrigger>
                <TabsTrigger value="completed" className="w-1/2">
                  {t("common.fields.completed")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="active">
                <div className="flex flex-col">
                  {incompleteMilestones?.length === 0 ? (
                    <div className="mt-4 text-center text-muted-foreground">
                      {t("milestones.empty.active")}
                    </div>
                  ) : (
                    <MilestoneDisplay
                      projectId={Number(projectId)}
                      milestones={
                        incompleteMilestones?.map((milestone) => ({
                          ...milestone,
                          children: [],
                        })) || []
                      }
                    />
                  )}
                </div>
              </TabsContent>
              <TabsContent value="completed">
                <div className="flex flex-col">
                  {completedMilestones?.length === 0 ? (
                    <div className="mt-4 text-center text-muted-foreground">
                      {t("milestones.empty.completed")}
                    </div>
                  ) : (
                    <MilestoneDisplay
                      projectId={Number(projectId)}
                      milestones={
                        completedMilestones?.map((milestone) => ({
                          ...milestone,
                          children: [],
                        })) || []
                      }
                    />
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </div>
      </Card>
    );
  }

  return null;
};

export default ProjectMilestones;
