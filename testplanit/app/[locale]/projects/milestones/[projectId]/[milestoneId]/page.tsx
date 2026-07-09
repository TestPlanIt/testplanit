"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import LoadingSpinnerPage from "@/components/LoadingSpinnerAlert";
import { MilestoneSummary } from "@/components/MilestoneSummary";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleCheckBig,
  CircleSlash2,
  Compass,
  ExternalLink,
  FileDown,
  PlayCircle,
  Save,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useParams, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import type { BatchTestRunSummaryResponse } from "~/app/api/test-runs/summaries/route";
import { emptyEditorContent } from "~/app/constants";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { CommentsSection } from "~/components/comments/CommentsSection";
import LoadingSpinner from "~/components/LoadingSpinner";
import { useExportMilestonePdf } from "~/hooks/pdf/useExportMilestonePdf";
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
import { MemberIssuesTable } from "./MemberIssuesTable";
import MilestoneFormControls from "./MilestoneFormControls";
import { buildMilestoneUpdatePayload } from "./milestoneUpdatePayload";

interface MilestoneForecastData {
  manualEstimate: number;
  mixedEstimate: number;
  automatedEstimate: number;
  areAllCasesAutomated: boolean;
}

/**
 * A synced milestone's `externalUrl` is tracker-provided and written through
 * the raw db client, which bypasses the schema's `@url` validation — so only
 * render the open-in-tracker button for http(s) URLs (never `javascript:`
 * etc.) and open without an opener reference to prevent reverse tab-nabbing.
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

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

  // Batch-fetch test run summaries for all test runs
  const { data: batchSummaries } = useQuery<BatchTestRunSummaryResponse>({
    queryKey: ["batchTestRunSummaries", testRunIds],
    queryFn: async () => {
      if (testRunIds.length === 0) {
        return { summaries: {} };
      }
      const response = await fetch(
        `/api/test-runs/summaries?testRunIds=${testRunIds.join(",")}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch batch test run summaries");
      }
      return response.json();
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

  if (!isFormReady || isLoading) return <LoadingSpinnerPage />;

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
            <div className="flex justify-between items-start">
              <div className="flex items-start gap-2 grow">
                {!isEditMode && (
                  <Link href={`/projects/milestones/${projectId}`}>
                    <Button type="button" variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                <CardTitle className="w-full text-xl md:text-2xl">
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
                    milestone?.name
                  )}
                </CardTitle>
                {!isEditMode && milestone?.integrationId != null && (
                  <div className="flex items-center gap-1 shrink-0 mt-2">
                    <Badge
                      data-testid="milestone-source-badge"
                      variant="secondary"
                      className="text-xs shrink-0"
                    >
                      {t("sync.sourceBadge", {
                        provider: t("sync.providerJira"),
                        kind:
                          milestone.externalKind === "RELEASE"
                            ? t("import.kindRelease")
                            : t("import.kindSprint"),
                        state: milestone.externalState ?? "",
                      })}
                    </Badge>
                    {milestone.externalUrl &&
                      SAFE_EXTERNAL_URL_RE.test(milestone.externalUrl) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:opacity-50"
                          title={t("sync.openInJira")}
                          data-testid="milestone-open-in-tracker"
                          onClick={() =>
                            window.open(
                              milestone.externalUrl!,
                              "_blank",
                              "noopener,noreferrer"
                            )
                          }
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 ms-4">
                {isEditMode ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="default"
                        disabled={isSubmitting}
                        data-testid="milestone-save"
                      >
                        <Save className="h-4 w-4" />
                        {isSubmitting
                          ? tCommon("actions.saving")
                          : tCommon("actions.save")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={isSubmitting}
                      >
                        <CircleSlash2 className="h-4 w-4" />
                        {tCommon("cancel")}
                      </Button>
                    </div>
                    {showDeleteButtonPerm && (
                      <Button
                        type="button"
                        onClick={handleDelete}
                        variant="secondary"
                        disabled={isSubmitting}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        {tCommon("actions.delete")}
                      </Button>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-1">
                    {showEditButtonPerm && (
                      <Button
                        type="button"
                        onClick={handleEditClick}
                        variant="secondary"
                        data-testid="milestone-edit"
                        className="group px-3 hover:px-3 transition-all duration-200 gap-0 hover:gap-2"
                      >
                        <SquarePen className="h-4 w-4 shrink-0" />
                        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                          {tCommon("actions.edit")}
                        </span>
                      </Button>
                    )}
                    {milestone && (
                      <Button
                        type="button"
                        onClick={handleExportPdf}
                        variant="secondary"
                        disabled={isExportingPdf}
                        data-testid="milestone-export-pdf"
                        className={`group px-3 hover:px-3 transition-all duration-200 gap-0 hover:gap-2 ${
                          isExportingPdf ? "animate-pulse" : ""
                        }`}
                      >
                        <FileDown className="h-4 w-4 shrink-0" />
                        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                          {isExportingPdf
                            ? tCommon("actions.exportingPdf")
                            : tCommon("actions.exportPdf")}
                        </span>
                      </Button>
                    )}
                    {milestone &&
                      !milestone.isCompleted &&
                      canCompleteMilestonePerm && (
                        <Button
                          type="button"
                          onClick={() => setIsCompleteDialogOpen(true)}
                          variant="secondary"
                          className="group px-3 hover:px-3 transition-all duration-200 gap-0 hover:gap-2"
                        >
                          <CircleCheckBig className="h-4 w-4 shrink-0" />
                          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                            {tCommon("actions.complete")}
                          </span>
                        </Button>
                      )}
                  </div>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            {/* Milestone Summary - shown at the top when not in edit mode */}
            {!isEditMode && milestone && (
              <div className="mb-6">
                <MilestoneSummary
                  milestoneId={milestone.id}
                  projectId={projectId}
                />
              </div>
            )}

            {/* Member Issues section (MLINK-04, D-07) — what's in this
                milestone (via MilestoneIssue links) and how its testing is
                going. Distinct from MilestoneSummary's linked-defect list
                above (D-16 vocabulary). */}
            {!isEditMode && milestone && (
              <div className="mb-6">
                <MemberIssuesTable milestoneId={milestone.id} projectId={Number(projectId)} />
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
                defaultSize={80}
                minSize={20}
              >
                <div className="px-4 h-full space-y-4">
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

                  {!isEditMode && (
                    <div className="mt-6">
                      <Label className="flex items-center gap-1">
                        <PlayCircle className="h-4 w-4" />
                        {tCommon("labels.testRuns", {
                          count: milestoneTestRuns?.length || 0,
                        })}
                      </Label>
                      <div className="mt-2">
                        {milestoneTestRuns && milestoneTestRuns.length > 0 ? (
                          <div className="space-y-2">
                            {milestoneTestRuns.map((testRun) => {
                              const transformedTestRun: TestRunItemProps["testRun"] =
                                {
                                  id: testRun.id,
                                  name: testRun.name,
                                  testRunType: testRun.testRunType,
                                  isCompleted: testRun.isCompleted,
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
                                          id: testRun.milestone.milestoneType
                                            .id,
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
                                  key={testRun.id}
                                  testRun={transformedTestRun}
                                  showMilestone={
                                    testRun.milestoneId !== Number(milestoneId)
                                  }
                                  summaryData={
                                    batchSummaries?.summaries[testRun.id]
                                  }
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-sm">
                            {t("empty.testRuns")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {!isEditMode && (
                    <div className="mt-6">
                      <Label className="flex items-center gap-1">
                        <Compass className="h-4 w-4" />
                        {tCommon("labels.sessions", {
                          count: milestoneSessions?.length || 0,
                        })}
                      </Label>
                      <div className="mt-2">
                        {milestoneSessions && milestoneSessions.length > 0 ? (
                          <div className="space-y-2">
                            {milestoneSessions.map((testSession) => (
                              <SessionItem
                                key={testSession.id}
                                testSession={testSession as SessionsWithDetails}
                                isCompleted={testSession.isCompleted}
                                onComplete={handleCompleteSession}
                                canComplete={canCompleteSession}
                                showMilestone={
                                  testSession.milestoneId !==
                                  Number(milestoneId)
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-sm">
                            {tGlobal("common.empty.sessions")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                id="milestone-right"
                order={2}
                defaultSize={20}
                minSize={10}
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
