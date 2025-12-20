"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  useFindFirstSessionVersions,
  useFindManySessionVersions,
  useFindManyWorkflows,
  useFindManyMilestones,
} from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loading } from "@/components/Loading";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { ChevronLeft, LinkIcon, Minus, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Link } from "~/lib/navigation";
import { SessionVersionRenderer } from "./SessionVersionRenderer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DateFormatter } from "@/components/DateFormatter";
import { VersionNavigation } from "@/components/VersionNavigation";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { useTranslations } from "next-intl";

// Utility functions for cookies
function getCookie(name: string) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift();
  return null;
}

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/`;
}

const getInitialPanelRightWidth = () => {
  const storedWidth = getCookie("sessionDetailsPanelWidth");
  return storedWidth ? parseInt(storedWidth, 10) : 100;
};

// Helper functions for sorting version data
const sortByName = (a: any, b: any) => {
  const aName = typeof a === "string" ? a : a.name;
  const bName = typeof b === "string" ? b : b.name;
  return aName.localeCompare(bName);
};

const sortVersionData = {
  tags: (tags: any[]) => [...tags].sort(sortByName),
  attachments: (attachments: any[]) => [...attachments].sort(sortByName),
};

export default function SessionVersionPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { projectId, sessionId, version } = useParams();
  const [isCollapsedRight, setIsCollapsedRight] = useState<boolean>(false);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [panelRightWidth, setPanelRightWidth] = useState<number>(
    getInitialPanelRightWidth()
  );
  const panelRightRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);
  const panelLeftRef = useRef<React.ComponentRef<typeof ResizablePanel>>(null);
  const t = useTranslations();

  const { data: currentVersion, isLoading } = useFindFirstSessionVersions({
    where: {
      sessionId: Number(sessionId),
      version: Number(version),
    },
  });

  const { data: versions } = useFindManySessionVersions({
    where: { sessionId: Number(sessionId) },
    orderBy: { version: "desc" },
  });

  const currentVersionIndex = versions?.findIndex(
    (v) => v.version === Number(version)
  );

  const previousVersionNumber =
    currentVersionIndex !== undefined &&
    currentVersionIndex < (versions?.length ?? 0) - 1
      ? (versions?.[currentVersionIndex + 1]?.version ?? null)
      : null;

  const { data: previousVersion } = useFindFirstSessionVersions({
    where: {
      sessionId: Number(sessionId),
      version: previousVersionNumber || -1,
    },
  });

  const currentTags = currentVersion?.tags
    ? JSON.parse(currentVersion.tags as string)
    : [];
  const previousTags = previousVersion?.tags
    ? JSON.parse(previousVersion.tags as string)
    : [];

  // Parse attachments from JSON string
  const currentAttachments = currentVersion?.attachments
    ? JSON.parse(currentVersion.attachments as string)
    : [];
  const previousAttachments = previousVersion?.attachments
    ? JSON.parse(previousVersion.attachments as string)
    : [];

  // Sort data for consistent display
  const sortedCurrentTags = sortVersionData.tags(currentTags);
  const sortedPreviousTags = sortVersionData.tags(previousTags);
  const sortedCurrentAttachments =
    sortVersionData.attachments(currentAttachments);
  const sortedPreviousAttachments =
    sortVersionData.attachments(previousAttachments);

  const { data: workflows } = useFindManyWorkflows({
    where: { isDeleted: false },
    orderBy: { order: "asc" },
    include: {
      icon: true,
      color: true,
      projects: {
        select: {
          projectId: true,
          project: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  const { data: milestones } = useFindManyMilestones({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
    },
    include: {
      milestoneType: {
        include: {
          icon: true,
        },
      },
    },
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const toggleCollapseRight = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsTransitioning(true);
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
        setCookie("sessionDetailsPanelWidth", "0.1", 30);
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const toggleCollapseLeft = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsTransitioning(true);
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
        setCookie("sessionDetailsPanelWidth", "100", 30);
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const handleResize = async (size: number) => {
    setPanelRightWidth(size);
    setCookie(
      "sessionDetailsPanelWidth",
      parseInt(size.toString()).toString(),
      90
    );
  };

  const handleVersionChange = (newVersion: string) => {
    router.push(`/projects/sessions/${projectId}/${sessionId}/${newVersion}`);
  };

  const goToPreviousVersion = () => {
    if (currentVersionIndex !== undefined && currentVersionIndex > 0) {
      const prevIndex = currentVersionIndex - 1;
      handleVersionChange(versions![prevIndex].version.toString());
    }
  };

  const goToNextVersion = () => {
    if (
      currentVersionIndex !== undefined &&
      versions !== undefined &&
      currentVersionIndex < versions.length - 1
    ) {
      const nextIndex = currentVersionIndex + 1;
      handleVersionChange(versions[nextIndex].version.toString());
    }
  };

  if (status === "loading" || isLoading) return <Loading />;

  if (!currentVersion) {
    router.push(`/projects/sessions/${projectId}/${sessionId}`);
    return (
      <div className="text-muted-foreground text-center p-4">
        <div>{t("sessions.version.notFound")}</div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="w-full pr-4 mr-4">
            {(() => {
              const hasNameChanged =
                currentVersion?.name !== previousVersion?.name;
              const showNameDiff =
                hasNameChanged && previousVersion?.name !== undefined;
              return (
                <div className="space-y-2">
                  <div
                    className={`text-xl md:text-2xl flex items-center gap-1 w-fit
                    ${showNameDiff ? "text-green-600 bg-green-100 p-2 rounded" : ""}`}
                  >
                    {showNameDiff && (
                      <span>
                        <Plus className="w-4 h-4" />
                      </span>
                    )}
                    {currentVersion?.name}
                  </div>
                  {showNameDiff && (
                    <div className="text-xl md:text-2xl flex items-center gap-1 text-red-600 bg-red-100 p-2 rounded w-fit">
                      <span>
                        <Minus className="w-4 h-4" />
                      </span>
                      {previousVersion?.name}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardTitle>
          <div className="flex items-center space-x-2 w-fit">
            {versions?.length && versions.length > 1 && (
              <>
                <Select
                  value={version?.toString()}
                  onValueChange={handleVersionChange}
                >
                  <SelectTrigger className="w-fit">
                    <SelectValue
                      placeholder={t("sessions.version.selectVersion")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {versions?.map((v) => (
                      <SelectItem key={v.version} value={v.version.toString()}>
                        <div className="flex items-center space-x-1 whitespace-nowrap">
                          <Badge className="text-primary-foreground text-xs">
                            {t("common.version.prefix")}
                            {v.version.toString()}{" "}
                          </Badge>
                          <div className="text-xs flex">
                            <DateFormatter
                              date={v.createdAt}
                              formatString={
                                session?.user.preferences?.dateFormat +
                                " " +
                                session?.user.preferences?.timeFormat
                              }
                              timezone={session?.user.preferences?.timezone}
                            />
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <VersionNavigation
                  versions={versions}
                  currentVersion={version?.toString() || ""}
                  currentVersionIndex={currentVersionIndex}
                  onPrevVersion={goToPreviousVersion}
                  onNextVersion={goToNextVersion}
                  backHref={`/projects/sessions/${projectId}/${sessionId}`}
                  backTitle={t("sessions.version.backToSession")}
                />
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResizablePanelGroup
          direction="horizontal"
          className="min-h-[600px] rounded-lg border"
          autoSaveId="session-version-panels"
        >
          <ResizablePanel
            ref={panelLeftRef}
            defaultSize={80}
            minSize={30}
            collapsible
            onCollapse={() => setIsCollapsedLeft(true)}
            onExpand={() => setIsCollapsedLeft(false)}
          >
            <div className="space-y-4 p-4">
              {/* Description */}
              <SessionVersionRenderer
                currentValue={
                  typeof currentVersion.note === "string"
                    ? JSON.parse(currentVersion.note)
                    : currentVersion.note
                }
                previousValue={previousVersion?.note}
                fieldType="editor"
                field={t("issues.description")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />
              {/* Mission */}
              <SessionVersionRenderer
                currentValue={
                  typeof currentVersion.mission === "string"
                    ? JSON.parse(currentVersion.mission)
                    : currentVersion.mission
                }
                previousValue={previousVersion?.mission}
                fieldType="editor"
                field={t("common.fields.mission")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
            </div>
          </ResizablePanel>

          {/* Panel controls */}
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={toggleCollapseLeft}
                    variant="secondary"
                    size="sm"
                    className={`p-0 transform ${
                      isCollapsedLeft
                        ? "rounded-l-none rotate-180"
                        : "rounded-r-none"
                    }`}
                  >
                    <ChevronLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isCollapsedLeft
                    ? t("common.actions.expandLeftPanel")
                    : t("common.actions.collapseLeftPanel")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <ResizableHandle withHandle className="w-1" />

          {/* Right panel controls */}
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={toggleCollapseRight}
                    variant="secondary"
                    size="sm"
                    className={`p-0 transform ${
                      isCollapsedRight
                        ? "rounded-l-none"
                        : "rounded-r-none rotate-180"
                    }`}
                  >
                    <ChevronLeft />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isCollapsedRight
                    ? t("common.actions.expandRightPanel")
                    : t("common.actions.collapseRightPanel")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <ResizablePanel
            ref={panelRightRef}
            defaultSize={panelRightWidth}
            onResize={handleResize}
            collapsedSize={0}
            minSize={0}
            collapsible
            onCollapse={() => setIsCollapsedRight(true)}
            onExpand={() => setIsCollapsedRight(false)}
          >
            <div className="space-y-4 p-2">
              {/* Completed Status */}
              <SessionVersionRenderer
                currentValue={currentVersion.isCompleted}
                previousValue={null}
                fieldType="completed"
                field={t("common.actions.status")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              {/* State */}
              <SessionVersionRenderer
                currentValue={currentVersion.stateName}
                previousValue={previousVersion?.stateName}
                fieldType="state"
                field={t("common.fields.state")}
                testSession={currentVersion}
                workflows={workflows}
              />
              <Separator className="my-4" />
              {/* Template */}
              <SessionVersionRenderer
                currentValue={currentVersion.templateName}
                previousValue={previousVersion?.templateName}
                fieldType="text"
                field={t("common.fields.template")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />
              {/* Configuration */}
              <SessionVersionRenderer
                currentValue={currentVersion.configurationName}
                previousValue={previousVersion?.configurationName}
                fieldType="text"
                field={t("common.fields.configuration")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />
              {/* Milestone */}
              <SessionVersionRenderer
                currentValue={currentVersion.milestoneName}
                previousValue={previousVersion?.milestoneName}
                fieldType="text"
                field={t("common.fields.milestone")}
                testSession={currentVersion}
                milestones={milestones}
              />
              <Separator className="my-4" />
              {/* Assigned To */}
              <SessionVersionRenderer
                currentValue={currentVersion.assignedToId}
                previousValue={previousVersion?.assignedToId}
                fieldType="user"
                field={t("common.fields.assignedTo")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />
              {/* Estimate */}
              <SessionVersionRenderer
                currentValue={currentVersion.estimate}
                previousValue={previousVersion?.estimate}
                fieldType="duration"
                field={t("common.fields.estimate")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              {/* Elapsed */}
              <SessionVersionRenderer
                currentValue={currentVersion.elapsed}
                previousValue={previousVersion?.elapsed}
                fieldType="duration"
                field={t("runs.summary.recentResultsElapsed")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />
              {/* Tags */}
              <SessionVersionRenderer
                currentValue={sortedCurrentTags}
                previousValue={sortedPreviousTags}
                fieldType="tags"
                field={t("tags.title")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />
              {/* Attachments */}
              <SessionVersionRenderer
                currentValue={sortedCurrentAttachments}
                previousValue={sortedPreviousAttachments}
                fieldType="attachments"
                field={t("common.fields.attachments")}
                testSession={currentVersion}
                projectId={Number(projectId)}
              />
              <Separator className="my-4" />

              <div className="mb-1 mr-6">
                <div className="font-bold mt-2">
                  {t("sessions.version.versionInfo.created", {
                    number: version?.toString() ?? 0,
                  })}
                </div>
                <div className="flex space-x-1">
                  <div>
                    <DateFormatter
                      date={currentVersion.createdAt}
                      formatString={
                        session?.user.preferences?.dateFormat +
                        " " +
                        session?.user.preferences?.timeFormat
                      }
                      timezone={session?.user.preferences?.timezone}
                    />
                  </div>
                  <div>{t("common.by")}</div>
                  <UserNameCell userId={currentVersion.createdById} />
                </div>
              </div>
              <Separator
                orientation="horizontal"
                className="mt-2 bg-primary/30"
              />
              {versions?.length && versions.length > 1 && (
                <>
                  <div className="mb-2 mr-6">
                    <div className="font-bold mt-2">
                      <Link
                        href={`/projects/sessions/${projectId}/${sessionId}`}
                        className="group"
                        title={t("sessions.version.backToLatest")}
                      >
                        {t("sessions.version.versionInfo.latestUpdated", {
                          number: versions[0].version,
                        })}
                        <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </Link>
                    </div>
                    <div className="flex space-x-1">
                      <div>
                        <DateFormatter
                          date={versions[0].createdAt}
                          formatString={
                            session?.user.preferences?.dateFormat +
                            " " +
                            session?.user.preferences?.timeFormat
                          }
                          timezone={session?.user.preferences?.timezone}
                        />
                      </div>
                      <div>{t("common.by")}</div>
                      <UserNameCell userId={versions[0].createdById} />
                    </div>
                  </div>
                  <Separator
                    orientation="horizontal"
                    className="mt-2 bg-primary/30"
                  />
                </>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </CardContent>
      <CardFooter className="text-xs">{t("sessions.version.title")}</CardFooter>
    </Card>
  );
}
