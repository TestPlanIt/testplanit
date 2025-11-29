"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useFindManyProjects, useFindManyUser } from "~/lib/hooks";
import { useTranslations } from "next-intl";
import {
  processProjectsWithEffectiveMembers,
  ProcessedProject,
} from "~/utils/projectUtils";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ProjectCard } from "@/components/ProjectCard";
import { NoProjectsCard } from "@/components/NoProjectsCard";
import { Boxes } from "lucide-react";
import { Loading as LoadingComponent } from "@/components/Loading";

const Projects = () => {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const t = useTranslations();
  const [projectIssueCounts, setProjectIssueCounts] = useState<Record<number, number>>({});
  const [isLoadingIssueCounts, setIsLoadingIssueCounts] = useState(false);

  const { data: allUsers } = useFindManyUser({
    where: { isActive: true, isDeleted: false },
    select: { id: true, access: true },
  });

  const {
    data: projectsRaw,
    isLoading: isProjectsLoading,
    isFetched,
  } = useFindManyProjects(
    {
      where: {
        isDeleted: false,
      },
      orderBy: [{ isCompleted: "asc" }, { name: "asc" }],
      include: {
        _count: {
          select: {
            milestones: { where: { isCompleted: false, isDeleted: false } },
            testRuns: { where: { isCompleted: false, isDeleted: false } },
            sessions: { where: { isCompleted: false, isDeleted: false } },
            repositoryCases: { where: { isDeleted: false } },
          },
        },
        assignedUsers: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true },
        },
        groupPermissions: {
          select: {
            accessType: true,
            group: {
              select: {
                assignedUsers: {
                  where: { user: { isActive: true, isDeleted: false } },
                  select: { userId: true },
                },
              },
            },
          },
        },
        defaultRole: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  // Only process projects data if it's actually loaded
  const processedProjectsData: ProcessedProject[] | undefined = useMemo(
    () =>
      projectsRaw
        ? processProjectsWithEffectiveMembers(projectsRaw as any, allUsers)
        : undefined,
    [projectsRaw, allUsers]
  );

  // Fetch accurate issue counts for all projects
  useEffect(() => {
    if (!processedProjectsData || processedProjectsData.length === 0) {
      setProjectIssueCounts({});
      return;
    }

    const fetchIssueCounts = async () => {
      setIsLoadingIssueCounts(true);
      try {
        const projectIds = processedProjectsData.map((p) => p.id);
        const response = await fetch("/api/projects/issue-counts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectIds }),
        });

        if (response.ok) {
          const data = await response.json();
          setProjectIssueCounts(data.counts || {});
        }
      } catch (error) {
        console.error("Failed to fetch project issue counts:", error);
      } finally {
        setIsLoadingIssueCounts(false);
      }
    };

    fetchIssueCounts();
  }, [processedProjectsData]);

  const projectsForCards = useMemo(
    () =>
      processedProjectsData?.map((project) => ({
        ...project,
        users: project.effectiveUserIds.map((id) => ({ userId: id })),
        _count: {
          ...project._count,
          issues: projectIssueCounts[project.id] ?? project._count?.issues ?? 0,
        },
      })) ?? undefined,
    [processedProjectsData, projectIssueCounts]
  );

  useEffect(() => {
    if (sessionStatus !== "loading" && !session?.user) {
      router.replace("/404");
    }
  }, [session, sessionStatus, router]);

  // Return loading spinner while loading session or projects
  // Use isFetched to ensure we don't show NoProjectsCard until the query has actually completed
  if (sessionStatus === "loading" || !session || !isFetched) {
    return <LoadingComponent />;
  }

  // Now we know the data has been fetched, check if we have projects
  const projectCount = projectsForCards?.length ?? 0;

  // Show NoProjectsCard only after we know the fetch completed
  if (projectCount === 0) {
    return (
      <main>
        <div className="container mx-auto p-4">
          <NoProjectsCard isAdmin={session.user.access === "ADMIN"} />
        </div>
      </main>
    );
  }

  return (
    <main>
      <div>
        <Card id="project-cards" data-testid="project-cards">
          <CardHeader>
            <CardTitle data-testid="projects-page-title">
              <div className="flex items-center">
                <Boxes className="w-5 h-5 mr-1" />
                {t("home.dashboard.projects", { count: projectCount })}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {projectsForCards?.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                users={project.users}
                isLoadingIssueCounts={isLoadingIssueCounts}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default Projects;
