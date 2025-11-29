"use client";

import React, { use, useState, useRef } from "react";
import { ImperativePanelHandle } from "react-resizable-panels";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useFindFirstProjects } from "~/lib/hooks";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ListTree,
  PlayCircle,
  Compass,
  TagsIcon,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ProjectHeader from "./ProjectHeader";
import MilestonesSection from "./MilestonesSection";
import RepositoryCasesSection from "./RepositoryCasesSection";
import SessionsSection from "./SessionsSection";
import TagsSection from "./TagsSection";
import TestRunsSection from "./TestRunsSection";
import { Loading } from "@/components/Loading";
import { useTranslations } from "next-intl";

interface ProjectOverviewProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const ProjectOverview: React.FC<ProjectOverviewProps> = ({ params }) => {
  const { projectId } = use(params);
  const { session, isLoading, isAuthenticated } = useRequireAuth();
  const t = useTranslations();

  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  const toggleLeftCollapse = () => {
    setIsTransitioning(true);
    if (leftPanelRef.current) {
      if (isLeftCollapsed) {
        leftPanelRef.current.expand();
      } else {
        leftPanelRef.current.collapse();
      }
      setIsLeftCollapsed(!isLeftCollapsed);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const toggleRightCollapse = () => {
    setIsTransitioning(true);
    if (rightPanelRef.current) {
      if (isRightCollapsed) {
        rightPanelRef.current.expand();
      } else {
        rightPanelRef.current.collapse();
      }
      setIsRightCollapsed(!isRightCollapsed);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const { data: project, isLoading: isLoadingProject } = useFindFirstProjects(
    {
      where: {
        AND: [{ id: parseInt(projectId) }, { isDeleted: false }],
      },
    },
    {
      enabled: isAuthenticated,
    }
  );

  // Wait for session to load
  if (isLoading) {
    return <Loading />;
  }

  // Wait for project data to load - this prevents the flash
  if (isLoadingProject) {
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

  return (
    <Card className="flex flex-col w-full min-w-[400px] h-full">
      <CardHeader>
        <ProjectHeader
          project={project}
          dateFormat={session?.user.preferences?.dateFormat}
        />
      </CardHeader>
      <CardContent className="h-full">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
          autoSaveId="project-overview-horizontal"
        >
          <ResizablePanel
            ref={leftPanelRef}
            defaultSize={40}
            minSize={20}
            maxSize={100}
            collapsedSize={0}
            collapsible
            onCollapse={() => setIsLeftCollapsed(true)}
            onExpand={() => setIsLeftCollapsed(false)}
            className={`${
              isTransitioning
                ? "transition-all duration-300 ease-in-out"
                : ""
            }`}
          >
            <MilestonesSection projectId={project.id} />
          </ResizablePanel>
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      type="button"
                      onClick={toggleLeftCollapse}
                      variant="secondary"
                      size="sm"
                      className={`p-0 transform ${
                        isLeftCollapsed
                          ? "rounded-l-none rotate-180"
                          : "rounded-r-none"
                      }`}
                    >
                      <ChevronLeft />
                    </Button>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div>
                    {isLeftCollapsed
                      ? t("projects.overview.panels.expandLeft")
                      : t("projects.overview.panels.collapseLeft")}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ResizableHandle withHandle className="w-1" />
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      type="button"
                      onClick={toggleRightCollapse}
                      variant="secondary"
                      size="sm"
                      className={`p-0 transform ${
                        isRightCollapsed
                          ? "rounded-l-none"
                          : "rounded-r-none rotate-180"
                      }`}
                    >
                      <ChevronLeft />
                    </Button>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div>
                    {isRightCollapsed
                      ? t("projects.overview.panels.expandRight")
                      : t("projects.overview.panels.collapseRight")}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ResizablePanel
            ref={rightPanelRef}
            defaultSize={60}
            minSize={20}
            maxSize={100}
            collapsedSize={0}
            collapsible
            onCollapse={() => setIsRightCollapsed(true)}
            onExpand={() => setIsRightCollapsed(false)}
            className={`${
              isTransitioning
                ? "transition-all duration-300 ease-in-out"
                : ""
            }`}
          >
            <div className="h-full overflow-auto pr-4">
              <Accordion
                type="multiple"
                defaultValue={[
                  "repository-cases",
                  "test-runs",
                  "sessions",
                  "tags",
                ]}
                className="space-y-2"
              >
                <AccordionItem
                  value="repository-cases"
                  className="border rounded-lg bg-card text-card-foreground shadow-sm"
                >
                  <AccordionTrigger className="px-6 py-4 hover:no-underline cursor-pointer">
                    <div className="flex items-center text-2xl font-semibold text-primary">
                      <ListTree className="mr-2 h-6 w-6" />
                      {t("projects.overview.testCaseRepository")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6">
                    <RepositoryCasesSection projectId={project.id} />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem
                  value="test-runs"
                  className="border rounded-lg bg-card text-card-foreground shadow-sm"
                >
                  <AccordionTrigger className="px-6 py-4 hover:no-underline cursor-pointer">
                    <div className="flex items-center text-2xl font-semibold text-primary">
                      <PlayCircle className="mr-2 h-6 w-6" />
                      {t("projects.overview.activeTestRuns")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6">
                    <TestRunsSection projectId={project.id} />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem
                  value="sessions"
                  className="border rounded-lg bg-card text-card-foreground shadow-sm"
                >
                  <AccordionTrigger className="px-6 py-4 hover:no-underline cursor-pointer">
                    <div className="flex items-center text-2xl font-semibold text-primary">
                      <Compass className="mr-2 h-6 w-6" />
                      {t("projects.overview.activeSessions")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6">
                    <SessionsSection projectId={project.id} />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem
                  value="tags"
                  className="border rounded-lg bg-card text-card-foreground shadow-sm"
                >
                  <AccordionTrigger className="px-6 py-4 hover:no-underline cursor-pointer">
                    <div className="flex items-center text-2xl font-semibold text-primary">
                      <TagsIcon className="mr-2 h-6 w-6" />
                      {t("projects.overview.tags")}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6 h-[400px]">
                    <TagsSection projectId={project.id} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </CardContent>
    </Card>
  );
};

export default ProjectOverview;
