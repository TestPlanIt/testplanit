"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter, usePathname } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  useUpdateTestRuns,
  useFindManyWorkflows,
  useCreateAttachments,
  useFindManyConfigurations,
  useFindManyMilestones,
  useFindFirstRepositoryCases,
  useDeleteManyTestRunResults,
  useDeleteManyTestRunStepResults,
  useFindFirstProjects,
  useFindManyJUnitTestSuite,
  useFindFirstStatusScope,
  useFindManyTestRunResults,
  useFindUniqueTestRuns,
  useFindManyTestRuns,
} from "~/lib/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, FormProvider } from "react-hook-form";
import { z } from "zod/v4";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loading } from "@/components/Loading";
import { emptyEditorContent } from "~/app/constants";
import {
  CircleSlash2,
  CircleCheckBig,
  Trash2,
  ArrowLeft,
  TriangleAlert,
  SquarePen,
  Save,
  ChevronLeft,
  Maximize2,
  Copy,
} from "lucide-react";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { transformMilestones } from "@/components/forms/MilestoneSelect";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import type { Resolver } from "react-hook-form";
import {
  Attachments,
  ApplicationArea,
  RepositoryCases,
  Tags,
} from "@prisma/client";
import type { JSONContent } from "@tiptap/react";
import { IconName } from "~/types/globals";
import LoadingSpinnerAlert from "@/components/LoadingSpinnerAlert";
import { ImperativePanelHandle } from "react-resizable-panels";
import { Badge } from "@/components/ui/badge";
import { DateFormatter } from "@/components/DateFormatter";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { Link } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { DeleteTestRunModal } from "./DeleteTestRun";
import CompleteTestRunDialog from "./CompleteTestRunDialog";
import DuplicateTestRunDialog, {
  AddTestRunModalInitProps,
} from "../DuplicateTestRunDialog";
import { TestCasesSection, SelectedConfigurationInfo } from "./TestCasesSection";
import { TestRunCaseDetails } from "@/components/TestRunCaseDetails";
import TestRunCasesSummary from "~/components/TestRunCasesSummary";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { updateTestRunForecast } from "~/services/testRunService";
import { getJunitColumns } from "./junitColumns";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import { PaginationProvider } from "~/lib/contexts/PaginationContext";
import { CommentsSection } from "~/components/comments/CommentsSection";
import TestRunFormControls from "./TestRunFormControls";
import JunitTableSection from "./JunitTableSection";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import TestRunResultsDonut from "@/components/dataVisualizations/TestRunResultsDonut";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AddTestRunModal from "../AddTestRunModal";

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
    status: {
      id: number;
      name: string;
      color: {
        value: string;
      };
    } | null;
    repositoryCase: RepositoryCases & {
      state: WorkflowStateWithRelations;
    };
  }>;
  tags: Tags[];
  issues: IssueType[];
};

type MilestoneOption = {
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
  const [selectedConfigurations, setSelectedConfigurations] = useState<SelectedConfigurationInfo[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<number[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<number[]>([]);
  const [noteContent, setNoteContent] =
    useState<JSONContent>(emptyEditorContent);
  const [docsContent, setDocsContent] =
    useState<JSONContent>(emptyEditorContent);
  const [isCollapsedLeft, setIsCollapsedLeft] = useState(false);
  const [isCollapsedRight, setIsCollapsedRight] = useState(false);
  const [panelRightWidth, setPanelRightWidth] = useState(20);
  const panelRightRef = useRef<ImperativePanelHandle>(null);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormLoading, setIsFormLoading] = useState(false);
  const [initialValues, setInitialValues] = useState<FormValues | null>(null);
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const panelLeftRef = useRef<ImperativePanelHandle>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const { mutateAsync: createAttachments } = useCreateAttachments();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isRemoveCasesDialogOpen, setIsRemoveCasesDialogOpen] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormValues | null>(
    null
  );
  const { mutateAsync: deleteTestRunResults } = useDeleteManyTestRunResults();
  const { mutateAsync: deleteTestRunStepResults } =
    useDeleteManyTestRunStepResults();
  const [zoomedChart, setZoomedChart] = useState<null | "donut">(null);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);

  // State for AddTestRunModal when opened for duplication
  const [isAddRunModalOpenForDuplicate, setIsAddRunModalOpenForDuplicate] =
    useState(false);
  const [
    addRunModalInitPropsForDuplicate,
    setAddRunModalInitPropsForDuplicate,
  ] = useState<AddTestRunModalInitProps | null>(null);

  // Fetch TestRuns permissions
  const { permissions: testRunPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.TestRuns);

  // Fetch ClosedTestRuns permissions
  const {
    permissions: closedTestRunPermissions,
    isLoading: isLoadingClosedPermissions,
  } = useProjectPermissions(numericProjectId, ApplicationArea.ClosedTestRuns);

  // Fetch Tags permission
  const { permissions: tagsPermissions, isLoading: isLoadingTagsPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.Tags);

  // Extract permissions
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;
  const canDeleteRun = testRunPermissions?.canDelete ?? false;
  const canCloseRun = testRunPermissions?.canClose ?? false;
  const canAddEditTags = tagsPermissions?.canAddEdit ?? false;
  const isSuperAdmin = session?.user?.access === "ADMIN";
  const showAddEditTagsPerm = canAddEditTags || isSuperAdmin;

  // Get the selected test case ID from URL parameters
  const selectedTestCaseId = searchParams.get("selectedCase")
    ? parseInt(searchParams.get("selectedCase")!)
    : null;

  // Fetch project data to get issueConfigId and integrations
  const { data: projectData } = useFindFirstProjects(
    {
      where: {
        id: Number(projectId),
      },
      select: {
        projectIntegrations: {
          where: {
            isActive: true,
            integration: {
              status: "ACTIVE",
            },
          },
          include: {
            integration: {
              select: {
                id: true,
                name: true,
                provider: true,
              },
            },
          },
        },
      },
    },
    {
      enabled: !isNaN(Number(projectId)),
    }
  );

  const { data: statusScope } = useFindFirstStatusScope({
    where: {
      name: "Automation",
    },
  });

  // Define the form schema with translations inside the component
  const FormSchema = BaseFormSchema.superRefine((data, ctx) => {
    // Add any additional validation if needed
  });

  // Fetch test run data
  const { data: testRunData, refetch: refetchTestRun } = useFindUniqueTestRuns(
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
        attachments: true,
        testCases: {
          select: {
            id: true,
            order: true,
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
            repositoryCase: {
              include: {
                state: {
                  include: {
                    icon: true,
                    color: true,
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

  // Fetch JUnit test suites if this is a JUNIT run
  const { data: jUnitSuites, isLoading: isJUnitLoading } =
    useFindManyJUnitTestSuite(
      isAutomatedTestRunType(testRunData?.testRunType)
        ? {
            where: { testRunId: Number(runId) },
            include: {
              properties: true,
              results: {
                include: {
                  status: {
                    select: { name: true, color: { select: { value: true } } },
                  },
                  repositoryCase: {
                    select: {
                      name: true,
                      className: true,
                      source: true,
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
        : undefined
    );

  const canEdit =
    (session?.user.access === "ADMIN" ||
      session?.user.access === "PROJECTADMIN") &&
    !testRunData?.isCompleted;

  // Set up form with proper typing
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema) as Resolver<FormValues>,
    defaultValues: {
      name: "",
      configId: null,
      milestoneId: null,
      stateId: 0,
      note: null,
      docs: null,
      attachments: [],
      selectedIssues: [],
    },
    mode: "onSubmit",
  });

  // Add data fetching queries
  const { data: configurations } = useFindManyConfigurations({
    where: {
      isDeleted: false,
      isEnabled: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  const { data: workflows } = useFindManyWorkflows({
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
    orderBy: [{ startedAt: "asc" }, { isStarted: "asc" }],
  });

  // Transform milestones for the select component
  const milestoneOptions = transformMilestones(milestones || []);

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
      };
      form.reset(initialData, {
        keepDefaultValues: true,
      });
      setInitialValues(initialData);
      setSelectedTags(testRunData.tags.map((tag) => tag.id));
      setSelectedIssues(testRunData.issues.map((issue) => issue.id));
      setSelectedTestCaseIds(
        testRunData.testCases.map((tc) => tc.repositoryCase.id)
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
  useEffect(() => {
    setIsLoading(
      isLoadingPermissions ||
        isLoadingClosedPermissions ||
        isLoadingTagsPermissions ||
        !testRunData ||
        !configurations ||
        !workflows ||
        !isFormInitialized
    );
  }, [
    isLoadingPermissions,
    isLoadingClosedPermissions,
    isLoadingTagsPermissions,
    testRunData,
    configurations,
    workflows,
    isFormInitialized,
  ]);

  // Scroll to hash anchor after page loads
  useEffect(() => {
    if (!isLoading && typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash) {
        // Wait a bit for the DOM to be fully rendered
        setTimeout(() => {
          const element = document.querySelector(hash);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 100);
      }
    }
  }, [isLoading]);

  // Add mutation hooks
  const { mutateAsync: updateTestRuns } = useUpdateTestRuns();

  // Add form controls
  const {
    handleSubmit,
    control,
    setValue,
    formState: { errors },
    reset,
  } = form;

  // Panel controls
  const toggleCollapseLeft = () => {
    if (panelLeftRef.current) {
      if (isCollapsedLeft) {
        panelLeftRef.current.expand();
      } else {
        panelLeftRef.current.collapse();
      }
      setIsCollapsedLeft(!isCollapsedLeft);
    }
  };

  const toggleCollapseRight = () => {
    if (panelRightRef.current) {
      if (isCollapsedRight) {
        panelRightRef.current.expand();
      } else {
        panelRightRef.current.collapse();
      }
      setIsCollapsedRight(!isCollapsedRight);
    }
  };

  const handleResize = useCallback((size: number) => {
    setPanelRightWidth(size);
  }, []);

  // Sheet controls
  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      // If sheet is closing, remove selectedCase from URL
      const params = new URLSearchParams(searchParams.toString());
      params.delete("selectedCase");
      router.replace(`${pathname}?${params.toString()}`);
    }
    // Opening is handled by URL change triggered from TestCasesSection clicking a row
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
        testRunData?.testCases.map((tc) => tc.repositoryCase.id) || [];

      // Prepare note and docs content to avoid double-stringification
      let noteContent = data.note;
      if (typeof noteContent !== "string") {
        noteContent = JSON.stringify(noteContent);
      }

      let docsContent = data.docs;
      if (typeof docsContent !== "string") {
        docsContent = JSON.stringify(docsContent);
      }

      // Check if test cases have changed
      const hasTestCasesChanged =
        selectedTestCaseIds.length !== currentTestCaseIds.length ||
        !selectedTestCaseIds.every((id: number) =>
          currentTestCaseIds.includes(id)
        ) ||
        !currentTestCaseIds.every((id: number) =>
          selectedTestCaseIds.includes(id)
        );

      // Handle test case changes
      if (hasTestCasesChanged) {
        // First delete all test step results for the test cases that will be removed
        await deleteTestRunStepResults({
          where: {
            testRunResult: {
              testRunCase: {
                testRunId: Number(runId),
                repositoryCaseId: {
                  in: currentTestCaseIds.filter(
                    (id: number) => !selectedTestCaseIds.includes(id)
                  ),
                },
              },
            },
          },
        });

        // Then delete all test results for the test cases that will be removed
        await deleteTestRunResults({
          where: {
            testRunCase: {
              testRunId: Number(runId),
              repositoryCaseId: {
                in: currentTestCaseIds.filter(
                  (id: number) => !selectedTestCaseIds.includes(id)
                ),
              },
            },
          },
        });

        // Then update the test run with the new test cases
        await updateTestRuns({
          where: {
            id: Number(runId),
          },
          data: {
            name: data.name,
            configId: data.configId || null,
            milestoneId: data.milestoneId || null,
            stateId: data.stateId,
            note: noteContent,
            docs: docsContent,
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
            testCases: {
              deleteMany: {
                testRunId: Number(runId),
                repositoryCaseId: {
                  in: currentTestCaseIds.filter(
                    (id: number) => !selectedTestCaseIds.includes(id)
                  ),
                },
              },
              create: selectedTestCaseIds
                .filter((id: number) => !currentTestCaseIds.includes(id))
                .map((id: number, index: number) => ({
                  repositoryCase: {
                    connect: { id },
                  },
                  order: currentTestCaseIds.length + index,
                })),
            },
          },
        });

        // --- ADDED: Update forecast after case changes ---
        await updateTestRunForecast(Number(runId));
        // --------------------------------------------------
      } else {
        // No test case changes, just update the basic info
        await updateTestRuns({
          where: {
            id: Number(runId),
          },
          data: {
            name: data.name,
            configId: data.configId || null,
            milestoneId: data.milestoneId || null,
            stateId: data.stateId,
            note: noteContent,
            docs: docsContent,
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
          },
        });
      }

      // Handle attachments
      if (selectedFiles.length > 0) {
        const attachmentUrls = await uploadFiles(Number(runId));
      }

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

  // Update onSubmit function
  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      // Get current test case IDs
      const currentTestCaseIds =
        testRunData?.testCases.map((tc) => tc.repositoryCase.id) || [];

      // Check if test cases have changed
      const hasTestCasesChanged =
        selectedTestCaseIds.length !== currentTestCaseIds.length ||
        !selectedTestCaseIds.every((id: number) =>
          currentTestCaseIds.includes(id)
        ) ||
        !currentTestCaseIds.every((id: number) =>
          selectedTestCaseIds.includes(id)
        );

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

    const attachments = await Promise.all(attachmentsPromises);
    return attachments;
  };

  // Add this function to handle test case changes
  const handleTestCasesChange = (testCaseIds: number[]) => {
    setSelectedTestCaseIds(testCaseIds);
  };

  const { data: testcase, isLoading: isTestcaseLoading } =
    useFindFirstRepositoryCases({
      where: { id: selectedTestCaseId ?? undefined, isDeleted: false },
      include: {
        state: {
          select: {
            id: true,
            name: true,
            icon: { select: { name: true } },
            color: { select: { value: true } },
          },
        },
        project: true,
        folder: true,
        creator: true,
        template: {
          select: {
            id: true,
            templateName: true,
            caseFields: {
              select: {
                caseFieldId: true,
                order: true,
                caseField: {
                  select: {
                    id: true,
                    defaultValue: true,
                    displayName: true,
                    type: { select: { type: true } },
                    fieldOptions: {
                      select: {
                        fieldOption: {
                          select: {
                            id: true,
                            icon: true,
                            iconColor: true,
                            name: true,
                            order: true,
                          },
                        },
                      },
                      orderBy: { fieldOption: { order: "asc" } },
                    },
                  },
                },
              },
              orderBy: { order: "asc" },
            },
          },
        },
        caseFieldValues: {
          select: {
            id: true,
            value: true,
            fieldId: true,
            field: {
              select: {
                id: true,
                displayName: true,
                type: { select: { type: true } },
              },
            },
          },
          where: { field: { isEnabled: true, isDeleted: false } },
        },
        attachments: {
          orderBy: { createdAt: "desc" },
          where: { isDeleted: false },
        },
        steps: {
          where: { isDeleted: false },
          orderBy: { order: "asc" },
        },
      },
    });

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
    const mapped = (jUnitSuites || []).flatMap((suite) =>
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

  // Define columns for DataTable
  const junitColumns = useMemo(
    () =>
      getJunitColumns({
        t: t as (key: string) => string,
        session,
        projectId: projectId ? String(projectId) : "",
      }),
    [t, session, projectId]
  );

  // --- REGULAR TEST RUN TABLE STATE ---
  // Fetch status distribution from view-options API for accurate counts across selected configurations
  const effectiveRunIdsForResults = useMemo(() => {
    if (selectedConfigurations.length > 1) {
      return selectedConfigurations.map(c => c.id);
    }
    if (selectedConfigurations.length === 1) {
      return [selectedConfigurations[0].id];
    }
    return [Number(runId)];
  }, [selectedConfigurations, runId]);

  // Fetch view options to get accurate status counts for the donut chart
  const { data: viewOptionsData } = useQuery({
    queryKey: ["viewOptions", "donutChart", numericProjectId, ...effectiveRunIdsForResults],
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
  if (!isValidProjectId || testRunData?.isDeleted) {
    router.push(`/404`);
    return (
      <div className="text-muted-foreground text-center p-4">
        {t("repository.cases.notFound")}
      </div>
    );
  }

  // Re-add the check for testRunData before proceeding to render JUNIT or regular run view
  if (!testRunData) {
    router.push(`/projects/repository/${projectId}`); // Or a more appropriate redirect/error
    return (
      <div className="text-muted-foreground text-center p-4">
        {t("repository.cases.notFound")}
      </div>
    );
  }

  if (testRunData && isAutomatedTestRunType(testRunData.testRunType)) {
    // --- JUNIT TABLE STATE ---
    return (
      <PaginationProvider>
        <JunitTableSection
          form={form}
          handleSubmit={handleSubmit}
          onSubmit={onSubmit}
          isDeleteDialogOpen={isDeleteDialogOpen}
          setIsDeleteDialogOpen={setIsDeleteDialogOpen}
          runId={runId ? String(runId) : ""}
          projectId={projectId ? String(projectId) : ""}
          refetchTestRun={refetchTestRun}
          t={t}
          jUnitSuites={jUnitSuites}
          junitColumns={junitColumns}
          sortedJunitTestCases={sortedJunitTestCases}
          junitSortConfig={junitSortConfig}
          handleJunitSortChange={handleJunitSortChange}
          effectiveCanDelete={effectiveCanDelete}
          canAddEditRun={canAddEditRun}
          canCloseRun={canCloseRun}
          isEditMode={isEditMode}
          isSubmitting={isSubmitting}
          testRunData={testRunData}
          isJUnitLoading={isJUnitLoading}
          handleEditClick={handleEditClick}
          noteContent={noteContent}
          setNoteContent={setNoteContent}
          contentLoaded={contentLoaded}
          handleCancel={handleCancel}
          configurations={configurations}
          workflows={workflows}
          milestones={milestoneOptions}
          statusScope={statusScope}
          selectedTestCaseId={selectedTestCaseId}
        />
      </PaginationProvider>
    );
  }

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
            handleSubmit(onSubmit)(e);
          }}
        >
          <CardHeader>
            <div className="flex justify-between items-start">
              {!isEditMode && (
                <div className="mr-2">
                  <Link href={`/projects/runs/${projectId}`}>
                    <Button variant="outline" size="icon">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
              <CardTitle className="flex-1 pr-4 text-xl md:text-2xl mr-4">
                {isEditMode ? (
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            className="text-xl md:text-2xl mr-4"
                            readOnly={!canAddEditRun}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ) : (
                  testRunData?.name
                )}
              </CardTitle>
              <div className="flex items-start gap-2 flex-wrap">
                {testRunData?.isCompleted ? (
                  <div className="flex flex-col gap-2">
                    <Badge
                      variant="secondary"
                      className="flex items-center text-md whitespace-nowrap text-sm gap-1 p-2 px-4"
                    >
                      <CircleCheckBig className="h-6 w-6 shrink-0" />
                      <div className="hidden md:block">
                        <span className="mr-1">
                          {t("projects.overview.completedOn")}
                        </span>
                        <DateFormatter
                          date={testRunData?.completedAt}
                          formatString={session?.user.preferences?.dateFormat}
                          timezone={session?.user.preferences?.timezone}
                        />
                      </div>
                    </Badge>
                    {/* Duplicate button for COMPLETED runs */}
                    {canAddEditRun && !isAutomatedTestRunType(testRunData?.testRunType) && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setIsDuplicateDialogOpen(true)}
                      >
                        <Copy className="h-4 w-4 " />
                        {t("common.actions.duplicate")}
                      </Button>
                    )}
                    {effectiveCanDelete && (
                      <Button
                        variant="secondary"
                        onClick={() => setIsDeleteDialogOpen(true)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 " />
                        {t("common.actions.delete")}
                      </Button>
                    )}
                  </div>
                ) : (
                  // Buttons for NON-COMPLETED runs
                  <>
                    {!isEditMode ? (
                      // View Mode Buttons for NON-COMPLETED runs
                      <div className="flex flex-col gap-2">
                        {/* Edit button on its own row, right-justified */}
                        {canAddEditRun && !isMultiConfigSelected && (
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={handleEditClick}
                            >
                              <SquarePen className="h-4 w-4 " />{" "}
                              {t("common.actions.edit")}
                            </Button>
                          </div>
                        )}
                        {/* Duplicate and Complete buttons on the next row */}
                        <div className="flex items-center gap-2">
                          {canAddEditRun &&
                            testRunData?.testRunType !== "JUNIT" && (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setIsDuplicateDialogOpen(true)}
                              >
                                <Copy className="h-4 w-4 " />{" "}
                                {t("common.actions.duplicate")}
                              </Button>
                            )}
                          {canCloseRun && ( // Removed !testRunData?.isCompleted as parent already checks for !isCompleted
                            <CompleteTestRunDialog
                              trigger={
                                <Button type="button" variant="secondary">
                                  <CircleCheckBig className="h-4 w-4 " />{" "}
                                  {t("common.actions.complete")}
                                </Button>
                              }
                              testRunId={Number(runId)}
                              projectId={Number(projectId)}
                              stateId={testRunData?.stateId || 0}
                              stateName={testRunData?.state?.name || ""}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      // Edit Mode Buttons for NON-COMPLETED runs
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            type="submit"
                            variant="default"
                            disabled={isSubmitting || !canAddEditRun}
                          >
                            <Save className="h-4 w-4 mr-2" />{" "}
                            {t("common.actions.save")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancel}
                            disabled={isSubmitting}
                          >
                            <CircleSlash2 className="h-4 w-4 mr-2" />{" "}
                            {t("common.actions.cancel")}
                          </Button>
                        </div>
                        {/* Delete button in edit mode for non-completed runs */}
                        {effectiveCanDelete && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setIsDeleteDialogOpen(true)}
                            disabled={isSubmitting}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 " />{" "}
                            {t("common.actions.delete")}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <CardDescription>
              <TestRunCasesSummary
                testRunId={Number(runId)}
                testRunIds={selectedConfigurations.length > 1 ? selectedConfigurations.map(c => c.id) : undefined}
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
                ref={panelLeftRef}
                defaultSize={80}
                collapsible
                minSize={30}
                collapsedSize={0}
                onCollapse={() => setIsCollapsedLeft(true)}
                onExpand={() => setIsCollapsedLeft(false)}
              >
                <div className="flex flex-col h-full p-4">
                  <div className="space-y-4">
                    {testRunData?.testRunType === "JUNIT" ? (
                      isJUnitLoading ? (
                        <Loading />
                      ) : (
                        <div className="space-y-8">
                          {jUnitSuites && jUnitSuites.length > 0 ? (
                            <></>
                          ) : (
                            <div className="text-muted-foreground">
                              {tCommon("ui.noJunitTestSuites")}
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <>
                        {isEditMode ||
                        (contentLoaded &&
                          JSON.stringify(noteContent) !==
                            JSON.stringify(emptyEditorContent)) ? (
                          <FormField
                            control={form.control}
                            name="note"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  {t("common.fields.description")}
                                </FormLabel>
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
                                        placeholder={t(
                                          "common.placeholders.description"
                                        )}
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
                        {isEditMode ||
                        (contentLoaded &&
                          JSON.stringify(docsContent) !==
                            JSON.stringify(emptyEditorContent)) ? (
                          <FormField
                            control={form.control}
                            name="docs"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  {t("common.fields.documentation")}
                                </FormLabel>
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
                                        placeholder={t(
                                          "common.placeholders.documentation"
                                        )}
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
                          (JSON.stringify(noteContent) !==
                            JSON.stringify(emptyEditorContent) ||
                            JSON.stringify(docsContent) !==
                              JSON.stringify(emptyEditorContent)) && (
                            <Separator className="my-4" />
                          )}

                        {/* Test Cases Section */}
                        <TestCasesSection
                          testRunData={testRunData}
                          isEditMode={isEditMode}
                          onTestCasesChange={handleTestCasesChange}
                          canAddEdit={canAddEditRun}
                          refetchTestRun={refetchTestRun}
                          onMultiConfigSelected={setIsMultiConfigSelected}
                          onSelectedConfigurationsChange={setSelectedConfigurations}
                        />
                      </>
                    )}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle className="w-1" />
              <div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button
                          type="button"
                          onClick={toggleCollapseRight}
                          variant="secondary"
                          size="sm"
                          className={`p-0 transform ${isCollapsedRight ? "rounded-l-none" : "rounded-r-none rotate-180"}`}
                        >
                          <ChevronLeft />
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div>
                        {isCollapsedRight
                          ? t("repository.cases.panels.expandRight")
                          : t("repository.cases.panels.collapseRight")}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <ResizablePanel
                ref={panelRightRef}
                defaultSize={panelRightWidth}
                onResize={handleResize}
                collapsedSize={0}
                minSize={20}
                collapsible
                onCollapse={() => setIsCollapsedRight(true)}
                onExpand={() => setIsCollapsedRight(false)}
                className={`${
                  isTransitioning
                    ? "transition-all duration-300 ease-in-out"
                    : ""
                } w-["${panelRightWidth}%"]`}
              >
                <div className="p-4 space-y-4">
                  {(testRunData?.forecastManual ?? 0) > 0 && (
                    <div className="flex flex-col gap-2">
                      <FormLabel>{t("common.fields.forecast")}</FormLabel>
                      <ForecastDisplay seconds={testRunData.forecastManual!} />
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
                          <span className="sr-only">{tCommon("ui.charts.zoomDonutChart")}</span>
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
                        <DialogTitle>{tCommon("ui.charts.resultsDistribution")}</DialogTitle>
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
                  <TestRunFormControls
                    isEditMode={isEditMode}
                    isSubmitting={isSubmitting}
                    testRun={testRunData ?? undefined}
                    control={control}
                    errors={errors}
                    configurations={configurations}
                    workflows={workflows}
                    milestones={milestoneOptions}
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    projectId={safeProjectId}
                    handleFileSelect={handleFileSelect}
                    handleSelect={handleSelect}
                    projectIntegration={projectData?.projectIntegrations?.[0]}
                    selectedIssues={selectedIssues}
                    setSelectedIssues={setSelectedIssues}
                    canAddEdit={canAddEditRun}
                    canCreateTags={showAddEditTagsPerm}
                    selectedConfigurationsForDisplay={selectedConfigurations}
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
        onDelete={refetchTestRun}
      />
      <AlertDialog
        open={isRemoveCasesDialogOpen}
        onOpenChange={setIsRemoveCasesDialogOpen}
      >
        <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              <TriangleAlert className="w-6 h-6 mr-2" />
              {t("common.dialogs.confirmAction.title", {
                action: "Remove Cases",
              })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div>
            {t("common.dialogs.confirmAction.message", {
              action: "remove these test cases",
            })}
          </div>
          <div className="bg-destructive text-destructive-foreground p-2">
            {t("common.dialogs.delete.warning", { item: "test cases" })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleRemoveCasesCancel}>
              {t("common.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveCasesConfirm}
              className="bg-destructive"
            >
              {t("common.actions.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Sheet for Test Case Details */}
      <Sheet open={sheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="sm:max-w-4xl w-full p-0 test-run-details-sheet">
          <SheetHeader>
            <SheetTitle className="sr-only">
              {t("repository.testCase.detailsRegion")}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {t("repository.testCase.detailsRegion")}
            </SheetDescription>
          </SheetHeader>
          {/* Using key to force remount on case change */}
          {selectedTestCaseId && testRunData && (
            <TestRunCaseDetails
              key={selectedTestCaseId} // Force re-render when ID changes
              caseId={selectedTestCaseId}
              projectId={Number(projectId)}
              testRunId={Number(runId)}
              testRunCaseId={
                testRunData.testCases.find(
                  (tc) => tc.repositoryCase.id === selectedTestCaseId
                )?.id
              }
              currentStatus={
                testRunData.testCases.find(
                  (tc) => tc.repositoryCase.id === selectedTestCaseId
                )?.status
              }
              onClose={() => handleSheetOpenChange(false)} // Use the handler to close sheet
              onNextCase={(nextCaseId) => {
                setIsTransitioning(true);
                const params = new URLSearchParams(searchParams.toString());
                params.set("selectedCase", nextCaseId.toString());
                router.replace(`${pathname}?${params.toString()}`);
              }}
              isTransitioning={isTransitioning}
              testRunCasesData={testRunData.testCases.map((tc) => ({
                id: tc.id,
                order: tc.order,
                repositoryCaseId: tc.repositoryCase.id,
              }))}
              isCompleted={testRunData.isCompleted}
            />
          )}
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
      {/* Render AddTestRunModal for Duplication */}
      {isAddRunModalOpenForDuplicate && addRunModalInitPropsForDuplicate && (
        <AddTestRunModal
          open={isAddRunModalOpenForDuplicate}
          onOpenChange={(isOpen) => {
            setIsAddRunModalOpenForDuplicate(isOpen);
            if (!isOpen) setAddRunModalInitPropsForDuplicate(null); // Clear props when closed
          }}
          initialSelectedCaseIds={
            addRunModalInitPropsForDuplicate.initialSelectedCaseIds
          }
          duplicationPreset={addRunModalInitPropsForDuplicate.duplicationPreset}
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
      )}
    </Card>
  );
}
