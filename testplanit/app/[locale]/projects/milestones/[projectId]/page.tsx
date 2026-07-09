"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useQueryClient } from "@tanstack/react-query";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddMilestone } from "@/projects/milestones/[projectId]/AddMilestoneModal";
import { ImportMilestonesDialog } from "@/projects/milestones/[projectId]/ImportMilestonesDialog";
import MilestoneDisplay from "@/projects/milestones/[projectId]/MilestoneDisplay";
import { ApplicationArea } from "~/zenstack/models";
import { CirclePlus, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import * as React from "react";
import { use, useEffect, useRef, useState } from "react";
import { useProjectMilestoneStream } from "~/hooks/useMilestoneLiveStream";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";

/**
 * Providers whose adapter declares a non-`false` `milestones` capability
 * (`IssueAdapterCapabilities.milestones`). Mirrors the same client-safe map
 * used by `milestone-sync-settings.tsx` — source of truth is each adapter's
 * `getCapabilities()` in `lib/integrations/adapters/*Adapter.ts`.
 */
const MILESTONE_CAPABLE_PROVIDERS = new Set(["JIRA"]);

interface ProjectMilestonesProps {
  params: Promise<{ projectId: string }>;
}

const ProjectMilestones: React.FC<ProjectMilestonesProps> = ({ params }) => {
  const { projectId } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const [isClientLoading, setIsClientLoading] = useState(true);
  const [addMilestoneOpen, setAddMilestoneOpen] = useState(false);
  const [importMilestonesOpen, setImportMilestonesOpen] = useState(false);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();

  const { permissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(projectId, ApplicationArea.Milestones);
  const canAddEdit = permissions?.canAddEdit ?? false;
  const queryClient = useQueryClient();

  const { data: project, isLoading: isLoadingProject } = useClientQueries(
    schema
  ).projects.useFindFirst(
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

  // Import runs as a background queue job — the dialog closes when the job
  // is QUEUED, and the worker creates the Milestones rows seconds later.
  // Track the queued externalIds: while any are outstanding the milestone
  // queries poll (3s), an "Importing…" badge shows what's happening (D-03
  // feedback pattern), and when the last one lands we toast completion.
  // A 60s cap avoids polling forever if the worker is down — with a
  // "still running" notice so silence never reads as "nothing happened".
  const [pendingImportIds, setPendingImportIds] = useState<Set<string> | null>(
    null
  );
  const isImportPolling = pendingImportIds !== null;
  const isMilestonePolling = isImportPolling;
  const importPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const startImportPolling = React.useCallback((externalIds: string[]) => {
    setPendingImportIds(new Set(externalIds));
    if (importPollTimerRef.current) clearTimeout(importPollTimerRef.current);
    importPollTimerRef.current = setTimeout(() => {
      setPendingImportIds((prev) => {
        if (prev && prev.size > 0) {
          toast.info(t("milestones.import.stillRunning"));
        }
        return null;
      });
    }, 60_000);
  }, []);
  useEffect(
    () => () => {
      if (importPollTimerRef.current) clearTimeout(importPollTimerRef.current);
    },
    []
  );

  // D-15/D-16: one project-level SSE subscriber replaces the retired 45s
  // passive-refresh polling window above — a wake-up for any milestone in
  // this project invalidates the same incomplete/completed milestone
  // queries the polling window used to force-refetch.
  useProjectMilestoneStream({
    projectId: Number(projectId),
    onWakeUp: React.useCallback(() => {
      void queryClient.invalidateQueries({
        predicate: (query) =>
          JSON.stringify(query.queryKey).includes("Milestones"),
      });
    }, [queryClient]),
  });

  const { data: incompleteMilestones } = useClientQueries(
    schema
  ).milestones.useFindMany({
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
  },
  { refetchInterval: isMilestonePolling ? 3000 : false }
  );

  const { data: completedMilestones } = useClientQueries(
    schema
  ).milestones.useFindMany({
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
  },
  { refetchInterval: isMilestonePolling ? 3000 : false }
  );

  // Mark queued imports as landed once their externalIds show up in the
  // loaded milestone lists; toast completion when the last one arrives.
  useEffect(() => {
    if (!pendingImportIds || pendingImportIds.size === 0) return;
    const loadedExternalIds = new Set(
      [...(incompleteMilestones ?? []), ...(completedMilestones ?? [])]
        .map((m) => m.externalId)
        .filter((id): id is string => Boolean(id))
    );
    const stillPending = new Set(
      Array.from(pendingImportIds).filter((id) => !loadedExternalIds.has(id))
    );
    if (stillPending.size === pendingImportIds.size) return;
    if (stillPending.size === 0) {
      if (importPollTimerRef.current) clearTimeout(importPollTimerRef.current);
      setPendingImportIds(null);
      toast.success(
        t("milestones.import.completed", { count: pendingImportIds.size })
      );
    } else {
      setPendingImportIds(stillPending);
    }
  }, [incompleteMilestones, completedMilestones, pendingImportIds, t]);

  const isLoading =
    isAuthLoading ||
    isLoadingProject ||
    isClientLoading ||
    isLoadingPermissions;

  // MSYNC-04 (Blocker 3): distinct synced-integration ids present among the
  // loaded milestones, so the passive-refresh mount effect below fires ONE
  // project-level request per integration rather than one per milestone.
  const syncedIntegrationIds = React.useMemo(() => {
    const ids = new Set<number>();
    for (const milestone of [
      ...(incompleteMilestones ?? []),
      ...(completedMilestones ?? []),
    ]) {
      if (milestone.integrationId != null) {
        ids.add(milestone.integrationId);
      }
    }
    return Array.from(ids);
  }, [incompleteMilestones, completedMilestones]);

  // Resolve the active IntegrationProject (projectMappingId) for each
  // synced integration found above — the same mapping lookup
  // ImportMilestonesDialog's caller uses, reused here rather than
  // reinvented.
  const { data: syncedIntegrationProjects } = useClientQueries(
    schema
  ).integrationProject.useFindMany(
    {
      where: {
        isActive: true,
        projectIntegration: {
          projectId: Number(projectId),
          integrationId: { in: syncedIntegrationIds },
        },
      },
      select: {
        id: true,
        projectIntegration: { select: { integrationId: true } },
      },
    },
    { enabled: isAuthenticated && syncedIntegrationIds.length > 0 }
  );

  // Import from Jira trigger (MSYNC-02): find an active, milestone-sync
  // capable ProjectIntegration for this project with milestoneSync.enabled
  // in its config. Reuses the same capability list milestone-sync-settings.tsx
  // gates on, since adapters run server-side only.
  const { data: milestoneSyncIntegrations } = useClientQueries(
    schema
  ).projectIntegration.useFindMany(
    {
      where: {
        projectId: Number(projectId),
        isActive: true,
        integration: {
          isDeleted: false,
          provider: { in: Array.from(MILESTONE_CAPABLE_PROVIDERS) as any },
        },
      },
      select: {
        id: true,
        integrationId: true,
        config: true,
      },
    },
    { enabled: isAuthenticated }
  );

  const importCapableProjectIntegration = React.useMemo(() => {
    return (milestoneSyncIntegrations ?? []).find((pi) => {
      const config = (pi.config as Record<string, any>) || {};
      return config?.milestoneSync?.enabled === true;
    });
  }, [milestoneSyncIntegrations]);

  const { data: importIntegrationProjects } = useClientQueries(
    schema
  ).integrationProject.useFindMany(
    {
      where: {
        projectIntegrationId: importCapableProjectIntegration?.id,
        isActive: true,
      },
      select: { id: true },
    },
    { enabled: isAuthenticated && !!importCapableProjectIntegration }
  );

  const importProjectMappingId = importIntegrationProjects?.[0]?.id;

  const canImportFromJira =
    canAddEdit && !!importCapableProjectIntegration && !!importProjectMappingId;

  const hasFiredPassiveRefresh = useRef(false);

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

  useEffect(() => {
    if (hasFiredPassiveRefresh.current) return;
    if (!isAuthenticated) return;
    if (syncedIntegrationIds.length === 0) return;
    if (!syncedIntegrationProjects) return;

    hasFiredPassiveRefresh.current = true;

    for (const integrationId of syncedIntegrationIds) {
      const mapping = syncedIntegrationProjects.find(
        (ip) => ip.projectIntegration?.integrationId === integrationId
      );
      if (!mapping) continue;

      void fetch(
        `/api/integrations/${integrationId}/milestone-sync/now?trigger=hover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectMappingId: mapping.id }),
        }
      ).catch(() => {
        // Fire-and-forget background freshness nudge — failures are
        // non-blocking, the next mount or manual "Sync now" will retry.
      });
    }
  }, [isAuthenticated, syncedIntegrationIds, syncedIntegrationProjects]);

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
          <CardHeader id="milestones-page-header">
            <CardTitle>
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <div>
                  <CardTitle>{t("common.fields.milestones")}</CardTitle>
                </div>
                {canAddEdit && (
                  <div className="flex items-center gap-2">
                    {isImportPolling && (
                      <Badge
                        variant="outline"
                        className="flex items-center gap-1 text-muted-foreground"
                        data-testid="import-milestones-progress"
                      >
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("milestones.import.importing", {
                          count: pendingImportIds?.size ?? 0,
                        })}
                      </Badge>
                    )}
                    {canImportFromJira && (
                      <Button
                        data-testid="import-milestones-button"
                        variant="outline"
                        onClick={() => setImportMilestonesOpen(true)}
                      >
                        <Download className="w-4" />
                        <span className="hidden md:inline">
                          {t("milestones.import.importTitle")}
                        </span>
                      </Button>
                    )}
                    <Button
                      data-testid="new-milestone-button"
                      onClick={() => setAddMilestoneOpen(true)}
                    >
                      <CirclePlus className="w-4" />
                      <span className="hidden md:inline">
                        {t("milestones.actions.add")}
                      </span>
                    </Button>
                    {addMilestoneOpen && (
                      <AddMilestone
                        open={addMilestoneOpen}
                        onClose={() => setAddMilestoneOpen(false)}
                      />
                    )}
                    {canImportFromJira &&
                      importCapableProjectIntegration &&
                      importProjectMappingId && (
                        <ImportMilestonesDialog
                          integrationId={
                            importCapableProjectIntegration.integrationId
                          }
                          projectId={Number(projectId)}
                          projectMappingId={importProjectMappingId}
                          open={importMilestonesOpen}
                          onOpenChange={setImportMilestonesOpen}
                          onStarted={startImportPolling}
                        />
                      )}
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
                  {t("common.fields.isActive")}
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
