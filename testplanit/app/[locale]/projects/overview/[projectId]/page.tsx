"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import {
  ChevronLeft,
  Compass,
  LinkIcon,
  ListTree,
  PlayCircle,
  TagsIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { use, useEffect, useRef, useState } from "react";
import { PanelImperativeHandle } from "react-resizable-panels";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import MilestonesSection from "./MilestonesSection";
import ProjectHeader from "./ProjectHeader";
import RepositoryCasesSection from "./RepositoryCasesSection";
import SessionsSection from "./SessionsSection";
import TagsSection from "./TagsSection";
import TestRunsSection from "./TestRunsSection";

interface ProjectOverviewProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Open sections persist here so the accordion survives a reload. */
const OPEN_SECTIONS_STORAGE_KEY = "tpi.projectOverview.openSections";

const DEFAULT_OPEN_SECTIONS = [
  "repository-cases",
  "test-runs",
  "sessions",
  "tags",
];

interface OverviewSectionProps {
  value: string;
  icon: LucideIcon;
  title: string;
  /** Right-justified "see all" link rendered on the header row. */
  seeAllHref?: string;
  seeAllLabel?: string;
  contentClassName?: string;
  children: React.ReactNode;
}

const OverviewSection: React.FC<OverviewSectionProps> = ({
  value,
  icon: Icon,
  title,
  seeAllHref,
  seeAllLabel,
  contentClassName,
  children,
}) => (
  <AccordionItem
    value={value}
    className="border rounded-lg bg-card text-card-foreground shadow-sm"
  >
    {/* Wraps to its own line — left-justified under the title — when narrow. */}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-4 bg-foreground/5 transition-colors hover:bg-foreground/10">
      <AccordionTrigger className="flex-none gap-2 p-0 bg-transparent hover:bg-transparent hover:no-underline cursor-pointer">
        <SectionHeader className="flex items-center gap-2 text-lg md:text-lg">
          <Icon className="h-5 w-5 shrink-0" />
          <CardTitle>{title}</CardTitle>
        </SectionHeader>
      </AccordionTrigger>
      {seeAllHref && seeAllLabel ? (
        <Link className="group text-sm text-muted-foreground" href={seeAllHref}>
          {seeAllLabel}
          <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
      ) : null}
    </div>
    <AccordionContent className={cn("px-6 pb-6", contentClassName)}>
      {children}
    </AccordionContent>
  </AccordionItem>
);

const ProjectOverview: React.FC<ProjectOverviewProps> = ({ params }) => {
  const { projectId } = use(params);
  const { session, isLoading, isAuthenticated } = useRequireAuth();
  const t = useTranslations();

  const [isLeftCollapsed, setIsLeftCollapsed] = useState<boolean>(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [openSections, setOpenSections] = useState<string[]>(
    DEFAULT_OPEN_SECTIONS
  );
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);

  // Read after mount (not during render) so server and first client render agree.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY);
      if (!stored) return;

      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setOpenSections(
          parsed.filter((v): v is string => typeof v === "string")
        );
      }
    } catch {
      // localStorage unavailable or malformed — keep the defaults.
    }
  }, []);

  const handleOpenSectionsChange = (values: string[]) => {
    setOpenSections(values);
    try {
      window.localStorage.setItem(
        OPEN_SECTIONS_STORAGE_KEY,
        JSON.stringify(values)
      );
    } catch {
      // Persistence is best-effort.
    }
  };

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

  const { data: project, isLoading: isLoadingProject } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: {
        AND: [{ id: parseInt(projectId) }, { isDeleted: false }],
      },
    },
    {
      enabled: isAuthenticated,
    }
  );

  const { data: repositoryCasesCount } = useClientQueries(
    schema
  ).repositoryCases.useCount(
    {
      where: {
        projectId: parseInt(projectId),
        isDeleted: false,
        isArchived: false,
      },
    },
    { enabled: isAuthenticated }
  );

  const { data: testRunsCount } = useClientQueries(schema).testRuns.useCount(
    {
      where: {
        projectId: parseInt(projectId),
        isDeleted: false,
        isCompleted: false,
      },
    },
    { enabled: isAuthenticated }
  );

  const { data: sessionsCount } = useClientQueries(schema).sessions.useCount(
    {
      where: {
        projectId: parseInt(projectId),
        isDeleted: false,
        isCompleted: false,
      },
    },
    { enabled: isAuthenticated }
  );

  // Scoped the same way the project tags page scopes its list, so the count
  // here matches what that page shows.
  const { data: tagsCount } = useClientQueries(schema).tags.useCount(
    {
      where: {
        isDeleted: false,
        OR: [
          {
            caseTags: {
              some: {
                case: { projectId: parseInt(projectId), isDeleted: false },
              },
            },
          },
          {
            testRuns: {
              some: { projectId: parseInt(projectId), isDeleted: false },
            },
          },
          {
            sessions: {
              some: { projectId: parseInt(projectId), isDeleted: false },
            },
          },
        ],
      },
    },
    { enabled: isAuthenticated }
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
          <PageTitle className="mb-2">
            {t("common.errors.projectNotFound")}
          </PageTitle>
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
            id="overview-left"
            order={1}
            ref={leftPanelRef}
            defaultSize={40}
            minSize={20}
            maxSize={100}
            collapsedSize={0}
            collapsible
            onCollapse={() => setIsLeftCollapsed(true)}
            onExpand={() => setIsLeftCollapsed(false)}
            className={`${
              isTransitioning ? "transition-all duration-300 ease-in-out" : ""
            }`}
          >
            <MilestonesSection projectId={project.id} />
          </ResizablePanel>
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button
                    type="button"
                    data-testid="collapse-left-panel"
                    onClick={toggleLeftCollapse}
                    variant="secondary"
                    size="sm"
                    className={`p-0 transform ${
                      isLeftCollapsed
                        ? "rounded-s-none rotate-180"
                        : "rounded-e-none"
                    }`}
                  >
                    <ChevronLeft />
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div>
                  {isLeftCollapsed
                    ? t("common.actions.expandLeftPanel")
                    : t("common.actions.collapseLeftPanel")}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <ResizableHandle withHandle className="w-1" />
          <div>
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
                        ? "rounded-s-none"
                        : "rounded-e-none rotate-180"
                    }`}
                  >
                    <ChevronLeft />
                  </Button>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div>
                  {isRightCollapsed
                    ? t("common.actions.expandRightPanel")
                    : t("common.actions.collapseRightPanel")}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <ResizablePanel
            id="overview-right"
            order={2}
            ref={rightPanelRef}
            defaultSize={60}
            minSize={20}
            maxSize={100}
            collapsedSize={0}
            collapsible
            onCollapse={() => setIsRightCollapsed(true)}
            onExpand={() => setIsRightCollapsed(false)}
            className={`${
              isTransitioning ? "transition-all duration-300 ease-in-out" : ""
            }`}
          >
            <div className="h-full overflow-auto pe-4">
              <Accordion
                type="multiple"
                value={openSections}
                onValueChange={handleOpenSectionsChange}
                className="space-y-2"
              >
                <OverviewSection
                  value="repository-cases"
                  icon={ListTree}
                  title={t("repository.title")}
                  seeAllHref={`/projects/repository/${project.id}`}
                  seeAllLabel={
                    repositoryCasesCount
                      ? t("projects.overview.seeAllTestCases", {
                          count: repositoryCasesCount,
                        })
                      : undefined
                  }
                >
                  <RepositoryCasesSection projectId={project.id} />
                </OverviewSection>

                <OverviewSection
                  value="test-runs"
                  icon={PlayCircle}
                  title={t("projects.overview.activeTestRuns")}
                  seeAllHref={`/projects/runs/${project.id}`}
                  seeAllLabel={
                    testRunsCount
                      ? t("projects.overview.seeAllActiveTestRuns", {
                          count: testRunsCount,
                        })
                      : undefined
                  }
                >
                  <TestRunsSection projectId={project.id} />
                </OverviewSection>

                <OverviewSection
                  value="sessions"
                  icon={Compass}
                  title={t("home.dashboard.activeSessions")}
                  seeAllHref={`/projects/sessions/${project.id}`}
                  seeAllLabel={
                    sessionsCount
                      ? t("projects.overview.seeAllActiveSessions", {
                          count: sessionsCount,
                        })
                      : undefined
                  }
                >
                  <SessionsSection projectId={project.id} />
                </OverviewSection>

                <OverviewSection
                  value="tags"
                  icon={TagsIcon}
                  title={t("common.fields.tags")}
                  seeAllHref={`/projects/tags/${project.id}`}
                  seeAllLabel={
                    tagsCount
                      ? t("projects.overview.seeAllTagsCount", {
                          count: tagsCount,
                        })
                      : undefined
                  }
                  contentClassName="h-[400px]"
                >
                  <TagsSection projectId={project.id} />
                </OverviewSection>
              </Accordion>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </CardContent>
    </Card>
  );
};

export default ProjectOverview;
