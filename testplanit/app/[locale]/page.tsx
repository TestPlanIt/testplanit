"use client";

import { type NextPage } from "next";
import { useSession } from "next-auth/react";
import { useRouter, redirect } from "~/lib/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useMemo, useState, useRef, useEffect } from "react";
import {
  processProjectsWithEffectiveMembers,
  ProcessedProject,
} from "~/utils/projectUtils";

import { useFindManyUser, useFindManyProjects } from "~/lib/hooks";

import { Loading } from "@/components/Loading";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ProjectCard } from "@/components/ProjectCard";
import { NoProjectsCard } from "@/components/NoProjectsCard";
import { Boxes, ChevronLeft, ChevronRight } from "lucide-react";
import { UserDashboard } from "@/components/UserDashboard";
import { InitialPreferencesDialog } from "@/components/onboarding/InitialPreferencesDialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";

type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  access?: string | null;
};

const Welcome = ({ user }: { user: AuthUser }) => {
  const t = useTranslations();
  const router = useRouter();
  const { data: session } = useSession();
  const { data: allUsers, isLoading: isUsersLoading } = useFindManyUser({
    where: { isActive: true, isDeleted: false },
    select: { id: true, access: true },
  });

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const panelRef = useRef<React.ElementRef<typeof ResizablePanel>>(null);
  const [projectIssueCounts, setProjectIssueCounts] = useState<
    Record<number, number>
  >({});
  const [isLoadingIssueCounts, setIsLoadingIssueCounts] = useState(false);

  // ZenStack will automatically filter projects based on access rules
  // This includes explicit assignments AND projects with defaultAccessType: GLOBAL_ROLE
  const { data: projectsRaw, isLoading: isLoadingProjects } =
    useFindManyProjects(
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

  const processedProjectsData: ProcessedProject[] = useMemo(
    () => processProjectsWithEffectiveMembers(projectsRaw as any, allUsers),
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

  const projectsForCards = useMemo(() => {
    return processedProjectsData.map((project: any) => ({
      ...project,
      users: project.effectiveUserIds.map((id: string) => ({ userId: id })),
      _count: {
        ...project._count,
        issues: projectIssueCounts[project.id] ?? project._count?.issues ?? 0,
      },
    }));
  }, [processedProjectsData, projectIssueCounts]);

  // Check if projects data has actually loaded (not just loading state)
  // projectsRaw will be undefined while loading, array when loaded
  const hasLoadedProjects = projectsRaw !== undefined;

  if (!session || isUsersLoading || isLoadingProjects || !hasLoadedProjects) {
    return <Loading />;
  }

  const projectCount = Array.isArray(projectsForCards)
    ? projectsForCards.length
    : 0;

  const toggleCollapse = () => {
    setIsTransitioning(true);
    if (panelRef.current) {
      if (isCollapsed) {
        panelRef.current.expand();
      } else {
        panelRef.current.collapse();
      }
      setIsCollapsed(!isCollapsed);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  return (
    <main className="w-full">
      <InitialPreferencesDialog />
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="home-dashboard-panels"
        className="w-full"
      >
        <ResizablePanel
          order={1}
          ref={panelRef}
          defaultSize={50}
          collapsedSize={0}
          minSize={20}
          maxSize={80}
          collapsible
          onCollapse={() => setIsCollapsed(true)}
          onExpand={() => setIsCollapsed(false)}
          className={`${
            isTransitioning ? "transition-all duration-300 ease-in-out" : ""
          }`}
        >
          <UserDashboard />
        </ResizablePanel>
        <ResizableHandle withHandle className="w-1" />
        <div>
          <Button
            type="button"
            onClick={toggleCollapse}
            variant="secondary"
            className="p-0 -ml-1 rounded-l-none"
          >
            {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>
        <ResizablePanel order={2} defaultSize={50} minSize={20}>
          {(session?.user.access != "NONE" || projectCount === 0) && (
            <Card data-testid="dashboard-card" className="w-full h-full">
              <CardHeader id="your-projects-header">
                <CardTitle>
                  <div className="items-center justify-between text-primary text-xl md:text-2xl">
                    {t("home.dashboard.yourProjects")}
                  </div>
                </CardTitle>
                <div className="mb-2 flex items-center">
                  <Boxes className="w-5 h-5 mr-1" />
                  {t("home.dashboard.projects", { count: projectCount })}
                </div>
              </CardHeader>
              <CardContent>
                <div
                  id="your-projects"
                  className="grid grid-cols-[repeat(auto-fit,minmax(350px,1fr))] gap-4"
                >
                  {projectCount === 0 ? (
                    <NoProjectsCard isAdmin={session.user.access === "ADMIN"} />
                  ) : (
                    projectsForCards?.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        users={project.users}
                        isLoadingIssueCounts={isLoadingIssueCounts}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
};

const Home: NextPage = () => {
  const { data: session, status } = useSession();
  const locale = useLocale();

  if (status === "loading") {
    return null;
  }

  return (
    <div>
      {session?.user ? (
        <div className="text-foreground">
          <Welcome user={session.user} />
          <section className="mt-10"></section>
        </div>
      ) : (
        redirect({ href: "/signin", locale })
      )}
    </div>
  );
};

export default Home;
