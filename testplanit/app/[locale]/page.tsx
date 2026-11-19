"use client";

import { type NextPage } from "next";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectCards } from "~/hooks/useProjectCards";
import {
  SETUP_CHECKLIST_OPEN_PARAM,
  useSetupChecklist,
} from "~/hooks/useSetupChecklist";
import { redirect } from "~/lib/navigation";

import { Loading } from "@/components/Loading";
import { NoProjectsCard } from "@/components/NoProjectsCard";
import { SetupChecklistCard } from "@/components/onboarding/SetupChecklistCard";
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

const Welcome = ({ user: _user }: { user: AuthUser }) => {
  const t = useTranslations();

  const { data: session } = useSession();
  const {
    projects: projectsForCards,
    members,
    stats,
    automationRunCounts,
    isFetched,
  } = useProjectCards();

  const isAdmin = session?.user.access === "ADMIN";
  // The Help menu's Setup Checklist entry opens the card even when all is done.
  const searchParams = useSearchParams();
  const setupChecklist = useSetupChecklist(isAdmin, {
    forceVisible: searchParams.has(SETUP_CHECKLIST_OPEN_PARAM),
  });

  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const panelRef = useRef<React.ElementRef<typeof ResizablePanel>>(null);

  if (!session || !isFetched) {
    return <Loading />;
  }

  const projectCount = projectsForCards.length;

  const setupChecklistCard = setupChecklist.visible ? (
    <SetupChecklistCard
      items={setupChecklist.items}
      doneCount={setupChecklist.doneCount}
      onDismiss={setupChecklist.dismiss}
      onMarkedChange={(key, marked) =>
        setupChecklist
          .setMarked(key, marked)
          .catch(() => toast.error(t("common.errors.somethingWentWrong")))
      }
      showDemoNote={projectsForCards.some((project) => project.isDemo)}
    />
  ) : null;

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
            className="-ms-1 rounded-s-none p-0"
            aria-label={
              isCollapsed
                ? t("common.actions.expand")
                : t("common.actions.collapse")
            }
          >
            {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>
        <ResizablePanel id="home-right" order={2} defaultSize={50} minSize={20}>
          {(session?.user.access != "NONE" || projectCount === 0) && (
            <Card data-testid="dashboard-card" className="h-full w-full">
              <CardHeader id="your-projects-header">
                <CardTitle>
                  <SectionHeader className="items-center justify-between">
                    {t("home.dashboard.yourProjects")}
                  </SectionHeader>
                </CardTitle>
                <div className="mb-2 flex items-center">
                  <Boxes className="me-1 h-5 w-5" />
                  {t("home.dashboard.projects", { count: projectCount })}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {/* Outside #your-projects: the welcome tour points at its first link. */}
                {setupChecklistCard}
                <div
                  id="your-projects"
                  className="grid grid-cols-[repeat(auto-fit,minmax(350px,1fr))] gap-4"
                >
                  {projectCount === 0 ? (
                    !setupChecklistCard && <NoProjectsCard isAdmin={isAdmin} />
                  ) : (
                    <>
                      {projectsForCards.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          users={project.users}
                          members={members}
                          stats={stats[project.id]}
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
