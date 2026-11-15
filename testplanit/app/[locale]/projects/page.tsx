"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useProjectCards } from "~/hooks/useProjectCards";
import { useRouter } from "~/lib/navigation";

import { Loading as LoadingComponent } from "@/components/Loading";
import { NoProjectsCard } from "@/components/NoProjectsCard";
import { ProjectCard } from "@/components/ProjectCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Boxes } from "lucide-react";

const Projects = () => {
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const t = useTranslations();
  const {
    projects: projectsForCards,
    members,
    stats,
    automationRunCounts,
    isFetched,
  } = useProjectCards();

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
  const projectCount = projectsForCards.length;

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
                <Boxes className="me-1 h-5 w-5" />
                {t("home.dashboard.projects", { count: projectCount })}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {projectsForCards.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                users={project.users}
                members={members}
                stats={stats[project.id]}
                automationRunCount={automationRunCounts[project.id] ?? 0}
              />
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
};

export default Projects;
