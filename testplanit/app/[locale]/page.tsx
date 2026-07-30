"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { type NextPage } from "next";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAutomationRunCounts } from "~/hooks/useAutomationRunCounts";
import { redirect } from "~/lib/navigation";
import {
  ProcessedProject,
  processProjectsWithEffectiveMembers,
} from "~/utils/projectUtils";

import { CreateFirstProjectCard } from "@/components/CreateFirstProjectCard";
import { Loading } from "@/components/Loading";
import { NoProjectsCard } from "@/components/NoProjectsCard";
import { InitialPreferencesDialog } from "@/components/onboarding/InitialPreferencesDialog";
import { ProjectCard } from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { UserDashboard } from "@/components/UserDashboard";
import { Boxes, ChevronLeft, ChevronRight } from "lucide-react";

type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  access?: string | null;
};

// The seeded sample project (db/seedDemoProject.ts) is identified only by its
// unique name. A workspace whose sole project is the Demo Project is treated as
// a fresh install and nudged to create a real project.
const DEMO_PROJECT_NAME = "Demo Project";

const Welcome = ({ user: _user }: { user: AuthUser }) => {
  const t = useTranslations();

  const { data: session } = useSession();
  const { data: allUsers, isLoading: isUsersLoading } = useClientQueries(
    schema
  ).user.useFindMany({
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
  const { data: projectsRaw, isLoading: isLoadingProjects } = useClientQueries(
    schema
  ).projects.useFindMany(
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

  const { counts: automationRunCounts } = useAutomationRunCounts(
    !!session?.user
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

    void fetchIssueCounts();
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

  const isAdmin = session.user.access === "ADMIN";

  // A fresh install still has the seeded Demo Project. Prompt admins to create
  // their own project while keeping the Demo Project visible to explore.
  const showGetStartedPrompt =
    isAdmin &&
    projectCount === 1 &&
    projectsForCards[0]?.name === DEMO_PROJECT_NAME;

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
          id="home-left"
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
            className="p-0 -ms-1 rounded-s-none"
          >
            {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>
        <ResizablePanel id="home-right" order={2} defaultSize={50} minSize={20}>
          {(session?.user.access != "NONE" || projectCount === 0) && (
            <Card data-testid="dashboard-card" className="w-full h-full">
              <CardHeader id="your-projects-header">
                <CardTitle>
                  <SectionHeader className="items-center justify-between">
                    {t("home.dashboard.yourProjects")}
                  </SectionHeader>
                </CardTitle>
                <div className="mb-2 flex items-center">
                  <Boxes className="w-5 h-5 me-1" />
                  {t("home.dashboard.projects", { count: projectCount })}
                </div>
              </CardHeader>
              <CardContent>
                <div
                  id="your-projects"
                  className="grid grid-cols-[repeat(auto-fit,minmax(350px,1fr))] gap-4"
                >
                  {projectCount === 0 ? (
                    <NoProjectsCard isAdmin={isAdmin} />
                  ) : (
                    <>
                      {showGetStartedPrompt && <CreateFirstProjectCard />}
                      {projectsForCards?.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          users={project.users}
                          isLoadingIssueCounts={isLoadingIssueCounts}
                          automationRunCount={
                            automationRunCounts[project.id] ?? 0
                          }
                        />
                      ))}
                    </>
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
