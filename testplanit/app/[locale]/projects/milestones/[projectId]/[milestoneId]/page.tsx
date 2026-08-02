"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import DynamicIcon from "@/components/DynamicIcon";
import { RecordId } from "@/components/RecordId";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import LoadingSpinnerPage from "@/components/LoadingSpinnerAlert";
import { MilestoneSummary } from "@/components/MilestoneSummary";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import {
  ActionBar,
  ActionButtonContent,
  ActionOverflow,
  collapsibleActionClass,
  useContainerCompact,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { MilestoneAuditLogSheet } from "@/components/milestones/MilestoneAuditLogSheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";
import type { TestRunItemProps } from "@/projects/runs/[projectId]/TestRunItem";
import TestRunItem from "@/projects/runs/[projectId]/TestRunItem";
import { SessionsWithDetails } from "@/projects/sessions/[projectId]/SessionDisplay";
import SessionItem from "@/projects/sessions/[projectId]/SessionItem";
import {
  CompletableSession,
  CompleteSessionDialog,
} from "@/projects/sessions/[projectId]/[sessionId]/CompleteSessionDialog";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { ApplicationArea } from "~/zenstack/models";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  CircleSlash2,
  Compass,
  FileDown,
  History,
  PlayCircle,
  Save,
  SquarePen,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useParams, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { PanelImperativeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { z } from "zod/v4";
import type { BatchTestRunSummaryResponse } from "~/app/api/test-runs/summaries/route";
import { emptyEditorContent } from "~/app/constants";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import type { IconName } from "~/types/globals";
import { CollapsibleSection } from "~/components/CollapsibleSection";
import { CommentsSection } from "~/components/comments/CommentsSection";
import MilestoneBurndownChart from "~/components/dataVisualizations/MilestoneBurndownChart";
import LoadingSpinner from "~/components/LoadingSpinner";
import { VirtualizedCardList } from "~/components/VirtualizedCardList";
import { useExportMilestonePdf } from "~/hooks/pdf/useExportMilestonePdf";
import { useMilestoneBurndown } from "~/hooks/useMilestoneBurndown";
import { usePendingReviewsByEntity } from "~/hooks/usePendingReviewsByEntity";
import { useMilestoneLiveStream } from "~/hooks/useMilestoneLiveStream";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { Link, useRouter } from "~/lib/navigation";
import {
  ColorMap,
  createColorMap,
  MilestonesWithTypes,
} from "~/utils/milestoneUtils";
import { CompleteMilestoneDialog } from "../../CompleteMilestoneDialog";
import { DeleteMilestoneModal } from "../DeleteMilestoneModal";
import ChildMilestoneItem from "./ChildMilestoneItem";
import { MilestoneSourceBadge } from "../MilestoneSourceBadge";
import { IssuesCard, type IssuesCardHandle } from "./IssuesCard";
import MilestoneFormControls from "./MilestoneFormControls";
import { buildMilestoneUpdatePayload } from "./milestoneUpdatePayload";
import { Loading } from "~/components/Loading";

interface MilestoneForecastData {
  manualEstimate: number;
  mixedEstimate: number;
  automatedEstimate: number;
  areAllCasesAutomated: boolean;
}

export default function MilestoneDetailsPage() {
  const { projectId, milestoneId } = useParams<{
    projectId: string;
    milestoneId: string;
  }>();
  const searchParams = useSearchParams();
  const shouldStartInEditMode = searchParams.get("edit") === "true";
  const t = useTranslations("milestones");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [isEditMode, setIsEditMode] = useState(shouldStartInEditMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [wasDeleted, setWasDeleted] = useState(false);
  const [deletedMilestoneName, setDeletedMilestoneName] = useState("");
  const [isFormReady, setIsFormReady] = useState(false);
  const [selectedSessionToComplete, setSelectedSessionToComplete] =
    useState<CompletableSession | null>(null);
  const [colorMap, setColorMap] = useState<ColorMap | null>(null);
  const [milestoneForecast, setMilestoneForecast] =
    useState<MilestoneForecastData | null>(null);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  // Action bar collapses into a kebab when the header is narrow (mirrors the
  // repository case details bar).
  const { ref: headerRef, compact: headerCompact } = useContainerCompact();
  const [auditOpen, setAuditOpen] = useState(false);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState(false);
  const [isCollapsedRight, setIsCollapsedRight] = useState(false);
  const [isTransitioningLeft, setIsTransitioningLeft] = useState(false);
  const [isTransitioningRight, setIsTransitioningRight] = useState(false);
  const panelLeftRef = useRef<PanelImperativeHandle>(null);
  const panelRightRef = useRef<PanelImperativeHandle>(null);
  const issuesCardRef = useRef<IssuesCardHandle>(null);
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  const { data: sessionAuth } = useSession();
  const locale = useLocale();

  const { isExporting: isExportingPdf, handleExport: handleExportPdf } =
    useExportMilestonePdf({
      milestoneId: Number(milestoneId),
      projectId: Number(projectId),
      locale,
      generatedByName: sessionAuth?.user?.name,
    });

  const {
    permissions: milestonePermissions,
    isLoading: isLoadingMilestonePermissions,
  } = useProjectPermissions(Number(projectId), ApplicationArea.Milestones);

  const {
    permissions: sessionPermissions,
    isLoading: isLoadingSessionPermissions,
  } = useProjectPermissions(Number(projectId), ApplicationArea.Sessions);

  const canAddEditMilestone = milestonePermissions?.canAddEdit ?? false;
  const canDeleteMilestone = milestonePermissions?.canDelete ?? false;
  const canCloseSessionPerm = sessionPermissions?.canClose ?? false;
  const isSuperAdmin = sessionAuth?.user?.access === "ADMIN";

  const showEditButtonPerm = canAddEditMilestone || isSuperAdmin;
  const showDeleteButtonPerm = canDeleteMilestone || isSuperAdmin;
  const canCompleteSession = canCloseSessionPerm || isSuperAdmin;
  const canCompleteMilestonePerm =
    milestonePermissions?.canClose || isSuperAdmin;

  // Create a simpler schema for the form
  const MilestoneFormSchema = z.object({
    name: z.string().min(1),
    note: z.string().optional(),
    docs: z.string().optional(),
    isStarted: z.boolean(),
    isCompleted: z.boolean(),
    startedAt: z.date().optional().nullable(),
    completedAt: z.date().optional().nullable(),
    automaticCompletion: z.boolean(),
    enableNotifications: z.boolean(),
    notifyDaysBefore: z.number().min(0),
    milestoneTypesId: z.number(),
    parentId: z.number().optional().nullable(),
  });

  type MilestoneFormData = z.infer<typeof MilestoneFormSchema>;

  const methods = useForm<MilestoneFormData>({
    resolver: standardSchemaResolver(MilestoneFormSchema),
  });

  const { data: milestone, isLoading: isMilestoneLoading } = useClientQueries(
    schema
  ).milestones.useFindFirst({
    where: {
      id: Number(milestoneId),
      projectId: Number(projectId),
      isDeleted: false,
    },
    include: {
      milestoneType: {
        include: {
          icon: true,
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
      children: {
        include: {
          milestoneType: {
            include: {
              icon: true,
            },
          },
        },
      },
    },
  });

  // Active IntegrationProject mapping(s) for this milestone's integration,
  // scoped to this project — feeds the source badge's Jira project ("space")
  // segment. Only fires for synced milestones.
  const { data: milestoneIntegrationProjects } = useClientQueries(
    schema
  ).integrationProject.useFindMany(
    {
      where: {
        isActive: true,
        projectIntegration: {
          projectId: Number(projectId),
          integrationId: milestone?.integrationId ?? undefined,
        },
      },
      select: {
        externalProjectKey: true,
        externalProjectName: true,
        projectIntegration: { select: { integrationId: true } },
      },
    },
    { enabled: milestone?.integrationId != null }
  );

  const queryClient = useQueryClient();

  // D-15/D-16: subscribe this detail page to its per-entity milestone
  // stream so the fields, badge, member table, and coverage all react live
  // on a wake-up — no bespoke 45s passive-refresh window exists on this
  // page today, so this is a net-new subscriber, not a retirement.
  useMilestoneLiveStream({
    milestoneId: Number(milestoneId),
    onWakeUp: React.useCallback(
      (event) => {
        // The `sync` checkpoint fires on every (re)subscribe — including the
        // routine EventSource reconnects that happen on any transport blip or
        // dev-mode HMR recompile — and is NOT a data change. Refetching the
        // whole page on it turns reconnect churn into a request flood that can
        // saturate the browser's per-origin connection pool. Only react to real
        // change events (mirrors MemberIssuesOverflowPanel's membership_changed
        // filter).
        if (event.event === "sync") return;
        void queryClient.invalidateQueries({
          predicate: (query) =>
            JSON.stringify(query.queryKey).includes("Milestones") ||
            JSON.stringify(query.queryKey).includes("MilestoneIssue"),
        });
        void queryClient.invalidateQueries({
          queryKey: ["milestoneMemberCoverage", Number(milestoneId)],
        });
        void queryClient.invalidateQueries({
          queryKey: ["milestoneMemberOverflow", Number(milestoneId)],
        });
        // Both the MilestoneSummary chips (scopeCount) and the sibling "Found
        // in testing" section (issues) read this same cache entry.
        void queryClient.invalidateQueries({
          queryKey: ["milestoneSummary", Number(milestoneId)],
        });
        // Burndown re-derives from execution, so refresh it on the same wake-up.
        void queryClient.invalidateQueries({
          queryKey: ["milestoneBurndown", Number(milestoneId)],
        });
      },
      [queryClient, milestoneId]
    ),
  });

  // Burndown series for the milestone/sprint window (fast-follow READY, D4).
  const { data: burndown } = useMilestoneBurndown(
    milestone?.id ?? Number(milestoneId)
  );

  const { data: milestoneTypes, isLoading: isTypesLoading } = useClientQueries(
    schema
  ).milestoneTypes.useFindMany({
    include: { icon: true },
  });

  const { data: allProjectMilestones, isLoading: isProjectMilestonesLoading } =
    useClientQueries(schema).milestones.useFindMany({
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

  const { data: colors } = useClientQueries(schema).color.useFindMany({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  // Fetch descendant milestone IDs for rollup
  const { data: descendantsData } = useQuery<{ descendantIds: number[] }>({
    queryKey: ["milestoneDescendants", milestoneId],
    queryFn: async () => {
      const response = await fetch(
        `/api/milestones/${milestoneId}/descendants`
      );
      if (!response.ok) return { descendantIds: [] };
      return response.json();
    },
    staleTime: 60000,
  });

  const allMilestoneIds = useMemo(
    () => [Number(milestoneId), ...(descendantsData?.descendantIds ?? [])],
    [milestoneId, descendantsData]
  );

  const { data: milestoneSessions } = useClientQueries(
    schema
  ).sessions.useFindMany({
    where: {
      milestoneId: { in: allMilestoneIds },
      isDeleted: false,
    },
    include: {
      state: {
        include: {
          icon: true,
          color: true,
        },
      },
      milestone: {
        include: {
          milestoneType: {
            include: {
              icon: true,
            },
          },
        },
      },
      createdBy: true,
      assignedTo: true,
      project: true,
      template: true,
      configuration: true,
    },
    orderBy: [{ isCompleted: "asc" }, { createdAt: "desc" }],
  });

  const { data: milestoneTestRuns } = useClientQueries(
    schema
  ).testRuns.useFindMany({
    where: {
      milestoneId: { in: allMilestoneIds },
      isDeleted: false,
    },
    include: {
      configuration: {
        select: {
          id: true,
          name: true,
          isEnabled: true,
          isDeleted: true,
          deletedAt: true,
        },
      },
      state: {
        include: {
          icon: true,
          color: true,
        },
      },
      milestone: {
        include: {
          milestoneType: {
            include: {
              icon: true,
            },
          },
        },
      },
      // testCases removed - fetched separately via batch summary API to avoid N+1 queries
      createdBy: true,
    },
    orderBy: [{ isCompleted: "asc" }, { createdAt: "desc" }],
  });

  // Extract test run IDs for batch summary fetch
  const testRunIds = useMemo(
    () => milestoneTestRuns?.map((run) => run.id) ?? [],
    [milestoneTestRuns]
  );

  const sessionIds = useMemo(
    () => milestoneSessions?.map((s) => s.id) ?? [],
    [milestoneSessions]
  );

  // Pending-review badges on the run/session rows, matching the runs and
  // sessions list pages.
  const pendingReviewsByRunId = usePendingReviewsByEntity("RUN", testRunIds);
  const pendingReviewsBySessionId = usePendingReviewsByEntity(
    "SESSION",
    sessionIds
  );

  // Batch-fetch test run summaries for all test runs. The route caps a
  // batch at 100 ids — milestones with many runs (especially via nested
  // child milestones, D-06) exceed that, so chunk and merge.
  const { data: batchSummaries, isLoading: isBatchSummariesLoading } =
    useQuery<BatchTestRunSummaryResponse>({
      queryKey: ["batchTestRunSummaries", testRunIds],
      queryFn: async () => {
        if (testRunIds.length === 0) {
          return { summaries: {} };
        }
        const CHUNK_SIZE = 100;
        const chunks: number[][] = [];
        for (let i = 0; i < testRunIds.length; i += CHUNK_SIZE) {
          chunks.push(testRunIds.slice(i, i + CHUNK_SIZE));
        }
        const responses = await Promise.all(
          chunks.map(async (chunk) => {
            const response = await fetch(
              `/api/test-runs/summaries?testRunIds=${chunk.join(",")}`
            );
            if (!response.ok) {
              throw new Error("Failed to fetch batch test run summaries");
            }
            return response.json() as Promise<BatchTestRunSummaryResponse>;
          })
        );
        const merged: BatchTestRunSummaryResponse = { summaries: {} };
        for (const part of responses) {
          Object.assign(merged.summaries, part.summaries);
        }
        return merged;
      },
      enabled: testRunIds.length > 0,
      staleTime: 30000, // Cache for 30 seconds
    });

  useEffect(() => {
    if (colors) {
      const map = createColorMap(colors);
      setColorMap(map);
    }
  }, [colors]);

  useEffect(() => {
    const fetchMilestoneForecast = async () => {
      if (!milestoneId) return;
      setIsLoadingForecast(true);
      try {
        const response = await fetch(`/api/milestones/${milestoneId}/forecast`);
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        const data: MilestoneForecastData = await response.json();
        setMilestoneForecast(data);
      } catch (error) {
        console.error("Failed to fetch milestone forecast:", error);
        setMilestoneForecast(null);
        toast.error(tCommon("errors.fetchFailed"));
      } finally {
        setIsLoadingForecast(false);
      }
    };

    void fetchMilestoneForecast();
  }, [milestoneId, tCommon]);

  const { mutateAsync: updateMilestone } =
    useClientQueries(schema).milestones.useUpdate();

  const isLoading =
    isMilestoneLoading ||
    isTypesLoading ||
    isProjectMilestonesLoading ||
    isLoadingMilestonePermissions ||
    isLoadingSessionPermissions;

  useEffect(() => {
    const allDataAvailable =
      milestone && milestoneTypes && allProjectMilestones;
    const noLoadingStates =
      !isMilestoneLoading && !isTypesLoading && !isProjectMilestonesLoading;

    if (allDataAvailable && noLoadingStates && !isFormReady) {
      methods.reset({
        name: milestone.name,
        note:
          typeof milestone.note === "string"
            ? milestone.note
            : milestone.note
              ? JSON.stringify(milestone.note)
              : JSON.stringify(emptyEditorContent),
        docs:
          typeof milestone.docs === "string"
            ? milestone.docs
            : milestone.docs
              ? JSON.stringify(milestone.docs)
              : JSON.stringify(emptyEditorContent),
        isStarted: milestone.isStarted,
        isCompleted: milestone.isCompleted,
        startedAt: milestone.startedAt
          ? new Date(milestone.startedAt)
          : undefined,
        completedAt: milestone.completedAt
          ? new Date(milestone.completedAt)
          : undefined,
        automaticCompletion: milestone.automaticCompletion ?? false,
        enableNotifications: (milestone.notifyDaysBefore ?? 0) > 0,
        notifyDaysBefore:
          milestone.notifyDaysBefore && milestone.notifyDaysBefore > 0
            ? milestone.notifyDaysBefore
            : 5,
        milestoneTypesId: milestone.milestoneTypesId,
        parentId: milestone.parentId ?? undefined,
      });
      setIsFormReady(true);
    }
  }, [
    milestone,
    milestoneTypes,
    allProjectMilestones,
    isMilestoneLoading,
    isTypesLoading,
    isProjectMilestonesLoading,
    isFormReady,
    methods,
    isEditMode,
  ]);

  useEffect(() => {
    if (wasDeleted) {
      toast.success(t("toast.deleted", { name: deletedMilestoneName }));
      router.push(`/projects/milestones/${projectId}`);
    }
  }, [wasDeleted, deletedMilestoneName, projectId, router, t]);

  const onSubmit = async (data: MilestoneFormData) => {
    if (!milestone) return;

    setIsSubmitting(true);
    try {
      // Transforms enableNotifications into notifyDaysBefore, and strips the
      // tracker-owned fields (name/note/dates/state) for synced milestones —
      // those are locked by field-level @deny rules and their mere presence
      // in the payload would reject the whole update.
      const updateData = buildMilestoneUpdatePayload(
        data,
        milestone.integrationId != null
      );

      await updateMilestone({
        where: { id: Number(milestoneId) },
        data: updateData,
      });

      toast.success(t("toast.updated"));
      setIsEditMode(false);
    } catch (error) {
      console.error("Error updating milestone:", error);
      toast.error(t("toast.updateFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setIsEditMode(false);
    if (milestone) {
      methods.reset({
        name: milestone?.name,
        note:
          typeof milestone?.note === "string"
            ? milestone.note
            : milestone?.note
              ? JSON.stringify(milestone.note)
              : undefined,
        docs:
          typeof milestone?.docs === "string"
            ? milestone.docs
            : milestone?.docs
              ? JSON.stringify(milestone.docs)
              : undefined,
        isStarted: milestone.isStarted,
        isCompleted: milestone.isCompleted,
        startedAt: milestone.startedAt
          ? new Date(milestone.startedAt)
          : undefined,
        completedAt: milestone.completedAt
          ? new Date(milestone.completedAt)
          : undefined,
        automaticCompletion: milestone.automaticCompletion ?? false,
        enableNotifications: (milestone.notifyDaysBefore ?? 0) > 0,
        notifyDaysBefore:
          milestone.notifyDaysBefore && milestone.notifyDaysBefore > 0
            ? milestone.notifyDaysBefore
            : 5,
        milestoneTypesId: milestone?.milestoneTypesId,
        parentId: milestone?.parentId ?? undefined,
      });
    }
  };

  const handleDelete = async () => {
    setIsDeleteModalOpen(true);
  };

  const handleEditClick = () => {
    if (showEditButtonPerm) {
      setIsEditMode(true);
    } else {
      toast.error(tCommon("errors.unauthorized"));
    }
  };

  const renderChildMilestones = (
    milestones: MilestonesWithTypes[],
    parentId: number,
    level: number = 0
  ): React.ReactNode[] => {
    const handleMilestoneClick =
      (clickedMilestoneId: number) => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        router.push(`/projects/milestones/${projectId}/${clickedMilestoneId}`);
      };

    const milestonesWithChildren: MilestonesWithTypes[] = (
      allProjectMilestones || []
    ).map((m) => ({ ...m, children: [] }));

    return milestones
      .filter((m) => m.parentId === parentId)
      .map((currentChildMilestone) => (
        <ChildMilestoneItem
          key={currentChildMilestone.id}
          milestone={currentChildMilestone}
          projectId={projectId}
          theme={resolvedTheme}
          colorMap={colorMap}
          level={level}
          onMilestoneClick={handleMilestoneClick}
          renderChildNodes={renderChildMilestones}
          allMilestones={milestonesWithChildren}
        />
      ));
  };

  const handleCompleteSession = (testSession: any) => {
    setSelectedSessionToComplete(testSession as CompletableSession);
  };

  const handleCompleteDialogClose = () => {
    setSelectedSessionToComplete(null);
    router.refresh();
  };

  const toggleCollapseLeft = () => {
    setIsTransitioningLeft(true);
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
    setTimeout(() => setIsTransitioningLeft(false), 300);
  };

  const toggleCollapseRight = () => {
    setIsTransitioningRight(true);
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
    setTimeout(() => setIsTransitioningRight(false), 300);
  };

  if (!isFormReady || isLoading) return <Loading />;

  // Completed milestones tint the outer card (below); the nested Issues, Test
  // Runs, and Sessions cards take the same tint so they don't read as active.
  const completedCardClassName = milestone?.isCompleted
    ? "bg-muted-foreground/20 border-muted-foreground"
    : undefined;

  return (
    <FormProvider {...methods}>
      <form
        key={`milestone-form-${isEditMode ? "edit" : "view"}`}
        onSubmit={(e) => {
          e.preventDefault();
          // Ignore stray submits fired while in view mode (e.g. clicking Edit
          // swaps the trigger for the edit-mode Save button under the cursor).
          if (!isEditMode) return;
          void methods.handleSubmit(onSubmit)(e);
        }}
      >
        <Card
          className={`group-hover:bg-accent/50 transition-colors ${
            milestone?.isCompleted
              ? "bg-muted-foreground/20 border-muted-foreground"
              : ""
          }`}
        >
          {isSubmitting && <LoadingSpinnerPage />}
          <CardHeader>
            <div
              ref={headerRef}
              className="flex justify-between items-center gap-2"
            >
              <div className="flex items-start gap-2 grow">
                {!isEditMode && (
                  <Link href={`/projects/milestones/${projectId}`}>
                    <Button type="button" variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                <CardTitle className="grow min-w-0 text-xl md:text-2xl">
                  {isEditMode ? (
                    <FormField
                      control={methods.control}
                      name="name"
                      render={({ field, fieldState: { error } }) => (
                        <FormItem className="w-full">
                          <FormControl>
                            <Textarea
                              {...field}
                              disabled={milestone?.integrationId != null}
                              className="text-xl md:text-2xl w-full"
                            />
                          </FormControl>
                          {error && <FormMessage>{error.message}</FormMessage>}
                        </FormItem>
                      )}
                    />
                  ) : (
                    <span className="flex items-center gap-2 min-w-0">
                      <DynamicIcon
                        name={
                          (milestone?.milestoneType?.icon?.name as IconName) ||
                          "milestone"
                        }
                        className="h-6 w-6 shrink-0"
                      />
                      <span className="min-w-0">{milestone?.name}</span>
                    </span>
                  )}
                  {!isEditMode && milestone && (
                    <MilestoneSourceBadge
                      milestone={milestone}
                      projectId={Number(projectId)}
                      integrationProjects={milestoneIntegrationProjects}
                      className="mt-2"
                    />
                  )}
                </CardTitle>
              </div>
              <ActionBar
                compact={headerCompact}
                className="flex-col items-stretch gap-2 ms-4"
              >
                {!isEditMode && milestone && (
                  <RecordId
                    type="MILESTONE"
                    id={milestone.id}
                    projectId={Number(projectId)}
                    className="self-end shrink-0 whitespace-nowrap"
                  />
                )}
                {isEditMode ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={isSubmitting}
                        data-testid="milestone-save"
                        className={collapsibleActionClass(headerCompact)}
                      >
                        <ActionButtonContent
                          icon={Save}
                          label={
                            isSubmitting
                              ? tCommon("actions.saving")
                              : tCommon("actions.save")
                          }
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={isSubmitting}
                        className={collapsibleActionClass(headerCompact)}
                      >
                        <ActionButtonContent
                          icon={CircleSlash2}
                          label={tCommon("cancel")}
                        />
                      </Button>
                    </div>
                    {showDeleteButtonPerm && (
                      <Button
                        type="button"
                        onClick={handleDelete}
                        variant="outline"
                        disabled={isSubmitting}
                        className={collapsibleActionClass(
                          headerCompact,
                          "text-destructive"
                        )}
                      >
                        <ActionButtonContent
                          icon={Trash2}
                          label={tCommon("actions.delete")}
                        />
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-1">
                    {milestone && (
                      <MilestoneAuditLogSheet
                        milestoneId={milestone.id}
                        hideTrigger
                        open={auditOpen}
                        onOpenChange={setAuditOpen}
                      />
                    )}
                    <ActionOverflow
                      compact={headerCompact}
                      menuLabel={tCommon("actions.actionsLabel")}
                      actions={[
                        {
                          key: "activity",
                          icon: History,
                          label: tCommon("fields.activityLog"),
                          onClick: () => setAuditOpen(true),
                          hidden: !milestone,
                        },
                        {
                          key: "edit",
                          icon: SquarePen,
                          label: tCommon("actions.edit"),
                          onClick: handleEditClick,
                          testId: "milestone-edit",
                          hidden: !showEditButtonPerm,
                        },
                        {
                          key: "export",
                          icon: FileDown,
                          label: isExportingPdf
                            ? tCommon("actions.exportingPdf")
                            : tCommon("actions.exportPdf"),
                          onClick: handleExportPdf,
                          disabled: isExportingPdf,
                          testId: "milestone-export-pdf",
                          hidden: !milestone,
                          className: isExportingPdf ? "animate-pulse" : "",
                        },
                        {
                          key: "complete",
                          icon: CircleCheckBig,
                          label: tCommon("actions.complete"),
                          onClick: () => setIsCompleteDialogOpen(true),
                          hidden: !(
                            milestone &&
                            !milestone.isCompleted &&
                            canCompleteMilestonePerm
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </ActionBar>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {/* Milestone Summary - shown at the top when not in edit mode */}
            {!isEditMode && milestone && (
              <div className="mb-6">
                <MilestoneSummary
                  milestoneId={milestone.id}
                  projectId={projectId}
                  onScopeChipClick={() =>
                    issuesCardRef.current?.expandInScope()
                  }
                  onFoundInTestingChipClick={() =>
                    issuesCardRef.current?.expandFoundInTesting()
                  }
                />
              </div>
            )}

            <ResizablePanelGroup
              direction="horizontal"
              className="min-h-[400px]"
              autoSaveId="milestone-panels"
            >
              <ResizablePanel
                id="milestone-left"
                order={1}
                ref={panelLeftRef}
                defaultSize={80}
                collapsible
                minSize={20}
                collapsedSize={0}
                onCollapse={() => setIsCollapsedLeft(true)}
                onExpand={() => setIsCollapsedLeft(false)}
                className={
                  isTransitioningLeft
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }
              >
                <div className="px-4 h-full space-y-4 pb-8">
                  <FormField
                    name="docs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {tGlobal("common.fields.documentation")}
                        </FormLabel>
                        {isEditMode || !isTiptapEmpty(milestone?.docs) ? (
                          <FormControl>
                            <TipTapEditor
                              key={`editing-docs-${isEditMode}`}
                              content={
                                field.value
                                  ? JSON.parse(field.value)
                                  : emptyEditorContent
                              }
                              onUpdate={(newContent) => {
                                if (isEditMode) {
                                  field.onChange(JSON.stringify(newContent));
                                }
                              }}
                              readOnly={!isEditMode}
                              className="h-auto"
                              placeholder={t("placeholders.documentation")}
                              projectId={projectId}
                            />
                          </FormControl>
                        ) : (
                          <div className="text-muted-foreground text-sm">
                            {t("empty.documentation")}
                          </div>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!isEditMode && (
                    <div className="mt-6">
                      <Label className="flex items-center gap-1 mb-2">
                        {tGlobal("common.fields.forecast")}
                      </Label>
                      {isLoadingForecast ? (
                        <LoadingSpinner />
                      ) : milestoneForecast ? (
                        (() => {
                          const {
                            manualEstimate,
                            automatedEstimate,
                            mixedEstimate,
                          } = milestoneForecast;
                          const forecastElements: React.ReactNode[] = [];

                          if (manualEstimate > 0 && automatedEstimate > 0) {
                            forecastElements.push(
                              <ForecastDisplay
                                key="mixed"
                                seconds={mixedEstimate}
                                type="mixed"
                              />
                            );
                          } else if (manualEstimate > 0) {
                            forecastElements.push(
                              <ForecastDisplay
                                key="manual"
                                seconds={manualEstimate}
                                type="manual"
                              />
                            );
                          } else if (automatedEstimate > 0) {
                            forecastElements.push(
                              <ForecastDisplay
                                key="auto"
                                seconds={automatedEstimate}
                                type="automated"
                              />
                            );
                          }

                          if (forecastElements.length > 0) {
                            return (
                              <div className="text-sm text-muted-foreground space-y-1">
                                {forecastElements}
                              </div>
                            );
                          }
                          return (
                            <div className="text-sm text-muted-foreground">
                              {t("empty.forecasts")}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {t("empty.forecasts")}
                        </div>
                      )}
                    </div>
                  )}

                  {!isEditMode &&
                    allProjectMilestones &&
                    allProjectMilestones.length > 0 && (
                      <div className="mt-6">
                        <Label>{t("labels.childMilestones")}</Label>
                        <div className="mt-2">
                          {(() => {
                            const childMilestones = allProjectMilestones
                              .map((milestone) => ({
                                ...milestone,
                                children: [],
                              }))
                              .filter(
                                (m) => m.parentId === Number(milestoneId)
                              );

                            if (childMilestones.length === 0) {
                              return (
                                <div className="text-muted-foreground text-sm">
                                  {tGlobal("common.empty.childMilestones")}
                                </div>
                              );
                            }

                            return renderChildMilestones(
                              allProjectMilestones.map((milestone) => ({
                                ...milestone,
                                children: [],
                              })),
                              Number(milestoneId)
                            );
                          })()}
                        </div>
                      </div>
                    )}

                  {/* Burndown, Issues, Test Runs, and Sessions stack as sibling
                      cards in the left panel: the execution burndown over the
                      window, then in-scope + found-in-testing issues, then the
                      milestone's test runs and sessions. The burndown only
                      appears once there's a window anchor and executable scope
                      (a fresh, empty milestone has nothing to plot). */}
                  {!isEditMode &&
                    milestone &&
                    burndown &&
                    burndown.start &&
                    burndown.actual.length > 0 && (
                      <CollapsibleSection
                        data-testid="milestone-burndown-card"
                        className={completedCardClassName}
                        storageKey="tpi.milestone.burndown.collapsed"
                        icon={<TrendingDown className="h-5 w-5" />}
                        title={t("burndown.title")}
                      >
                        <div className="h-64 w-full">
                          <MilestoneBurndownChart data={burndown} />
                        </div>
                      </CollapsibleSection>
                    )}

                  {!isEditMode && milestone && (
                    <IssuesCard
                      ref={issuesCardRef}
                      milestoneId={milestone.id}
                      projectId={Number(projectId)}
                      className={completedCardClassName}
                    />
                  )}

                  {!isEditMode && (
                    <CollapsibleSection
                      data-testid="milestone-test-runs-card"
                      className={completedCardClassName}
                      storageKey="tpi.milestone.testRuns.collapsed"
                      icon={<PlayCircle className="h-5 w-5" />}
                      title={tCommon("labels.testRuns", {
                        count: milestoneTestRuns?.length || 0,
                      })}
                    >
                      {milestoneTestRuns && milestoneTestRuns.length > 0 ? (
                        <VirtualizedCardList
                          items={milestoneTestRuns}
                          getKey={(testRun) => testRun.id}
                          data-testid="milestone-test-runs-list"
                          renderItem={(testRun) => {
                            const transformedTestRun: TestRunItemProps["testRun"] =
                              {
                                id: testRun.id,
                                name: testRun.name,
                                testRunType: testRun.testRunType,
                                isCompleted: testRun.isCompleted,
                                compositionLockedAt:
                                  testRun.compositionLockedAt,
                                configuration: testRun.configuration,
                                configurationGroupId:
                                  testRun.configurationGroupId,
                                state: {
                                  id: testRun.state.id,
                                  name: testRun.state.name,
                                  icon: testRun.state.icon,
                                  color: testRun.state.color,
                                },
                                note:
                                  typeof testRun.note === "string"
                                    ? testRun.note
                                    : testRun.note
                                      ? JSON.stringify(testRun.note)
                                      : "",
                                completedAt: testRun.completedAt || undefined,
                                milestone: testRun.milestone
                                  ? {
                                      id: testRun.milestone.id,
                                      name: testRun.milestone.name,
                                      startedAt: testRun.milestone.startedAt,
                                      completedAt:
                                        testRun.milestone.completedAt,
                                      isCompleted:
                                        testRun.milestone.isCompleted,
                                      milestoneType: {
                                        id: testRun.milestone.milestoneType.id,
                                        name: testRun.milestone.milestoneType
                                          .name,
                                        icon: testRun.milestone.milestoneType
                                          .icon,
                                      },
                                    }
                                  : undefined,
                                projectId: testRun.projectId,
                                createdBy: testRun.createdBy,
                                forecastManual: testRun.forecastManual,
                                forecastAutomated: testRun.forecastAutomated,
                              };
                            return (
                              <TestRunItem
                                testRun={transformedTestRun}
                                showMilestone={
                                  testRun.milestoneId !== Number(milestoneId)
                                }
                                summaryData={
                                  batchSummaries?.summaries[testRun.id]
                                }
                                summaryLoading={isBatchSummariesLoading}
                                pendingRequest={pendingReviewsByRunId.get(
                                  testRun.id
                                )}
                              />
                            );
                          }}
                        />
                      ) : (
                        <div className="text-muted-foreground text-sm">
                          {t("empty.testRuns")}
                        </div>
                      )}
                    </CollapsibleSection>
                  )}

                  {!isEditMode && (
                    <CollapsibleSection
                      data-testid="milestone-sessions-card"
                      className={completedCardClassName}
                      storageKey="tpi.milestone.sessions.collapsed"
                      icon={<Compass className="h-5 w-5" />}
                      title={tCommon("labels.sessions", {
                        count: milestoneSessions?.length || 0,
                      })}
                    >
                      {milestoneSessions && milestoneSessions.length > 0 ? (
                        <VirtualizedCardList
                          items={milestoneSessions}
                          getKey={(testSession) => testSession.id}
                          data-testid="milestone-sessions-list"
                          renderItem={(testSession) => (
                            <SessionItem
                              testSession={testSession as SessionsWithDetails}
                              isCompleted={testSession.isCompleted}
                              onComplete={handleCompleteSession}
                              canComplete={canCompleteSession}
                              showMilestone={
                                testSession.milestoneId !== Number(milestoneId)
                              }
                              pendingRequest={pendingReviewsBySessionId.get(
                                testSession.id
                              )}
                            />
                          )}
                        />
                      ) : (
                        <div className="text-muted-foreground text-sm">
                          {tGlobal("common.empty.sessions")}
                        </div>
                      )}
                    </CollapsibleSection>
                  )}
                </div>
              </ResizablePanel>

              <div>
                <Button
                  type="button"
                  onClick={toggleCollapseLeft}
                  variant="secondary"
                  className="p-0 rounded-e-none"
                >
                  {isCollapsedLeft ? <ChevronRight /> : <ChevronLeft />}
                </Button>
              </div>

              <ResizableHandle withHandle className="w-1" />

              <div>
                <Button
                  type="button"
                  onClick={toggleCollapseRight}
                  variant="secondary"
                  className={`p-0 transform ${isCollapsedRight ? "rounded-s-none" : "rounded-e-none rotate-180"}`}
                >
                  <ChevronLeft />
                </Button>
              </div>

              <ResizablePanel
                id="milestone-right"
                order={2}
                ref={panelRightRef}
                defaultSize={20}
                collapsedSize={0}
                minSize={10}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
                className={
                  isTransitioningRight
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }
              >
                <div className="ps-4 pe-1 pb-1 h-full">
                  <div className="space-y-4">
                    <MilestoneFormControls
                      isEditMode={isEditMode}
                      isSubmitting={isSubmitting}
                      milestone={milestone}
                      projectId={projectId}
                      milestoneId={milestoneId}
                    />
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
            {!isEditMode && milestone && sessionAuth?.user && (
              <div id="comments" className="mt-6 px-4">
                <CommentsSection
                  projectId={Number(projectId)}
                  entityType="milestone"
                  entityId={milestone.id}
                  currentUserId={sessionAuth.user.id}
                  isAdmin={sessionAuth.user.access === "ADMIN"}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </form>

      {milestone && (
        <DeleteMilestoneModal
          milestone={milestone}
          open={isDeleteModalOpen}
          onOpenChange={(open) => {
            setIsDeleteModalOpen(open);
          }}
          milestones={allProjectMilestones || []}
          onDeleteSuccess={() => {
            setDeletedMilestoneName(milestone.name);
            setWasDeleted(true);
          }}
        />
      )}

      {selectedSessionToComplete && (
        <CompleteSessionDialog
          open={!!selectedSessionToComplete}
          onOpenChange={handleCompleteDialogClose}
          session={selectedSessionToComplete}
          projectId={Number(projectId)}
        />
      )}

      {milestone && allProjectMilestones && (
        <CompleteMilestoneDialog
          open={isCompleteDialogOpen}
          onOpenChange={setIsCompleteDialogOpen}
          milestoneToComplete={milestone as unknown as MilestonesWithTypes}
          onCompleteSuccess={() => {
            toast.success(t("toast.updatedWithName", { name: milestone.name }));
            router.refresh();
          }}
        />
      )}
    </FormProvider>
  );
}
