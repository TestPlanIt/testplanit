"use client";

import React, { useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Save,
  ArrowLeft,
  SquarePen,
  Trash2,
  CircleSlash2,
  Compass,
  PlayCircle,
  CircleCheckBig,
} from "lucide-react";
import LoadingSpinnerPage from "@/components/LoadingSpinnerAlert";
import MilestoneFormControls from "./MilestoneFormControls";
import {
  useFindFirstMilestones,
  useUpdateMilestones,
  useFindManyMilestones,
  useFindManyMilestoneTypes,
  useFindManyColor,
  useFindManySessions,
  useFindManyTestRuns,
} from "~/lib/hooks";
import { z } from "zod/v4";
import { Link } from "~/lib/navigation";
import { Textarea } from "@/components/ui/textarea";
import {
  FormField,
  FormItem,
  FormControl,
  FormMessage,
  FormLabel,
} from "@/components/ui/form";
import { DeleteMilestoneModal } from "../DeleteMilestoneModal";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Label } from "@/components/ui/label";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import {
  MilestonesWithTypes,
  getStatus,
  getStatusStyle,
  createColorMap,
  ColorMap,
} from "~/utils/milestoneUtils";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "next-themes";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import SessionItem from "@/projects/sessions/[projectId]/SessionItem";
import { SessionsWithDetails } from "@/projects/sessions/[projectId]/SessionDisplay";
import {
  CompleteSessionDialog,
  CompletableSession,
} from "@/projects/sessions/[projectId]/[sessionId]/CompleteSessionDialog";
import { emptyEditorContent } from "~/app/constants";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { useTranslations } from "next-intl";
import TestRunItem from "@/projects/runs/[projectId]/TestRunItem";
import type { TestRunItemProps } from "@/projects/runs/[projectId]/TestRunItem";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import { useSession } from "next-auth/react";
import LoadingSpinner from "~/components/LoadingSpinner";
import ChildMilestoneItem from "./ChildMilestoneItem";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { CompleteMilestoneDialog } from "../../CompleteMilestoneDialog";
import { MilestoneSummary } from "@/components/MilestoneSummary";

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
  const tSessions = useTranslations("sessions");
  const tCommon = useTranslations("common");
  const tRuns = useTranslations("runs");

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
  const { theme } = useTheme();

  const { data: sessionAuth } = useSession();

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
    notifyDaysBefore: z.number().min(1),
    milestoneTypesId: z.number(),
    parentId: z.number().optional().nullable(),
  });

  type MilestoneFormData = z.infer<typeof MilestoneFormSchema>;

  const methods = useForm<MilestoneFormData>({
    resolver: zodResolver(MilestoneFormSchema),
  });

  const { data: milestone, isLoading: isMilestoneLoading } =
    useFindFirstMilestones({
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

  const { data: milestoneTypes, isLoading: isTypesLoading } =
    useFindManyMilestoneTypes({
      include: { icon: true },
    });

  const { data: allProjectMilestones, isLoading: isProjectMilestonesLoading } =
    useFindManyMilestones({
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

  const { data: colors } = useFindManyColor({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const { data: milestoneSessions } = useFindManySessions({
    where: {
      milestoneId: Number(milestoneId),
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
    orderBy: [
      { isCompleted: "asc" },
      { createdAt: "desc" },
    ],
  });

  const { data: milestoneTestRuns } = useFindManyTestRuns({
    where: {
      milestoneId: Number(milestoneId),
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
      testCases: true,
      createdBy: true,
    },
    orderBy: [
      { isCompleted: "asc" },
      { createdAt: "desc" },
    ],
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

    fetchMilestoneForecast();
  }, [milestoneId, tCommon]);

  const { mutateAsync: updateMilestone } = useUpdateMilestones();

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
      // Transform enableNotifications checkbox to notifyDaysBefore value
      const { enableNotifications, ...restData } = data;
      const updateData = {
        ...restData,
        parentId: data.parentId ? Number(data.parentId) : null,
        automaticCompletion: data.completedAt
          ? data.automaticCompletion
          : false,
        notifyDaysBefore:
          data.completedAt && enableNotifications ? data.notifyDaysBefore : 0,
      };

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
          theme={theme}
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
      <form onSubmit={methods.handleSubmit(onSubmit)}>
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
                    <Button variant="outline" size="icon">
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
              </div>
              <div className="flex flex-col gap-2 ml-4">
                {isEditMode ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="default"
                        disabled={isSubmitting}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {isSubmitting
                          ? tCommon("status.saving")
                          : tCommon("actions.save")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={isSubmitting}
                      >
                        <CircleSlash2 className="h-4 w-4 mr-1" />
                        {tCommon("actions.cancel")}
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
                        <Trash2 className="h-4 w-4 mr-1" />
                        {tCommon("actions.delete")}
                      </Button>
                    )}
                  </>
                ) : (
                  showEditButtonPerm && (
                    <Button
                      type="button"
                      onClick={handleEditClick}
                      variant="secondary"
                    >
                      <SquarePen className="h-4 w-4 mr-1" />
                      {tCommon("actions.edit")}
                    </Button>
                  )
                )}
                {!isEditMode &&
                  milestone &&
                  !milestone.isCompleted &&
                  canCompleteMilestonePerm && (
                    <Button
                      type="button"
                      onClick={() => setIsCompleteDialogOpen(true)}
                      variant="secondary"
                      className="mt-2"
                    >
                      <CircleCheckBig className="h-4 w-4 mr-1" />
                      {tCommon("actions.complete")}
                    </Button>
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

            <ResizablePanelGroup
              direction="horizontal"
              className="min-h-[400px]"
              autoSaveId="milestone-panels"
            >
              <ResizablePanel defaultSize={80} minSize={20}>
                <div className="px-4 h-full space-y-4">
                  <FormField
                    name="docs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("labels.documentation")}</FormLabel>
                        {isEditMode ||
                        (milestone?.docs &&
                          milestone?.docs !==
                            JSON.stringify(emptyEditorContent)) ? (
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
                        {t("labels.forecast")}
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
                                  {t("empty.childMilestones")}
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
                                  configurationGroupId: testRun.configurationGroupId,
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
                                  testCases: testRun.testCases,
                                  createdBy: testRun.createdBy,
                                  forecastManual: testRun.forecastManual,
                                  forecastAutomated: testRun.forecastAutomated,
                                };
                              return (
                                <TestRunItem
                                  key={testRun.id}
                                  testRun={transformedTestRun}
                                  showMilestone={false}
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
                                showMilestone={false}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-sm">
                            {t("empty.sessions")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={20} minSize={10}>
                <div className="pl-4 pr-1 pb-1 h-full">
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
            toast.success(t("toast.updated", { name: milestone.name }));
            router.refresh();
          }}
        />
      )}
    </FormProvider>
  );
}
