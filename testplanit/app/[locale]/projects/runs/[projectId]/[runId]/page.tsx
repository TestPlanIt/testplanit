"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { AttachmentChanges } from "@/components/AttachmentsDisplay";
import {
  ConfigurationGroupLinkField,
  type ConfigurationGroupLinkChange,
} from "@/components/ConfigurationGroupLinkField";
import TestRunResultsDonut from "@/components/dataVisualizations/TestRunResultsDonut";
import { DateFormatter } from "@/components/DateFormatter";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { transformMilestones } from "@/components/forms/MilestoneSelect";
import { Loading } from "@/components/Loading";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import { RequestReviewButton } from "@/components/reviews/RequestReviewButton";
import { RunAuditLogSheet } from "@/components/runs/RunAuditLogSheet";
import { RecordId } from "@/components/RecordId";
import { ReviewStatusBanner } from "@/components/reviews/ReviewStatusBanner";
import { TestRunCaseDetails } from "@/components/TestRunCaseDetails";
import { TestCaseDetailsView } from "@/projects/repository/[projectId]/[caseId]/TestCaseDetailsView";
import {
  useTestRunLiveStream,
  type TestRunWakeUp,
} from "~/hooks/useTestRunLiveStream";
import { useTransitionGateStatus } from "~/hooks/useTransitionGateStatus";
import { IterationAwareTestRunCaseDetails } from "~/components/iterations/IterationAwareTestRunCaseDetails";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ActionBar,
  ActionButtonContent,
  ActionOverflow,
  collapsibleActionClass,
  useContainerCompact,
} from "@/components/ui/action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SimpleDndProvider } from "@/components/ui/SimpleDndProvider";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { ApplicationArea } from "~/zenstack/models";
import type { Attachments, Tags } from "~/zenstack/models";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/react";
import {
  ArrowLeft,
  ChevronLeft,
  CircleCheckBig,
  CircleSlash2,
  CopyPlus,
  FileDown,
  History,
  Loader2,
  Lock,
  LockOpen,
  Maximize2,
  PlayCircle,
  Save,
  SquarePen,
  Trash2,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Resolver } from "react-hook-form";
import { FormProvider, useForm } from "react-hook-form";
import { PanelImperativeHandle } from "react-resizable-panels";
import { z } from "zod/v4";
import { emptyEditorContent } from "~/app/constants";
import {
  applyConfigurationGroupPeerStamp,
  canEditConfigurationGroup,
  configurationGroupUpdateData,
} from "~/lib/configurationGroupLink";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { CommentsSection } from "~/components/comments/CommentsSection";
import TestRunCasesSummary from "~/components/TestRunCasesSummary";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useTestRunCaseDetail } from "~/hooks/useTestRunCaseDetail";
import { PaginationProvider } from "~/lib/contexts/PaginationContext";
import { Link, usePathname, useRouter } from "~/lib/navigation";
import { updateTestRunForecast } from "~/services/testRunService";
import { IconName } from "~/types/globals";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { useExportTestRunPdf } from "~/hooks/pdf/useExportTestRunPdf";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import AddTestRunModal from "../AddTestRunModal";
import DuplicateTestRunDialog, {
  AddTestRunModalInitProps,
} from "../DuplicateTestRunDialog";
import CompleteTestRunDialog from "./CompleteTestRunDialog";
import { DistributeAssignmentsModal } from "./DistributeAssignmentsModal";
import { DeleteTestRunModal } from "./DeleteTestRun";
import JunitChartsPanel from "./JunitChartsPanel";
import JunitResultsPanel from "./JunitResultsPanel";
import {
  SelectedConfigurationInfo,
  TestCasesSection,
} from "./TestCasesSection";
import { type LinkAttachmentInput } from "@/components/UploadAttachments";
import TestRunFormControls from "./TestRunFormControls";

// Form Values interface
interface FormValues {
  name: string;
  configId: number | null;
  milestoneId: number | null;
  stateId: number;
  note: any;
  docs: any;
  attachments: Attachments[];
  selectedIssues: number[];
  /** Configuration-group membership; null when this run is not linked. */
  configurationGroupId: string | null;
}

// Base schema
const BaseFormSchema = z.object({
  name: z.string().min(2),
  configId: z.number().nullable(),
  milestoneId: z.number().nullable(),
  stateId: z.number(),
  note: z.any().nullable(),
  docs: z.any().nullable(),
  attachments: z.array(z.any()).optional(),
  selectedIssues: z.array(z.number()),
  configurationGroupId: z.string().nullable(),
});

type MilestoneWithType = {
  id: number;
  name: string;
  projectId: number;
  milestoneType: {
    id: number;
    name: string;
    isDeleted: boolean;
    iconId: number | null;
    isDefault: boolean;
    icon: {
      id: number;
      name: string;
    } | null;
  } | null;
};

type IssueType = {
  id: number;
  name: string;
  externalId: string | null;
  externalUrl?: string | null;
  externalKey?: string | null;
  title?: string | null;
  externalStatus?: string | null;
  data?: any;
  integrationId?: number | null;
  integration?: {
    id: number;
    provider: string;
    name: string;
  } | null;
};

type WorkflowStateWithRelations = {
  id: number;
  name: string;
  order: number;
  iconId: number;
  colorId: number;
  isEnabled: boolean;
  isDeleted: boolean;
  isDefault: boolean;
  workflowType: string;
  scope: string;
  requiresReview?: boolean | null;
  icon: {
    id: number;
    name: string;
  } | null;
  color: {
    id: number;
    order: number;
    value: string;
    colorFamilyId: number;
  } | null;
};

type TestRunWithRelations = {
  id: number;
  name: string;
  configId: number | null;
  milestoneId: number | null;
  stateId: number;
  note: any;
  docs: any;
  createdAt: Date;
  isDeleted: boolean;
  isCompleted: boolean;
  completedAt: Date | null;
  compositionLockedAt: Date | null;
  compositionLockedById: string | null;
  compositionLockedBy: { id: string; name: string } | null;
  forecastManual: number | null;
  forecastAutomated: number | null;
  project: { id: number; name: string };
  configuration: { id: number; name: string } | null;
  configurationGroupId: string | null;
  milestone: MilestoneWithType | null;
  state: WorkflowStateWithRelations;
  createdBy: { id: string; name: string };
  attachments: Attachments[];
  testCases: Array<{
    id: number;
    order: number;
    repositoryCaseId: number;
    totalIterations: number;
    status: {
      id: number;
      name: string;
      color: {
        value: string;
      };
    } | null;
  }>;
  tags: Tags[];
  issues: IssueType[];
};

type _MilestoneOption = {
  value: string;
  label: string;
  milestoneType?: {
    icon?: { name?: IconName } | null;
  };
  parentId: number | null;
};

export default function TestRunPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { projectId, runId } = useParams();
  const safeProjectId = projectId?.toString() || "";
  const numericProjectId = parseInt(safeProjectId, 10);
  const isValidProjectId = !isNaN(numericProjectId);
  const { data: session } = useSession();
  const [isEditMode, setIsEditMode] = useState(
    searchParams.get("edit") === "true"
  );
  const [isMultiConfigSelected, setIsMultiConfigSelected] = useState(false);
  const [selectedConfigurations, setSelectedConfigurations] = useState<
    SelectedConfigurationInfo[]
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<number[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<number[]>([]);
  const [noteContent, setNoteContent] =
    useState<JSONContent>(emptyEditorContent);
  const [docsContent, setDocsContent] =
    useState<JSONContent>(emptyEditorContent);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState(false);
  const [isCollapsedRight, setIsCollapsedRight] = useState(false);
  const [isTransitioningLeft, setIsTransitioningLeft] = useState(false);
  const [isTransitioningRight, setIsTransitioningRight] = useState(false);
  const panelRightRef = useRef<PanelImperativeHandle>(null);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormLoading] = useState(false);
  const [, setInitialValues] = useState<FormValues | null>(null);
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const panelLeftRef = useRef<PanelImperativeHandle>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<LinkAttachmentInput[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [pendingAttachmentChanges, setPendingAttachmentChanges] =
    useState<AttachmentChanges>({ edits: [], deletes: [] });
  const { mutateAsync: createAttachments } =
    useClientQueries(schema).attachments.useCreate();
  const { mutateAsync: updateAttachments } =
    useClientQueries(schema).attachments.useUpdate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingTestRun, setIsDeletingTestRun] = useState(false);
  // Action bar collapses into a kebab when the header is narrow (mirrors the
  // repository case details bar).
  const { ref: headerRef, compact: headerCompact } = useContainerCompact();
  const [auditOpen, setAuditOpen] = useState(false);
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isRemoveCasesDialogOpen, setIsRemoveCasesDialogOpen] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormValues | null>(
    null
  );
  const { mutateAsync: softDeleteTestRunResults } =
    useClientQueries(schema).testRunResults.useUpdateMany();
  const { mutateAsync: softDeleteTestRunStepResults } =
    useClientQueries(schema).testRunStepResults.useUpdateMany();
  const { mutateAsync: softDeleteTestRunCaseIterations } =
    useClientQueries(schema).testRunCaseIteration.useUpdateMany();
  // Peer awaiting a `configurationGroupId` stamp — set when the user links
  // this run to a peer that had no group of its own, cleared once saved.
  const [configGroupStampTargetId, setConfigGroupStampTargetId] = useState<
    number | null
  >(null);
  const [zoomedChart, setZoomedChart] = useState<null | "donut">(null);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [isDistributeDialogOpen, setIsDistributeDialogOpen] = useState(false);

  // State for AddTestRunModal when opened for duplication
  const [isAddRunModalOpenForDuplicate, setIsAddRunModalOpenForDuplicate] =
    useState(false);
  const [
    addRunModalInitPropsForDuplicate,
    setAddRunModalInitPropsForDuplicate,
  ] = useState<AddTestRunModalInitProps | null>(null);

  // Fetch TestRuns permissions
  const {
    permissions: testRunPermissions,
    isProjectAdmin,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(numericProjectId, ApplicationArea.TestRuns);

  // Fetch ClosedTestRuns permissions
  const {
    permissions: closedTestRunPermissions,
    isLoading: isLoadingClosedPermissions,
  } = useProjectPermissions(numericProjectId, ApplicationArea.ClosedTestRuns);

  // Fetch Tags permission
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.Tags);

  // Fetch TestCaseRepository permission — gates in-place case editing from the
  // execution details Sheet.
  const { permissions: caseRepoPermissions } = useProjectPermissions(
    numericProjectId,
    ApplicationArea.TestCaseRepository
  );
  const canAddEditCases = caseRepoPermissions?.canAddEdit ?? false;

  // Extract permissions
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;
  const canDeleteRun = testRunPermissions?.canDelete ?? false;
  const canCloseRun = testRunPermissions?.canClose ?? false;
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;

  const [isTogglingCompositionLock, setIsTogglingCompositionLock] =
    useState(false);

  // Get the selected test case ID from URL parameters
  const selectedTestCaseId = searchParams.get("selectedCase")
    ? parseInt(searchParams.get("selectedCase")!)
    : null;

  // In-place case editing inside the details Sheet. Uses its own `editCase`
  // param — `edit` already means "edit the run" on this page.
  const editingSelectedCase =
    !!selectedTestCaseId &&
    searchParams.get("editCase") === "true" &&
    canAddEditCases;

  const { data: statusScope } = useClientQueries(
    schema
  ).statusScope.useFindFirst({
    where: {
      name: "Automation",
    },
  });

  // Define the form schema with translations inside the component
  const FormSchema = BaseFormSchema.superRefine((_data, _ctx) => {
    // Add any additional validation if needed
  });

  // Fetch test run data
  const { data: testRunData, refetch: refetchTestRun } = useClientQueries(
    schema
  ).testRuns.useFindUnique(
    {
      where: {
        id: Number(runId),
      },
      include: {
        project: true,
        configuration: true,
        milestone: {
          include: {
            milestoneType: {
              include: {
                icon: true,
              },
            },
          },
        },
        state: {
          include: {
            icon: true,
            color: true,
          },
        },
        createdBy: true,
        compositionLockedBy: { select: { id: true, name: true } },
        attachments: true,
        // Keep this select thin: a run can hold thousands of cases and this
        // relation is unpaginated, so don't hydrate repositoryCase (or other
        // relations) here. The case table (ProjectRepository) fetches its own
        // data; this list only feeds id/order/status lookups.
        testCases: {
          where: { isDeleted: false },
          select: {
            id: true,
            order: true,
            repositoryCaseId: true,
            totalIterations: true,
            status: {
              select: {
                id: true,
                name: true,
                color: {
                  select: {
                    value: true,
                  },
                },
              },
            },
          },
        },
        tags: true,
        issues: {
          select: {
            id: true,
            name: true,
            externalId: true,
            externalUrl: true,
            externalKey: true,
            title: true,
            externalStatus: true,
            data: true,
            integrationId: true,
            lastSyncedAt: true,
            issueTypeName: true,
            issueTypeIconUrl: true,
            integration: {
              select: {
                id: true,
                provider: true,
                name: true,
              },
            },
          },
        },
      },
    },
    {
      enabled: !isNaN(Number(runId)),
    }
  ) as {
    data: (TestRunWithRelations & { testRunType?: string }) | null;
    refetch: () => void;
  };

  // Execution-start composition lock (BOR-1): freezes which cases are in the
  // run (add/remove/reorder) while execution & assignment continue. Locking is
  // open to any run editor; unlocking is gated to the run creator / a Project
  // Admin / system ADMIN.
  const compositionLocked = !!testRunData?.compositionLockedAt;
  const canUnlockComposition =
    isSuperAdmin ||
    isProjectAdmin ||
    (!!session?.user?.id && testRunData?.createdBy?.id === session.user.id);

  const setCompositionLock = async (locked: boolean) => {
    if (isTogglingCompositionLock) return;
    setIsTogglingCompositionLock(true);
    try {
      const res = await fetch(
        `/api/test-runs/${Number(runId)}/composition-lock`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locked }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      await refetchTestRun();
    } catch (error) {
      console.error("Failed to update composition lock:", error);
      toast.error(
        locked
          ? t("runs.composition.lockError")
          : t("runs.composition.unlockError")
      );
    } finally {
      setIsTogglingCompositionLock(false);
    }
  };

  // SSE wake-up: refetch the run (which carries the per-case statuses)
  // AND invalidate the testRunSummary query that TestRunCasesSummary
  // reads (a separate endpoint, a separate cache key, but the same
  // underlying mutation that fires the wake-up). Two consumers per
  // wake-up, one open EventSource at the page level — TestRunCasesSummary
  // no longer opens its own. Auth lives on the refetch path; the pub/sub
  // layer is untrusted plumbing (Architectural Directive 2). Stream is
  // disabled once the run is completed so we don't hold an EventSource
  // open indefinitely on a historical run page.
  const queryClient = useQueryClient();
  const onLiveWakeUp = useCallback(
    (event: TestRunWakeUp) => {
      // Ignore the `sync` checkpoint (fires on every reconnect) so routine
      // EventSource reconnects don't refetch the run + summary + JUnit suites.
      if (event.event === "sync") return;
      refetchTestRun();
      void queryClient.invalidateQueries({
        queryKey: ["testRunSummary", Number(runId)],
      });
      // Automation runs render their results from JUnit suites; refresh those
      // so reporter-streamed results appear live (the run refetch alone doesn't
      // cover the separate suite/result query).
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "JUnitTestSuite"],
      });
    },
    [refetchTestRun, queryClient, runId]
  );
  useTestRunLiveStream({
    runId: !isNaN(Number(runId)) ? Number(runId) : null,
    enabled: !testRunData?.isCompleted,
    onWakeUp: onLiveWakeUp,
  });

  // PDF export hook — fetches its own (heavier) data on demand when exporting.
  const { isExporting: isExportingPdf, handleExport: handleExportPdf } =
    useExportTestRunPdf({
      testRunId: Number(runId),
      projectId: Number(projectId),
    });

  // Fetch JUnit test suites if this is a JUNIT run
  const isJUnitRun = isAutomatedTestRunType(testRunData?.testRunType);
  const { data: jUnitSuites, isLoading: isJUnitLoading } = useClientQueries(
    schema
  ).jUnitTestSuite.useFindMany(
    isJUnitRun
      ? {
          where: { testRunId: Number(runId) },
          include: {
            properties: true,
            results: {
              include: {
                status: {
                  select: { name: true, color: { select: { value: true } } },
                },
                attachments: {
                  where: { isDeleted: false },
                },
                repositoryCase: {
                  select: {
                    name: true,
                    className: true,
                    source: true,
                    isDeleted: true,
                    linksFrom: {
                      select: {
                        caseBId: true,
                        type: true,
                        isDeleted: true,
                      },
                    },
                    linksTo: {
                      select: {
                        caseAId: true,
                        type: true,
                        isDeleted: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }
      : undefined,
    { enabled: isJUnitRun }
  );

  const _canEdit =
    (session?.user.access === "ADMIN" ||
      session?.user.access === "PROJECTADMIN") &&
    !testRunData?.isCompleted;

  // Set up form with proper typing
  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(FormSchema) as Resolver<FormValues>,
    defaultValues: {
      name: "",
      configId: null,
      milestoneId: null,
      stateId: 0,
      note: null,
      docs: null,
      attachments: [],
      selectedIssues: [],
      configurationGroupId: null,
    },
    mode: "onSubmit",
  });

  // Add data fetching queries
  const { data: workflows } = useClientQueries(schema).workflows.useFindMany({
    where: {
      isDeleted: false,
      isEnabled: true,
      scope: "RUNS",
      projects: {
        some: {
          projectId: Number(projectId),
        },
      },
    },
    include: {
      icon: true,
      color: true,
    },
    orderBy: {
      order: "asc",
    },
  });

  const { data: milestones } = useClientQueries(schema).milestones.useFindMany({
    where: {
      projectId: Number(projectId),
      isDeleted: false,
      isCompleted: false,
    },
    include: {
      milestoneType: {
        include: {
          icon: true,
        },
      },
    },
    orderBy: [{ startedAt: "asc" }, { isStarted: "asc" }],
  });

  // Transform milestones for the select component
  const milestoneOptions = transformMilestones(milestones || []);

  const reachableGatedStates = useMemo(() => {
    if (!workflows || !testRunData) return [];
    const currentStateId = testRunData.stateId;
    // Only gates STRICTLY AFTER the current state — see the matching
    // comment on the test-case detail page.
    const currentStateOrder =
      workflows.find((w) => w.id === currentStateId)?.order ?? -Infinity;
    return workflows
      .filter(
        (w) =>
          w.requiresReview === true &&
          w.id !== currentStateId &&
          w.order > currentStateOrder
      )
      .map((w) => ({
        id: w.id,
        name: w.name,
        icon: { name: (w.icon?.name ?? "circle") as string },
        color: { value: w.color?.value ?? "" },
      }));
  }, [workflows, testRunData]);

  const transitionGate = useTransitionGateStatus(
    "RUN",
    testRunData?.id ?? 0,
    testRunData?.stateId ?? null,
    Number(projectId)
  );
  const watchedStateId = form.watch("stateId");
  const transitionCheck = transitionGate.canTransitionTo(watchedStateId);

  // Update form initialization
  useEffect(() => {
    if (testRunData && !isSubmitting) {
      const initialData = {
        name: testRunData.name,
        configId: testRunData.configId,
        milestoneId: testRunData.milestoneId,
        stateId: testRunData.stateId,
        note: testRunData.note || JSON.stringify(emptyEditorContent),
        docs: testRunData.docs || JSON.stringify(emptyEditorContent),
        attachments: testRunData.attachments || [],
        selectedIssues: testRunData.issues.map((issue) => issue.id),
        configurationGroupId: testRunData.configurationGroupId ?? null,
      };
      form.reset(initialData, {
        keepDefaultValues: true,
      });
      setInitialValues(initialData);
      setSelectedTags(testRunData.tags.map((tag) => tag.id));
      setSelectedIssues(testRunData.issues.map((issue) => issue.id));
      setSelectedTestCaseIds(
        testRunData.testCases.map((tc) => tc.repositoryCaseId)
      );
      setIsFormInitialized(true);
    }
  }, [testRunData, form, isSubmitting]);

  // Handle edit mode changes
  useEffect(() => {
    // Update isEditMode based on URL parameter
    const isEditing = searchParams.get("edit") === "true";
    if (isEditing !== isEditMode) {
      setIsEditMode(isEditing);
    }
  }, [searchParams, isEditMode]);

  // Update loading state when data changes
  // Note: configurations and workflows are not required for initial render (only needed in edit mode)
  useEffect(() => {
    setIsLoading(
      isLoadingPermissions ||
        isLoadingClosedPermissions ||
        isLoadingTagsPermissions ||
        !testRunData ||
        !isFormInitialized
    );
  }, [
    isLoadingPermissions,
    isLoadingClosedPermissions,
    isLoadingTagsPermissions,
    testRunData,
    isFormInitialized,
  ]);

  // Scroll to hash anchor after page loads
  const scrolledHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLoading && typeof window !== "undefined") {
      const hash = window.location.hash;
      // Scroll once per hash so loading-state flips don't yank the viewport back
      if (hash && scrolledHashRef.current !== hash) {
        // Wait a bit for the DOM to be fully rendered
        setTimeout(() => {
          const element = document.querySelector(hash);
          if (element) {
            scrolledHashRef.current = hash;
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }, [isLoading]);

  // Add mutation hooks
  const { mutateAsync: updateTestRuns } =
    useClientQueries(schema).testRuns.useUpdate();

  // Add form controls
  const {
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = form;

  // Panel controls
  const _toggleCollapseLeft = () => {
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

  // Sheet controls
  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      // If sheet is closing, remove selectedCase from URL
      const params = new URLSearchParams(searchParams.toString());
      params.delete("selectedCase");
      params.delete("editCase");
      router.replace(`${pathname}?${params.toString()}`);
    }
    // Opening is handled by URL change triggered from TestCasesSection clicking a row
  };

  const setEditCaseParam = (on: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (on) {
      params.set("editCase", "true");
    } else {
      params.delete("editCase");
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Fix the useEffect for content initialization to handle double-JSON-stringification
  useEffect(() => {
    if (testRunData) {
      // Initialize note content
      const noteData = testRunData.note || JSON.stringify(emptyEditorContent);
      try {
        // First parse - handle potentially double-stringified JSON
        const firstParse =
          typeof noteData === "string" ? JSON.parse(noteData) : noteData;

        // Check if the result is itself a string (double-encoded JSON)
        const parsedData =
          typeof firstParse === "string" ? JSON.parse(firstParse) : firstParse;

        if (parsedData && parsedData.type === "doc") {
          setNoteContent(parsedData);
        } else {
          setNoteContent(emptyEditorContent);
        }
      } catch (e) {
        console.error("Failed to parse note content:", e);
        setNoteContent(emptyEditorContent);
      }

      // Initialize docs content
      const docsData = testRunData.docs || JSON.stringify(emptyEditorContent);
      try {
        // First parse - handle potentially double-stringified JSON
        const firstParse =
          typeof docsData === "string" ? JSON.parse(docsData) : docsData;

        // Check if the result is itself a string (double-encoded JSON)
        const parsedData =
          typeof firstParse === "string" ? JSON.parse(firstParse) : firstParse;

        if (parsedData && parsedData.type === "doc") {
          setDocsContent(parsedData);
        } else {
          setDocsContent(emptyEditorContent);
        }
      } catch (e) {
        console.error("Failed to parse docs content:", e);
        setDocsContent(emptyEditorContent);
      }

      // Mark content as loaded after initialization
      setContentLoaded(true);
    } else {
      // If no testRunData, set default content and mark as loaded
      setNoteContent(emptyEditorContent);
      setDocsContent(emptyEditorContent);
      setContentLoaded(true);
    }
  }, [testRunData]);

  // Update initial tags loading
  useEffect(() => {
    if (testRunData?.tags) {
      setSelectedTags(testRunData.tags.map((tag) => tag.id));
    }
  }, [testRunData?.tags]);

  // Add new function to handle saving test run
  const saveTestRun = async (data: FormValues) => {
    try {
      // Get current test case IDs
      const currentTestCaseIds =
        testRunData?.testCases.map((tc) => tc.repositoryCaseId) || [];

      // Prepare note and docs content to avoid double-stringification
      let noteContent = data.note;
      if (typeof noteContent !== "string") {
        noteContent = JSON.stringify(noteContent);
      }

      let docsContent = data.docs;
      if (typeof docsContent !== "string") {
        docsContent = JSON.stringify(docsContent);
      }

      // Assigning `configurationGroupId` makes the RPC guard re-validate the
      // group and sweep it for auto-dissolve, so only send it when the user
      // actually changed it — an unchanged value can neither break an
      // invariant nor orphan a group.
      const groupChanged =
        (data.configurationGroupId ?? null) !==
        (testRunData?.configurationGroupId ?? null);

      // Everything below is written identically by BOTH update paths (the
      // cases-changed branch and the metadata-only branch). Building it once
      // is what keeps a newly added field — `configurationGroupId` being the
      // reason this exists — from silently no-opping on whichever branch a
      // future edit forgets.
      const sharedUpdateData = {
        name: data.name,
        configId: data.configId || null,
        milestoneId: data.milestoneId || null,
        stateId: data.stateId,
        note: noteContent,
        docs: docsContent,
        ...(groupChanged
          ? configurationGroupUpdateData(data.configurationGroupId)
          : {}),
        attachments: {
          set: [],
          connect:
            data.attachments?.map((attachment) => ({
              id: attachment.id,
            })) || [],
        },
        tags: {
          set: selectedTags.map((tagId) => ({ id: tagId })),
        },
        issues: {
          set: selectedIssues.map((issueId) => ({ id: issueId })),
        },
      };

      // Check if test cases have changed. A composition-locked run's case set is
      // frozen — never treat cases as changed (the UI disables selection; this
      // also keeps a stray diff from hitting the DB guard trigger).
      const hasTestCasesChanged =
        !compositionLocked &&
        (selectedTestCaseIds.length !== currentTestCaseIds.length ||
          !selectedTestCaseIds.every((id: number) =>
            currentTestCaseIds.includes(id)
          ) ||
          !currentTestCaseIds.every((id: number) =>
            selectedTestCaseIds.includes(id)
          ));

      // Handle test case changes
      if (hasTestCasesChanged) {
        const removedCaseIds = currentTestCaseIds.filter(
          (id: number) => !selectedTestCaseIds.includes(id)
        );
        const addedCaseIds = selectedTestCaseIds.filter(
          (id: number) => !currentTestCaseIds.includes(id)
        );

        if (removedCaseIds.length > 0) {
          await softDeleteTestRunStepResults({
            where: {
              testRunResult: {
                testRunCase: {
                  testRunId: Number(runId),
                  repositoryCaseId: { in: removedCaseIds },
                },
              },
            },
            data: { isDeleted: true },
          });

          await softDeleteTestRunResults({
            where: {
              testRunCase: {
                testRunId: Number(runId),
                repositoryCaseId: { in: removedCaseIds },
              },
            },
            data: { isDeleted: true },
          });

          await softDeleteTestRunCaseIterations({
            where: {
              testRunCase: {
                testRunId: Number(runId),
                repositoryCaseId: { in: removedCaseIds },
              },
            },
            data: { isDeleted: true },
          });
        }

        await updateTestRuns({
          where: {
            id: Number(runId),
          },
          data: {
            ...sharedUpdateData,
            testCases: {
              updateMany:
                removedCaseIds.length > 0
                  ? {
                      where: {
                        testRunId: Number(runId),
                        repositoryCaseId: { in: removedCaseIds },
                      },
                      data: { isDeleted: true },
                    }
                  : undefined,
              upsert: addedCaseIds.map((id: number, index: number) => ({
                where: {
                  testRunId_repositoryCaseId: {
                    testRunId: Number(runId),
                    repositoryCaseId: id,
                  },
                },
                create: {
                  repositoryCase: { connect: { id } },
                  order: currentTestCaseIds.length + index,
                },
                update: {
                  isDeleted: false,
                  order: currentTestCaseIds.length + index,
                },
              })),
            },
          },
        });

        await updateTestRunForecast(Number(runId));
      } else {
        // No test case changes, just update the basic info
        await updateTestRuns({
          where: {
            id: Number(runId),
          },
          data: sharedUpdateData,
        });
      }

      // A join against a peer that had no group of its own mints one uuid for
      // both records; this run was just stamped above, the peer is stamped
      // here. Rolls this run back if the peer write fails, and no-ops when
      // this save didn't move the run — see the helper.
      await applyConfigurationGroupPeerStamp({
        update: (args) => updateTestRuns(args),
        recordId: Number(runId),
        groupId: data.configurationGroupId,
        stampTargetId: configGroupStampTargetId,
        previousGroupId: testRunData?.configurationGroupId ?? null,
      });
      setConfigGroupStampTargetId(null);

      // Apply pending attachment edits
      const editPromises = pendingAttachmentChanges.edits.map(async (edit) => {
        await updateAttachments({
          where: { id: edit.id },
          data: {
            name: edit.name,
            note: edit.note,
          },
        });
      });

      // Apply pending attachment deletes (soft delete)
      const deletePromises = pendingAttachmentChanges.deletes.map(
        async (attachmentId) => {
          await updateAttachments({
            where: { id: attachmentId },
            data: { isDeleted: true },
          });
        }
      );

      // Wait for all pending changes to be applied
      await Promise.all([...editPromises, ...deletePromises]);

      // Handle new attachments (files OR external links)
      if (selectedFiles.length > 0 || selectedLinks.length > 0) {
        const _attachmentUrls = await uploadFiles(Number(runId));
      }

      // Reset pending changes
      setPendingAttachmentChanges({ edits: [], deletes: [] });
      setSelectedFiles([]);
      setSelectedLinks([]);

      await refetchTestRun();
      const params = new URLSearchParams(searchParams);
      params.delete("edit");
      router.replace(`?${params.toString()}`);
    } catch (err: any) {
      console.error("Save error:", err);
      form.setError("root", {
        type: "custom",
        message: `An error occurred: ${err.message}`,
      });
      throw err; // Re-throw to be caught by onSubmit
    }
  };

  // Configuration-group link/unlink. The control is offered in edit mode only,
  // so the change is staged here and written by `saveTestRun`, which sets the
  // field on both of its update paths.
  const handleConfigurationGroupChange = (
    change: ConfigurationGroupLinkChange
  ) => {
    setValue("configurationGroupId", change.groupId, { shouldDirty: true });
    setConfigGroupStampTargetId(change.stampTargetId);
  };

  // Update onSubmit function
  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      // Get current test case IDs
      const currentTestCaseIds =
        testRunData?.testCases.map((tc) => tc.repositoryCaseId) || [];

      // Check if test cases have changed. A composition-locked run's case set is
      // frozen — never treat cases as changed (the UI disables selection; this
      // also keeps a stray diff from hitting the DB guard trigger).
      const hasTestCasesChanged =
        !compositionLocked &&
        (selectedTestCaseIds.length !== currentTestCaseIds.length ||
          !selectedTestCaseIds.every((id: number) =>
            currentTestCaseIds.includes(id)
          ) ||
          !currentTestCaseIds.every((id: number) =>
            selectedTestCaseIds.includes(id)
          ));

      if (!hasTestCasesChanged) {
        // No changes to test cases, just save the test run
        await saveTestRun(data);
        setIsSubmitting(false); // Reset isSubmitting state after successful save
        return;
      }

      // Check if we're removing any test cases
      const removedTestCaseIds = currentTestCaseIds.filter(
        (id: number) => !selectedTestCaseIds.includes(id)
      );

      if (removedTestCaseIds.length > 0) {
        // We're removing test cases, show confirmation dialog
        setPendingFormData(data);
        setIsRemoveCasesDialogOpen(true);
        return;
      }

      // We're only adding test cases, proceed with save
      await saveTestRun(data);
      setIsSubmitting(false); // Reset isSubmitting state after successful save
    } catch (err: any) {
      console.error("Submit error:", err);
      form.setError("root", {
        type: "custom",
        message: `An error occurred: ${err.message}`,
      });
      setIsSubmitting(false); // Reset isSubmitting state on error
    }
  };

  // Add handler for remove cases confirmation
  const handleRemoveCasesConfirm = async () => {
    if (pendingFormData) {
      try {
        await saveTestRun(pendingFormData);
        setPendingFormData(null);
        setIsRemoveCasesDialogOpen(false);
      } finally {
        setIsSubmitting(false); // Reset isSubmitting state after operation completes
      }
    }
  };

  // Add handler for remove cases cancel
  const handleRemoveCasesCancel = () => {
    setPendingFormData(null);
    setIsRemoveCasesDialogOpen(false);
    setIsSubmitting(false); // Reset isSubmitting state when canceling
  };

  // Handle cancel
  const handleCancel = () => {
    // Reset pending attachment changes
    setPendingAttachmentChanges({ edits: [], deletes: [] });
    setSelectedFiles([]);
    setSelectedLinks([]);
    // Drop a staged group link. Unlike the other fields, this one is read back
    // out of the form to render the membership list, so leaving it staged
    // would show an abandoned link as though it were saved.
    setValue("configurationGroupId", testRunData?.configurationGroupId ?? null);
    setConfigGroupStampTargetId(null);
    // Exit edit mode
    const params = new URLSearchParams(searchParams.toString());
    params.delete("selectedCase"); // Also close sheet on cancel
    params.delete("edit");
    router.replace(`?${params.toString()}`);
  };

  // Handle edit mode toggle
  const handleEditClick = () => {
    // Enter edit mode and remove selectedCase parameter
    const params = new URLSearchParams(searchParams);
    params.set("edit", "true");
    params.delete("selectedCase");
    router.replace(`?${params.toString()}`);
  };

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const handleFileSelect = (files: File[]) => {
    setSelectedFiles(files);
  };

  const uploadFiles = async (testRunId: number) => {
    const prependString = session!.user.id;
    const sanitizedFolder = projectId?.toString() || "";

    const attachmentsPromises = selectedFiles.map(async (file) => {
      const fileUrl = await fetchSignedUrl(
        file,
        `/api/get-attachment-url/`,
        `${sanitizedFolder}/${prependString}`
      );

      const attachment = await createAttachments({
        data: {
          testRuns: {
            connect: { id: testRunId },
          },
          url: fileUrl,
          name: file.name,
          note: "",
          mimeType: file.type,
          size: BigInt(file.size),
          createdBy: {
            connect: { id: session!.user.id },
          },
        },
      });

      return {
        id: attachment?.id,
        url: fileUrl,
        name: file.name,
        note: "",
        mimeType: file.type,
        size: attachment?.size.toString(),
        createdBy: session!.user.name,
        createdAt: new Date().toISOString(),
        isDeleted: false,
        createdById: session!.user.id,
      };
    });

    const linkPromises = selectedLinks.map(async (link) => {
      const attachment = await createAttachments({
        data: {
          testRuns: {
            connect: { id: testRunId },
          },
          url: link.url,
          name: link.name,
          note: link.note ?? "",
          mimeType: link.mimeType,
          size: BigInt(link.size),
          createdBy: {
            connect: { id: session!.user.id },
          },
        },
      });

      return {
        id: attachment?.id,
        url: link.url,
        name: link.name,
        note: link.note ?? "",
        mimeType: link.mimeType,
        size: attachment?.size.toString(),
        createdBy: session!.user.name,
        createdAt: new Date().toISOString(),
        isDeleted: false,
        createdById: session!.user.id,
      };
    });

    const attachments = await Promise.all([
      ...attachmentsPromises,
      ...linkPromises,
    ]);
    return attachments;
  };

  // Add this function to handle test case changes
  const handleTestCasesChange = (testCaseIds: number[]) => {
    setSelectedTestCaseIds(testCaseIds);
  };

  // Only used below to clear `isTransitioning` once the case a "Next" click
  // navigated to has actually loaded. Shares its (caseId, testRunId) query
  // key with TestRunCaseDetails' own fetch of the same case, so React Query
  // dedupes them into one request instead of two independent ACL-heavy
  // queries. See lib/services/testRunCaseDetail.ts.
  const { data: testcase, isLoading: isTestcaseLoading } = useTestRunCaseDetail(
    selectedTestCaseId,
    Number(runId)
  );

  useEffect(() => {
    if (!isTestcaseLoading && testcase) {
      setIsTransitioning(false);
    }
  }, [isTestcaseLoading, testcase]);

  const sheetOpen = !!selectedTestCaseId;

  // Calculate effectiveCanDelete *after* loading checks and testRunData is available
  const effectiveCanDelete = testRunData?.isCompleted
    ? (closedTestRunPermissions?.canDelete ?? false)
    : canDeleteRun;

  // All JUnit-related hooks must be at the top level, before any early return
  const [junitSortConfig, setJunitSortConfig] = useState<
    { column: string; direction: "asc" | "desc" } | undefined
  >({ column: "executedAt", direction: "desc" });
  const junitTestCases = useMemo(() => {
    if (!jUnitSuites) return [];
    const mapped = jUnitSuites.flatMap((suite) =>
      (suite.results || []).map((result) => ({
        id: result.repositoryCaseId,
        name: result.repositoryCase?.name || String(result.repositoryCaseId),
        className:
          result.repositoryCase?.className || String(result.repositoryCaseId),
        source: result.repositoryCase?.source,
        suiteName: suite.name,
        suiteTests: suite.tests,
        suiteFailures: suite.failures,
        suiteErrors: suite.errors,
        suiteSkipped: suite.skipped,
        executedAt: result.executedAt || undefined,
        resultType: result.type || "PASSED",
        resultStatus: result.status?.name || result.type || "PASSED",
        resultColor:
          result.status?.color?.value ||
          (result.type === "FAILURE" || result.type === "ERROR"
            ? "rgb(239, 68, 68)"
            : result.type === "SKIPPED"
              ? "rgb(161, 161, 170)"
              : "rgb(34, 197, 94)"),
        message: result.message,
        time: result.time,
        assertions: result.assertions,
        systemOutput: result.systemOut,
        systemError: result.systemErr,
        createdAt: result.createdAt || testRunData?.createdAt,
        createdById: testRunData?.createdBy?.id,
        linksFrom: result.repositoryCase?.linksFrom || [],
        linksTo: result.repositoryCase?.linksTo || [],
        isDeleted: result.repositoryCase?.isDeleted || false,
        attachments: result.attachments || [],
      }))
    );
    return mapped;
  }, [jUnitSuites, testRunData?.createdBy?.id, testRunData?.createdAt]);
  const [junitTestCasesState, setJunitTestCasesState] = useState<any[]>([]);
  useEffect(() => {
    setJunitTestCasesState(junitTestCases);
  }, [junitTestCases]);
  const sortedJunitTestCases = useMemo(() => {
    if (!junitSortConfig) return junitTestCasesState;
    const { column, direction } = junitSortConfig;
    return [...junitTestCasesState].sort((a, b) => {
      const aValue = a[column];
      const bValue = b[column];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === "number" && typeof bValue === "number") {
        return direction === "asc" ? aValue - bValue : bValue - aValue;
      }
      return direction === "asc"
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
  }, [junitTestCasesState, junitSortConfig]);
  const handleJunitSortChange = (column: string) => {
    setJunitSortConfig((prev) => {
      if (prev?.column === column) {
        if (prev.direction === "asc") {
          return { column, direction: "desc" };
        } else {
          return undefined; // Remove sort
        }
      } else {
        return { column, direction: "asc" };
      }
    });
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleJunitSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      // The JUnit sorter returns the raw API order for a falsy config, so
      // "Remove sort" must restore the table's actual default instead.
      setJunitSortConfig({ column: "executedAt", direction: "desc" });
    } else {
      setJunitSortConfig({ column, direction });
    }
  };

  // --- REGULAR TEST RUN TABLE STATE ---
  // Fetch status distribution from view-options API for accurate counts across selected configurations
  const effectiveRunIdsForResults = useMemo(() => {
    if (selectedConfigurations.length > 1) {
      return selectedConfigurations.map((c) => c.id);
    }
    if (selectedConfigurations.length === 1) {
      return [selectedConfigurations[0].id];
    }
    return [Number(runId)];
  }, [selectedConfigurations, runId]);

  // Fetch view options to get accurate status counts for the donut chart
  const { data: viewOptionsData } = useQuery({
    queryKey: [
      "viewOptions",
      "donutChart",
      numericProjectId,
      ...effectiveRunIdsForResults,
    ],
    queryFn: async () => {
      const response = await fetch("/api/repository-cases/view-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: numericProjectId,
          isRunMode: true,
          runIds: effectiveRunIdsForResults,
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to fetch view options");
      }
      return response.json();
    },
    enabled: selectedConfigurations.length > 0 && isValidProjectId,
    staleTime: 30000,
  });

  // Build donut chart data from view options testRunOptions.statuses
  const donutChartData = useMemo(() => {
    const statuses = viewOptionsData?.testRunOptions?.statuses;
    if (!statuses || !Array.isArray(statuses)) return [];

    // Filter out statuses with 0 count
    return statuses
      .filter((status: any) => status.count > 0)
      .map((status: any) => ({
        id: status.id,
        name: status.name,
        color: status.color?.value || "#888888",
        value: status.count,
      }));
  }, [viewOptionsData]);

  // Callback for DuplicateTestRunDialog to pass data and proceed to AddTestRunModal
  const handlePrepareCloneDataAndProceed = useCallback(
    (props: AddTestRunModalInitProps) => {
      setAddRunModalInitPropsForDuplicate(props);
      setIsAddRunModalOpenForDuplicate(true);
      setIsDuplicateDialogOpen(false); // Close the duplicate options dialog
    },
    [] // Empty dependency array as it only uses setters
  );

  // Now, after all hooks, you can have your early returns:
  if (
    isLoading ||
    isLoadingPermissions ||
    isLoadingClosedPermissions ||
    isLoadingTagsPermissions ||
    !isFormInitialized
  )
    return <Loading />;

  // Skip redirect checks if we're in the process of deleting this test run
  // The delete flow will handle navigation
  if (!isDeletingTestRun) {
    if (!isValidProjectId || testRunData?.isDeleted) {
      router.push(`/projects/runs/${projectId}`);
      return (
        <div className="text-muted-foreground text-center p-4">
          {t("runs.notFound")}
        </div>
      );
    }

    // Re-add the check for testRunData before proceeding to render JUNIT or regular run view
    if (!testRunData) {
      router.push(`/projects/runs/${projectId}`);
      return (
        <div className="text-muted-foreground text-center p-4">
          {t("runs.notFound")}
        </div>
      );
    }
  }

  // If we're deleting and testRunData is gone, just show loading while navigation happens
  if (isDeletingTestRun && !testRunData) {
    return <Loading />;
  }

  // At this point, testRunData must exist (either we're not deleting, or we're deleting but data still exists)
  // This check satisfies TypeScript's null analysis
  if (!testRunData) {
    return <Loading />;
  }

  // Description (note) + Documentation (docs) editors — rendered for BOTH
  // manual and automated runs (automated runs receive docs content from the
  // reporters' run-level metadata, so they must display and stay editable).
  const narrativeFields = (
    <>
      {isEditMode || (contentLoaded && !isTiptapEmpty(noteContent)) ? (
        <FormField
          control={form.control}
          name="note"
          render={({ field: _field }) => (
            <FormItem>
              <FormLabel>{t("common.fields.description")}</FormLabel>
              <FormControl>
                {contentLoaded ? (
                  <div className="min-h-[50px] max-h-[125px] overflow-y-auto border rounded-md">
                    <TipTapEditor
                      key={`editing-note-${isEditMode}`}
                      content={noteContent}
                      onUpdate={(newContent) => {
                        if (isEditMode) {
                          setNoteContent(newContent);
                          setValue("note", newContent, {
                            shouldValidate: true,
                          });
                        }
                      }}
                      readOnly={!isEditMode || !canAddEditRun}
                      className="h-auto"
                      placeholder={t("common.fields.description_placeholder")}
                      projectId={safeProjectId}
                    />
                  </div>
                ) : (
                  <div className="h-[150px] flex items-center justify-center bg-muted rounded-md">
                    <Loading />
                  </div>
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
      {/* Documentation */}
      {isEditMode || (contentLoaded && !isTiptapEmpty(docsContent)) ? (
        <FormField
          control={form.control}
          name="docs"
          render={({ field: _field }) => (
            <FormItem>
              <FormLabel>{t("common.fields.documentation")}</FormLabel>
              <FormControl>
                {contentLoaded ? (
                  <div className="min-h-[50px] max-h-[250px] overflow-y-auto border rounded-md">
                    <TipTapEditor
                      key={`editing-docs-${isEditMode}`}
                      content={docsContent}
                      onUpdate={(newContent) => {
                        if (isEditMode) {
                          setDocsContent(newContent);
                          setValue("docs", newContent, {
                            shouldValidate: true,
                          });
                        }
                      }}
                      readOnly={!isEditMode || !canAddEditRun}
                      className="h-auto"
                      placeholder={t("common.placeholders.docs")}
                      projectId={safeProjectId}
                    />
                  </div>
                ) : (
                  <div className="h-[250px] flex items-center justify-center bg-muted rounded-md">
                    <Loading />
                  </div>
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
      {/* Add separator after notes/docs if they exist */}
      {!isEditMode &&
        contentLoaded &&
        (!isTiptapEmpty(noteContent) || !isTiptapEmpty(docsContent)) && (
          <Separator className="my-4" />
        )}
    </>
  );

  return (
    <Card
      className={`group-hover:bg-accent/50 transition-colors ${testRunData?.isCompleted ? "bg-muted-foreground/20 border-muted-foreground" : ""}`}
    >
      {isSubmitting && <LoadingSpinnerAlert />}
      {isFormLoading && <LoadingSpinnerAlert />}
      <FormProvider {...form}>
        <form
          key={`test-run-form-${isEditMode ? "edit" : "view"}-${testRunData?.id}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!isEditMode) return;
            void handleSubmit(onSubmit)(e);
          }}
        >
          {!isJUnitRun && (
            <div className="px-6 pt-6">
              <ReviewStatusBanner
                entityType="RUN"
                entityId={testRunData.id}
                projectId={Number(projectId)}
                entityName={testRunData.name || ""}
                reachableGatedStates={reachableGatedStates}
                currentStateId={testRunData.stateId}
              />
            </div>
          )}
          <CardHeader>
            <div
              ref={headerRef}
              className="flex justify-between items-center gap-2"
            >
              {!isEditMode && (
                <div className="me-2">
                  <Link href={`/projects/runs/${projectId}`}>
                    <Button type="button" variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
              <CardTitle className="flex-1 pe-4 text-xl md:text-2xl me-4">
                {isEditMode ? (
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            className="text-xl md:text-2xl me-4"
                            readOnly={!canAddEditRun}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : (
                  <span className="flex items-center gap-2">
                    <PlayCircle className="h-6 w-6 shrink-0" />
                    {testRunData?.name}
                    {compositionLocked && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="shrink-0">
                            <Lock className="h-5 w-5 text-muted-foreground" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("runs.composition.locked")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                )}
              </CardTitle>
              <div className="flex flex-col items-end gap-1">
                {!isEditMode && testRunData && (
                  <RecordId
                    type="TEST_RUN"
                    id={testRunData.id}
                    projectId={numericProjectId}
                    className="shrink-0 whitespace-nowrap"
                  />
                )}
                <ActionBar
                  compact={headerCompact}
                  className="items-end gap-2 flex-wrap"
                >
                  {testRunData?.isCompleted ? (
                    <div className="flex flex-col items-end gap-1">
                      {/* Row 1: completed badge — the "on <date>" part
                          collapses to just the check + "Completed" when the
                          header is narrow. */}
                      <Badge
                        variant="secondary"
                        className="flex items-center whitespace-nowrap text-xs gap-1 p-2 px-4"
                      >
                        <CircleCheckBig className="h-4 w-4 shrink-0" />
                        <span>{t("common.fields.completed")}</span>
                        {!headerCompact && (
                          <span>
                            {t("common.on")}{" "}
                            <DateFormatter
                              date={testRunData?.completedAt}
                              formatString={
                                session?.user.preferences?.dateFormat
                              }
                              timezone={session?.user.preferences?.timezone}
                            />
                          </span>
                        )}
                      </Badge>
                      {/* Row 2: activity log + action buttons for COMPLETED runs */}
                      <div className="flex items-center gap-1">
                        {testRunData && (
                          <RunAuditLogSheet
                            runId={testRunData.id}
                            hideTrigger
                            open={auditOpen}
                            onOpenChange={setAuditOpen}
                          />
                        )}
                        <ActionOverflow
                          compact={headerCompact}
                          menuLabel={t("common.actions.actionsLabel")}
                          actions={[
                            {
                              key: "activity",
                              icon: History,
                              label: t("common.fields.activityLog"),
                              onClick: () => setAuditOpen(true),
                            },
                            {
                              key: "duplicate",
                              icon: CopyPlus,
                              label: t("common.actions.duplicate"),
                              onClick: () => setIsDuplicateDialogOpen(true),
                              hidden: !(
                                canAddEditRun &&
                                !isAutomatedTestRunType(
                                  testRunData?.testRunType
                                )
                              ),
                            },
                            {
                              key: "export",
                              icon: FileDown,
                              label: isExportingPdf
                                ? t("common.actions.exportingPdf")
                                : t("common.actions.exportPdf"),
                              onClick: handleExportPdf,
                              disabled: isExportingPdf,
                            },
                            {
                              key: "delete",
                              icon: Trash2,
                              label: t("common.actions.delete"),
                              onClick: () => setIsDeleteDialogOpen(true),
                              destructive: true,
                              hidden: !effectiveCanDelete,
                            },
                          ]}
                        />
                      </div>
                    </div>
                  ) : (
                    // Buttons for NON-COMPLETED runs
                    <>
                      {!isEditMode ? (
                        // View Mode Buttons for NON-COMPLETED runs
                        <div className="flex flex-col items-end gap-1">
                          {/* Row 1: activity log + primary run actions */}
                          <div className="flex items-center gap-1">
                            {testRunData && (
                              <RunAuditLogSheet
                                runId={testRunData.id}
                                hideTrigger
                                open={auditOpen}
                                onOpenChange={setAuditOpen}
                              />
                            )}
                            {!isJUnitRun && (
                              <RequestReviewButton
                                entityType="RUN"
                                entityId={testRunData.id}
                                projectId={Number(projectId)}
                                currentStateId={testRunData.stateId}
                                reachableGatedStates={reachableGatedStates}
                              />
                            )}
                            <ActionOverflow
                              compact={headerCompact}
                              menuLabel={t("common.actions.actionsLabel")}
                              actions={[
                                {
                                  key: "activity",
                                  icon: History,
                                  label: t("common.fields.activityLog"),
                                  onClick: () => setAuditOpen(true),
                                },
                                {
                                  key: "edit",
                                  icon: SquarePen,
                                  label: t("common.actions.edit"),
                                  onClick: handleEditClick,
                                  hidden: !(
                                    canAddEditRun && !isMultiConfigSelected
                                  ),
                                },
                                {
                                  key: "duplicate",
                                  icon: CopyPlus,
                                  label: t("common.actions.duplicate"),
                                  onClick: () => setIsDuplicateDialogOpen(true),
                                  hidden: !(
                                    canAddEditRun &&
                                    !isAutomatedTestRunType(
                                      testRunData?.testRunType
                                    )
                                  ),
                                },
                                {
                                  key: "export",
                                  icon: FileDown,
                                  label: isExportingPdf
                                    ? t("common.actions.exportingPdf")
                                    : t("common.actions.exportPdf"),
                                  onClick: handleExportPdf,
                                  disabled: isExportingPdf,
                                },
                                {
                                  key: "complete",
                                  icon: CircleCheckBig,
                                  label: t("common.actions.complete"),
                                  onClick: () => setIsCompleteDialogOpen(true),
                                  hidden: !canCloseRun,
                                },
                                {
                                  key: "assign",
                                  icon: UsersRound,
                                  label: t("common.actions.assign"),
                                  onClick: () =>
                                    setIsDistributeDialogOpen(true),
                                  hidden: !(
                                    canAddEditRun &&
                                    !isAutomatedTestRunType(
                                      testRunData?.testRunType
                                    )
                                  ),
                                },
                              ]}
                            />
                            {isCompleteDialogOpen && (
                              <CompleteTestRunDialog
                                open={isCompleteDialogOpen}
                                onClose={() => setIsCompleteDialogOpen(false)}
                                testRunId={Number(runId)}
                                projectId={Number(projectId)}
                                stateId={testRunData?.stateId || 0}
                                stateName={testRunData?.state?.name || ""}
                              />
                            )}
                          </div>
                          {/* Row 2: composition lock/unlock */}
                          <div className="flex items-center gap-1">
                            {/* Execution-start composition lock (BOR-1) —
                                single toggle. Locking needs run-edit rights;
                                unlocking is gated to creator/admin, so the
                                switch is disabled (but still shown, for
                                context) when a locked run can't be unlocked. */}
                            {!isJUnitRun &&
                              (compositionLocked ||
                                (canAddEditRun && !isMultiConfigSelected)) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex h-9 items-center gap-2 rounded-md border bg-secondary px-3 text-secondary-foreground">
                                      <Switch
                                        id="composition-lock-switch"
                                        checked={compositionLocked}
                                        onCheckedChange={(v) =>
                                          setCompositionLock(v)
                                        }
                                        disabled={
                                          isTogglingCompositionLock ||
                                          (compositionLocked
                                            ? !canUnlockComposition
                                            : !canAddEditRun ||
                                              isMultiConfigSelected)
                                        }
                                        aria-label={
                                          compositionLocked
                                            ? t("runs.composition.lock")
                                            : t("runs.composition.unlocked")
                                        }
                                        // The chip is bg-secondary; the switch's
                                        // default track colors (bg-input off,
                                        // bg-primary on) don't reliably contrast
                                        // with it across themes. Deriving both the
                                        // border and the unchecked track from
                                        // secondary-foreground — which contrasts
                                        // the chip by definition — keeps the
                                        // switch legible on/off in every theme.
                                        className="border-secondary-foreground data-[state=unchecked]:bg-secondary-foreground/50"
                                      />
                                      <label
                                        htmlFor="composition-lock-switch"
                                        className="flex cursor-pointer items-center gap-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
                                      >
                                        {isTogglingCompositionLock ? (
                                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                                        ) : compositionLocked ? (
                                          <Lock className="h-4 w-4 shrink-0" />
                                        ) : (
                                          <LockOpen className="h-4 w-4 shrink-0" />
                                        )}
                                        {!headerCompact && (
                                          <span className="whitespace-nowrap text-sm">
                                            {compositionLocked
                                              ? t("runs.composition.lock")
                                              : t("runs.composition.unlocked")}
                                          </span>
                                        )}
                                      </label>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {compositionLocked
                                      ? testRunData.compositionLockedBy?.name?.trim()
                                        ? t("runs.composition.lockedBy", {
                                            name: testRunData.compositionLockedBy.name.trim(),
                                          })
                                        : t(
                                            "runs.composition.lockedAutomatically"
                                          )
                                      : t("runs.composition.lockHint")}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                          </div>
                        </div>
                      ) : (
                        // Edit Mode Buttons for NON-COMPLETED runs
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            {(() => {
                              const gateBlocked =
                                !isJUnitRun &&
                                !transitionCheck.allowed &&
                                transitionCheck.blockingGate;
                              const formHasErrors =
                                Object.keys(errors).length > 0;
                              const saveBlocked = gateBlocked || formHasErrors;
                              const tooltipMessage = gateBlocked
                                ? t("reviews.transitionGate.blockedByGate", {
                                    gateName:
                                      transitionCheck.blockingGate!.name,
                                  })
                                : t(
                                    "reviews.transitionGate.saveBlockedByFormErrors"
                                  );

                              if (!saveBlocked) {
                                return (
                                  <Button
                                    type="submit"
                                    variant="outline"
                                    disabled={isSubmitting || !canAddEditRun}
                                    className={collapsibleActionClass(
                                      headerCompact
                                    )}
                                  >
                                    <ActionButtonContent
                                      icon={Save}
                                      label={t("common.actions.save")}
                                    />
                                  </Button>
                                );
                              }

                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span tabIndex={0}>
                                      <Button
                                        type="submit"
                                        variant="outline"
                                        disabled
                                        className={collapsibleActionClass(
                                          headerCompact,
                                          "ring-2 ring-destructive ring-offset-2 ring-offset-background"
                                        )}
                                      >
                                        <ActionButtonContent
                                          icon={Save}
                                          label={t("common.actions.save")}
                                        />
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {tooltipMessage}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })()}
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCancel}
                              disabled={isSubmitting}
                              className={collapsibleActionClass(headerCompact)}
                            >
                              <ActionButtonContent
                                icon={CircleSlash2}
                                label={t("common.cancel")}
                              />
                            </Button>
                          </div>
                          {/* Delete button in edit mode for non-completed runs */}
                          {effectiveCanDelete && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setIsDeleteDialogOpen(true)}
                              disabled={isSubmitting}
                              className={collapsibleActionClass(
                                headerCompact,
                                "text-destructive"
                              )}
                            >
                              <ActionButtonContent
                                icon={Trash2}
                                label={t("common.actions.delete")}
                              />
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </ActionBar>
              </div>
            </div>
            <CardDescription>
              <TestRunCasesSummary
                testRunId={Number(runId)}
                testRunIds={
                  selectedConfigurations.length > 1
                    ? selectedConfigurations.map((c) => c.id)
                    : undefined
                }
                className="text-2xl"
                testRunType={testRunData?.testRunType}
              />
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ResizablePanelGroup
              direction="horizontal"
              className="min-h-[600px] rounded-lg border"
              autoSaveId="test-run-panels"
            >
              <ResizablePanel
                id="test-run-left"
                order={1}
                ref={panelLeftRef}
                defaultSize={80}
                collapsible
                minSize={30}
                collapsedSize={0}
                onCollapse={() => setIsCollapsedLeft(true)}
                onExpand={() => setIsCollapsedLeft(false)}
                className={
                  isTransitioningLeft
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }
              >
                <div className="flex flex-col h-full p-4">
                  <div className="space-y-4">
                    {isJUnitRun ? (
                      <>
                        {narrativeFields}
                        <PaginationProvider>
                          <JunitResultsPanel
                            t={t}
                            projectId={projectId ? String(projectId) : ""}
                            runId={runId ? String(runId) : ""}
                            jUnitSuites={jUnitSuites}
                            sortedJunitTestCases={sortedJunitTestCases}
                            junitSortConfig={junitSortConfig}
                            handleJunitSortChange={handleJunitSortChange}
                            onSortColumn={handleJunitSortColumn}
                            isJUnitLoading={isJUnitLoading}
                            selectedTestCaseId={selectedTestCaseId}
                          />
                        </PaginationProvider>
                      </>
                    ) : (
                      <>
                        {narrativeFields}

                        {/* Test Cases Section */}
                        <TestCasesSection
                          testRunData={testRunData}
                          isEditMode={isEditMode}
                          onTestCasesChange={handleTestCasesChange}
                          canAddEdit={canAddEditRun}
                          compositionLocked={compositionLocked}
                          refetchTestRun={refetchTestRun}
                          onMultiConfigSelected={setIsMultiConfigSelected}
                          onSelectedConfigurationsChange={
                            setSelectedConfigurations
                          }
                        />
                      </>
                    )}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle className="w-1" />
              <div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        type="button"
                        onClick={toggleCollapseRight}
                        variant="secondary"
                        size="sm"
                        className={`p-0 transform ${isCollapsedRight ? "rounded-s-none" : "rounded-e-none rotate-180"}`}
                      >
                        <ChevronLeft />
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div>
                      {isCollapsedRight
                        ? t("common.actions.expandRightPanel")
                        : t("common.actions.collapseRightPanel")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
              <ResizablePanel
                id="test-run-right"
                order={2}
                ref={panelRightRef}
                defaultSize={20}
                collapsedSize={0}
                minSize={20}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
                className={
                  isTransitioningRight
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                }
              >
                <div className="p-4 space-y-4">
                  {isJUnitRun ? (
                    <JunitChartsPanel
                      t={t}
                      jUnitSuites={jUnitSuites}
                      sortedJunitTestCases={sortedJunitTestCases}
                      statusScope={statusScope}
                      forecastSeconds={testRunData?.forecastManual}
                    />
                  ) : (
                    <>
                      {(testRunData?.forecastManual ?? 0) > 0 && (
                        <div className="flex flex-col gap-2">
                          <FormLabel className="text-base font-bold">
                            {t("common.fields.forecast")}
                          </FormLabel>
                          <ForecastDisplay
                            seconds={testRunData.forecastManual!}
                          />
                        </div>
                      )}
                      {/* Donut Chart for all results in this test run */}
                      {donutChartData.length > 0 && (
                        <Card shadow="none">
                          <CardHeader className="flex flex-row items-center justify-between p-2">
                            <CardTitle className="text-base font-medium">
                              {tCommon("ui.charts.resultsDistribution")}
                            </CardTitle>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setZoomedChart("donut")}
                            >
                              <Maximize2 className="h-4 w-4" />
                              <span className="sr-only">
                                {tCommon("ui.charts.zoomDonutChart")}
                              </span>
                            </Button>
                          </CardHeader>
                          <CardContent>
                            <TestRunResultsDonut
                              data={donutChartData}
                              height={220}
                            />
                          </CardContent>
                        </Card>
                      )}
                      {/* Zoom Dialog for Donut Chart */}
                      <Dialog
                        open={zoomedChart === "donut"}
                        onOpenChange={(open) => {
                          if (!open) setZoomedChart(null);
                        }}
                      >
                        <DialogContent className="max-w-[80vw] h-[80vh] flex flex-col p-0 sm:p-6">
                          <DialogHeader className="px-4 pt-4 sm:px-0 sm:pt-0">
                            <DialogTitle>
                              {tCommon("ui.charts.resultsDistribution")}
                            </DialogTitle>
                          </DialogHeader>
                          <div className="flex-1 overflow-auto p-4 sm:p-0">
                            <div
                              className="flex-1 w-full h-full"
                              style={{ minHeight: 600 }}
                            >
                              <div className="w-full h-full flex items-center justify-center">
                                <TestRunResultsDonut
                                  data={donutChartData}
                                  isZoomed
                                  height={600}
                                />
                              </div>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                  <TestRunFormControls
                    isEditMode={isEditMode}
                    isSubmitting={isSubmitting}
                    testRun={testRunData}
                    control={control}
                    errors={errors}
                    workflows={workflows}
                    milestones={milestoneOptions}
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    projectId={safeProjectId}
                    handleFileSelect={handleFileSelect}
                    handleLinksChange={setSelectedLinks}
                    handleSelect={handleSelect}
                    selectedIssues={selectedIssues}
                    setSelectedIssues={setSelectedIssues}
                    canAddEdit={canAddEditRun}
                    canCreateTags={showAddEditTagsPerm}
                    selectedConfigurationsForDisplay={selectedConfigurations}
                    onAttachmentPendingChanges={setPendingAttachmentChanges}
                    transitionCheck={isJUnitRun ? undefined : transitionCheck}
                    configurationGroupSlot={
                      /* Sits under Configuration, which it qualifies. The
                         membership list stays visible outside edit mode; the
                         link/unlink actions are gated behind Edit like every
                         other field here. */
                      <ConfigurationGroupLinkField
                        model="testRuns"
                        recordId={testRunData.id}
                        projectId={numericProjectId}
                        value={form.watch("configurationGroupId") ?? null}
                        savedValue={testRunData.configurationGroupId ?? null}
                        onChange={handleConfigurationGroupChange}
                        editable={
                          isEditMode &&
                          canEditConfigurationGroup({
                            canAddEdit: canAddEditRun,
                            isMultiConfigurationView: isMultiConfigSelected,
                            isCompleted: !!testRunData.isCompleted,
                          })
                        }
                        disabled={isSubmitting}
                      />
                    }
                  />
                  {selectedAttachmentIndex !== null && (
                    <AttachmentsCarousel
                      attachments={selectedAttachments}
                      initialIndex={selectedAttachmentIndex}
                      onClose={handleClose}
                      canEdit={canAddEditRun}
                    />
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
            {!isEditMode && testRunData && session?.user && (
              <div id="comments" className="mt-6 px-6 pb-6">
                <CommentsSection
                  projectId={Number(projectId)}
                  entityType="testRun"
                  entityId={testRunData.id}
                  currentUserId={session.user.id}
                  isAdmin={session.user.access === "ADMIN"}
                />
              </div>
            )}
          </CardContent>
        </form>
      </FormProvider>
      <DeleteTestRunModal
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        testRunId={Number(runId)}
        projectId={Number(projectId)}
        onBeforeDelete={() => setIsDeletingTestRun(true)}
      />
      <AlertDialog
        open={isRemoveCasesDialogOpen}
        onOpenChange={setIsRemoveCasesDialogOpen}
      >
        <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 me-2" />
              {t("runs.removeCasesDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("runs.removeCasesDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-destructive text-destructive-foreground p-2">
            {t("runs.removeCasesDialog.warning")}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleRemoveCasesCancel}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveCasesConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.actions.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Sheet for Test Case Details */}
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        {/* The sheet's built-in close (X) — the only direct button child —
            sits over the sticky bg-primary header. It must layer above that
            header (z-30 > the header's z-20) or the header hides it, and use
            primary-foreground so it stays legible where primary is light
            (e.g. dark mode). While editing the case in place, the content is
            the repository details view (plain background), so the
            primary-header styling is dropped to keep the X visible. */}
        <SheetContent
          className={`sm:max-w-4xl w-full p-0 [&>button]:z-30 [&>button]:opacity-100 ${
            editingSelectedCase
              ? ""
              : "test-run-details-sheet [&>button]:text-primary-foreground"
          }`}
        >
          <SheetHeader>
            <SheetTitle className="sr-only">
              {t("repository.version.detailsRegion")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("repository.version.detailsRegion")}
            </SheetDescription>
          </SheetHeader>
          {/* Using key to force remount on case change */}
          {selectedTestCaseId &&
            testRunData &&
            (() => {
              const trc = testRunData.testCases.find(
                (tc) => tc.repositoryCaseId === selectedTestCaseId
              );
              if (!trc) return null;
              const innerProps = {
                caseId: selectedTestCaseId,
                projectId: Number(projectId),
                testRunId: Number(runId),
                testRunCaseId: trc.id,
                currentStatus: trc.status,
                onClose: () => handleSheetOpenChange(false),
                onNextCase: (nextCaseId: number) => {
                  setIsTransitioning(true);
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("selectedCase", nextCaseId.toString());
                  router.replace(`${pathname}?${params.toString()}`);
                },
                isTransitioning,
                testRunCasesData: testRunData.testCases.map((tc) => ({
                  id: tc.id,
                  order: tc.order,
                  repositoryCaseId: tc.repositoryCaseId,
                })),
                isCompleted: testRunData.isCompleted,
                onEditCase: canAddEditCases
                  ? () => setEditCaseParam(true)
                  : undefined,
              };

              if (editingSelectedCase) {
                return (
                  <div
                    className="h-full overflow-y-auto"
                    data-testid="run-case-edit-panel"
                  >
                    <TestCaseDetailsView
                      key={`edit-${selectedTestCaseId}`}
                      caseIdOverride={String(selectedTestCaseId)}
                      projectIdOverride={safeProjectId}
                      inSheet
                      startInEditMode
                      onClose={() => handleSheetOpenChange(false)}
                      onEditExit={(saved) => {
                        setEditCaseParam(false);
                        if (saved) {
                          void queryClient.invalidateQueries({
                            queryKey: [
                              "test-run-case-detail",
                              selectedTestCaseId,
                              Number(runId),
                            ],
                          });
                        }
                      }}
                    />
                  </div>
                );
              }

              const totalIterations = trc.totalIterations;

              if (totalIterations === 0) {
                return (
                  <TestRunCaseDetails
                    key={selectedTestCaseId}
                    {...innerProps}
                  />
                );
              }

              return (
                <IterationAwareTestRunCaseDetails
                  key={selectedTestCaseId}
                  testRunCaseId={trc.id}
                  testRunId={Number(runId)}
                  totalIterations={totalIterations}
                  isRunCompleted={!!testRunData.isCompleted}
                  innerProps={innerProps}
                />
              );
            })()}
        </SheetContent>
      </Sheet>
      {/* Dialog: Show if canAddEditRun and not JUNIT (regardless of completion status) */}
      {canAddEditRun && !isAutomatedTestRunType(testRunData?.testRunType) && (
        <DuplicateTestRunDialog
          open={isDuplicateDialogOpen}
          onOpenChange={setIsDuplicateDialogOpen}
          testRunId={Number(runId)}
          testRunName={testRunData.name || ""}
          onPrepareCloneDataAndProceed={handlePrepareCloneDataAndProceed}
        />
      )}
      {canAddEditRun &&
        !testRunData?.isCompleted &&
        !isAutomatedTestRunType(testRunData?.testRunType) && (
          <DistributeAssignmentsModal
            isOpen={isDistributeDialogOpen}
            onClose={() => setIsDistributeDialogOpen(false)}
            projectId={Number(projectId)}
            runId={Number(runId)}
            configurationGroupId={testRunData?.configurationGroupId ?? null}
            onDone={() => {
              void refetchTestRun();
            }}
          />
        )}
      {/* Render AddTestRunModal for Duplication - wrapped in SimpleDndProvider for DnD context */}
      {isAddRunModalOpenForDuplicate && addRunModalInitPropsForDuplicate && (
        <SimpleDndProvider>
          <AddTestRunModal
            open={isAddRunModalOpenForDuplicate}
            onClose={() => {
              setIsAddRunModalOpenForDuplicate(false);
              setAddRunModalInitPropsForDuplicate(null);
            }}
            initialSelectedCaseIds={
              addRunModalInitPropsForDuplicate.initialSelectedCaseIds
            }
            duplicationPreset={
              addRunModalInitPropsForDuplicate.duplicationPreset
            }
            defaultMilestoneId={
              addRunModalInitPropsForDuplicate.defaultMilestoneId
            }
            onSelectedCasesChange={(ids) => {
              // Add basic onSelectedCasesChange handler
              if (addRunModalInitPropsForDuplicate) {
                const currentIds =
                  addRunModalInitPropsForDuplicate.initialSelectedCaseIds || [];
                const newIdsSorted = [...(ids || [])].sort().join(",");
                const currentIdsSorted = [...currentIds].sort().join(",");
                if (newIdsSorted !== currentIdsSorted) {
                  setAddRunModalInitPropsForDuplicate({
                    ...addRunModalInitPropsForDuplicate,
                    initialSelectedCaseIds: ids,
                  });
                }
              }
            }}
          />
        </SimpleDndProvider>
      )}
    </Card>
  );
}
