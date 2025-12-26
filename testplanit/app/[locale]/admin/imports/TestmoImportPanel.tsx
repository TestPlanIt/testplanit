"use client";

import type { ReactNode } from "react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { filesize } from "filesize";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  FileUp,
  Import,
  Settings2,
  UploadCloud,
} from "lucide-react";
import { DurationDisplay } from "@/components/DurationDisplay";
import { Access } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import UploadAttachments from "@/components/UploadAttachments";
import { Progress } from "@/components/ui/progress";
import type {
  TestmoAnalysisSummaryPayload,
  TestmoImportJobPayload,
  TestmoDatasetDetailPayload,
  TestmoDatasetSummaryPayload,
  TestmoMappingAnalysis,
  TestmoMappingConfiguration,
  TestmoConfigurationMappingConfig,
  TestmoConfigVariantMappingConfig,
} from "~/services/imports/testmo/types";
import LoadingSpinner from "~/components/LoadingSpinner";
import TestmoMappingConfigurator, {
  convertNamesToOptionConfigs,
} from "@/components/TestmoMappingConfigurator";
import {
  createEmptyMappingConfiguration,
  normalizeMappingConfiguration,
  serializeMappingConfiguration,
} from "~/services/imports/testmo/configuration";
import { generateRandomPassword } from "~/utils/randomPassword";

const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remaining.toFixed(0)}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

const formatDateTime = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

enum WizardStep {
  Upload = 0,
  Analyze = 1,
  Configure = 2,
  Import = 3,
}

type StepStatus = "pending" | "active" | "completed";

const DATASET_DISPLAY_ORDER = [
  "states",
  "statuses",
  "templates",
  "template_fields",
  "fields",
  "milestone_types",
  "roles",
  "users",
  "groups",
  "issue_targets",
  "configs",
  "tags",
] as const;

const SUPPORTED_MAPPING_DATASETS = new Set<string>([
  "states",
  "statuses",
  "roles",
  "templates",
  "template_fields",
  "users",
  "milestone_types",
  "groups",
  "issue_targets",
  "configs",
]);

const HIDDEN_DATASETS = new Set<string>(["fields"]);

interface WizardStepDefinition {
  id: WizardStep;
  label: string;
  icon: LucideIcon;
}

export function TestmoImportPanel() {
  const t = useTranslations("admin.imports");
  const tCommon = useTranslations("common");
  const tDatasetLabels = useTranslations(
    "admin.imports.testmo.mappingDatasetLabels"
  );
  const tDatasetDescriptions = useTranslations(
    "admin.imports.testmo.mappingDatasetDescriptions"
  );
  const [activeStep, setActiveStep] = useState<WizardStep>(WizardStep.Upload);
  const [errorKey, setErrorKey] = useState<
    | "file-required"
    | "presign-failed"
    | "upload-failed"
    | "analysis-failed"
    | null
  >(null);
  const [analysis, setAnalysis] = useState<TestmoAnalysisSummaryPayload | null>(
    null
  );
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploaderKey, setUploaderKey] = useState(0);
  const [processingState, setProcessingState] = useState<
    "idle" | "uploading" | "analyzing"
  >("idle");
  const [currentJob, setCurrentJob] = useState<TestmoImportJobPayload | null>(
    null
  );
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [selectedDatasetDetail, setSelectedDatasetDetail] =
    useState<TestmoDatasetDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const datasetDetailCache = useRef<Map<number, TestmoDatasetDetailPayload>>(
    new Map()
  );
  const datasetSummariesFetchedRef = useRef<Set<string>>(new Set());
  const completedJobsRef = useRef<Set<string>>(new Set());
  const initialJobLoadAttemptedRef = useRef(false);
  const analysisFetchedRef = useRef<Set<string>>(new Set());
  const [mappingAnalysis, setMappingAnalysis] =
    useState<TestmoMappingAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(
    null
  );
  const [importStarting, setImportStarting] = useState(false);
  const [analysisReloadToken, setAnalysisReloadToken] = useState(0);
  const [mappingConfig, setMappingConfig] =
    useState<TestmoMappingConfiguration>(createEmptyMappingConfiguration());
  const importConfigInputRef = useRef<HTMLInputElement | null>(null);
  const [jobHistory, setJobHistory] = useState<TestmoImportJobPayload[]>([]);
  const [jobHistoryLoading, setJobHistoryLoading] = useState(false);
  const [jobHistoryError, setJobHistoryError] = useState<string | null>(null);
  const [selectedExistingJobId, setSelectedExistingJobId] =
    useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<
    | { state: "idle"; percent: 0 }
    | { state: "uploading"; percent: number }
    | { state: "analyzing"; percent: 100 }
    | { state: "complete"; percent: 100 }
  >({ state: "idle", percent: 0 });
  const [activityLogDisplayLimit, setActivityLogDisplayLimit] = useState(50);

  const refreshJobHistory = useCallback(async (): Promise<
    TestmoImportJobPayload[]
  > => {
    setJobHistoryLoading(true);
    setJobHistoryError(null);
    try {
      const response = await fetch("/api/imports/testmo/jobs?limit=20");
      if (!response.ok) {
        throw new Error("failed");
      }
      const { jobs } = (await response.json()) as {
        jobs: TestmoImportJobPayload[];
      };
      const list = jobs ?? [];
      setJobHistory(list);
      return list;
    } catch (error) {
      console.error("Failed to load Testmo import history", error);
      setJobHistory([]);
      setJobHistoryError(t("testmo.jobHistoryLoadFailed"));
      return [];
    } finally {
      setJobHistoryLoading(false);
    }
  }, [t]);

  const loadJobDetails = useCallback(
    async (
      jobId: string,
      options: { autoStep?: boolean; setSelected?: boolean } = {}
    ) => {
      const { autoStep = true, setSelected = true } = options;
      try {
        const detailResponse = await fetch(
          `/api/imports/testmo/jobs/${jobId}?include=datasets`
        );

        if (!detailResponse.ok) {
          throw new Error("detail-fetch-failed");
        }

        const { job } = (await detailResponse.json()) as {
          job: TestmoImportJobPayload;
        };

        datasetSummariesFetchedRef.current.clear();
        completedJobsRef.current.clear();
        datasetDetailCache.current.clear();
        setSelectedDataset("");
        setSelectedDatasetDetail(null);
        setDetailError(null);
        setErrorKey(null);
        setPollingError(null);
        setCurrentJob(job);
        setAnalysis(job.summary ?? null);
        setProcessingState(
          job.status === "RUNNING" || job.status === "QUEUED"
            ? "analyzing"
            : "idle"
        );
        setMappingConfig(normalizeMappingConfiguration(job.configuration));

        if (job.status === "COMPLETED" && job.summary?.datasets?.length) {
          datasetSummariesFetchedRef.current.add(job.id);
        }

        setUploadProgress({ state: "idle", percent: 0 });

        if (setSelected) {
          setSelectedExistingJobId(job.id);
        }

        if (autoStep) {
          if (job.status === "COMPLETED") {
            setActiveStep(WizardStep.Import);
          } else if (job.phase === "CONFIGURING") {
            setActiveStep(WizardStep.Configure);
          } else {
            setActiveStep(WizardStep.Analyze);
          }
        }

        return true;
      } catch (error) {
        console.error("Failed to load Testmo import job", error);
        setDetailError(t("testmo.jobLoadFailed"));
        return false;
      }
    },
    [t]
  );

  const handleExistingJobSelect = useCallback(
    async (jobId: string) => {
      if (!jobId) {
        setSelectedExistingJobId("");
        return;
      }
      await loadJobDetails(jobId);
    },
    [loadJobDetails]
  );

  const handleRefreshJobHistory = useCallback(() => {
    refreshJobHistory();
  }, [refreshJobHistory]);

  const selectedJobSummary = useMemo(
    () => jobHistory.find((job) => job.id === selectedExistingJobId) ?? null,
    [jobHistory, selectedExistingJobId]
  );

  const datasetEntries = useMemo(() => {
    const preserved = mappingAnalysis?.preservedDatasets;
    if (!preserved) {
      return [] as Array<{ key: string; rows: unknown[]; count: number }>;
    }

    const entries: Array<{ key: string; rows: unknown[]; count: number }> = [];
    const seen = new Set<string>();

    const extractTemplateFieldKey = (row: unknown): string => {
      if (row && typeof row === "object") {
        const record = row as Record<string, unknown>;
        const rawId = record.field_id ?? record.fieldId ?? record.field;
        if (typeof rawId === "number") {
          return `fid:${rawId}`;
        }
        if (typeof rawId === "string") {
          const parsed = Number(rawId);
          if (!Number.isNaN(parsed)) {
            return `fid:${parsed}`;
          }
        }
        const system =
          typeof record.system_name === "string"
            ? record.system_name.trim().toLowerCase()
            : typeof record.systemName === "string"
              ? record.systemName.trim().toLowerCase()
              : null;
        if (system) {
          return `fsys:${system}`;
        }
        const display =
          typeof record.display_name === "string"
            ? record.display_name.trim().toLowerCase()
            : typeof record.displayName === "string"
              ? record.displayName.trim().toLowerCase()
              : null;
        if (display) {
          return `fdisp:${display}`;
        }
      }
      return JSON.stringify(row);
    };

    const pushEntry = (key: string, value: unknown) => {
      if (HIDDEN_DATASETS.has(key)) {
        return;
      }
      const rows = Array.isArray(value) ? value : value ? [value] : [];
      const count =
        key === "template_fields"
          ? (() => {
              const seenKeys = new Set<string>();
              rows.forEach((row) => {
                seenKeys.add(extractTemplateFieldKey(row));
              });
              return seenKeys.size;
            })()
          : rows.length;
      entries.push({ key, rows, count });
      seen.add(key);
    };

    for (const key of DATASET_DISPLAY_ORDER) {
      if (Object.prototype.hasOwnProperty.call(preserved, key)) {
        pushEntry(key, (preserved as Record<string, unknown>)[key]);
      }
    }

    for (const key of Object.keys(preserved)) {
      if (HIDDEN_DATASETS.has(key)) {
        continue;
      }
      if (!seen.has(key)) {
        pushEntry(key, (preserved as Record<string, unknown>)[key]);
      }
    }

    return entries;
  }, [mappingAnalysis?.preservedDatasets]);

  const [activeMappingDataset, setActiveMappingDataset] = useState<string>(
    () => datasetEntries[0]?.key ?? "states"
  );

  useEffect(() => {
    if (datasetEntries.length === 0) {
      return;
    }

    const keys = datasetEntries.map((entry) => entry.key);
    if (!keys.includes(activeMappingDataset)) {
      setActiveMappingDataset(keys[0]);
    }
  }, [datasetEntries, activeMappingDataset]);

  const datasetLabelFor = useCallback(
    (datasetKey: string) => {
      const fallback = datasetKey
        .split("_")
        .map((segment) =>
          segment.length > 0
            ? segment[0].toUpperCase() + segment.slice(1).toLowerCase()
            : segment
        )
        .join(" ");
      try {
        return tDatasetLabels(datasetKey as any);
      } catch (error) {
        return fallback;
      }
    },
    [tDatasetLabels]
  );

  const datasetDescriptionFor = useCallback(
    (datasetKey: string) => {
      const fallback = t("testmo.mappingDatasetDefaultDescription", {
        dataset: datasetLabelFor(datasetKey),
      });
      try {
        return tDatasetDescriptions(datasetKey as any);
      } catch (error) {
        return fallback;
      }
    },
    [datasetLabelFor, t, tDatasetDescriptions]
  );

  const mappingCompletion = useMemo(() => {
    const incomplete: Record<string, number> = {};
    const increment = (key: string, amount = 1) => {
      incomplete[key] = (incomplete[key] ?? 0) + amount;
    };

    if (!mappingAnalysis) {
      return { incompleteCounts: {}, isComplete: false } as const;
    }

    const hasText = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;
    const hasFiniteNumber = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value);

    const workflowSuggestions =
      mappingAnalysis.ambiguousEntities?.workflows ?? [];
    workflowSuggestions.forEach((workflow) => {
      const config = mappingConfig.workflows[workflow.id];
      if (!config) {
        increment("states");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("states");
        }
      } else if (!hasText(config.name ?? workflow.name)) {
        increment("states");
      }
    });

    const statusSuggestions = mappingAnalysis.ambiguousEntities?.statuses ?? [];
    statusSuggestions.forEach((status) => {
      const config = mappingConfig.statuses[status.id];
      if (!config) {
        increment("statuses");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("statuses");
        }
      } else if (
        !hasText(config.name ?? status.name) ||
        !hasText(config.systemName ?? status.systemName)
      ) {
        increment("statuses");
      }
    });

    const roleSuggestions = mappingAnalysis.ambiguousEntities?.roles ?? [];
    roleSuggestions.forEach((role) => {
      const config = mappingConfig.roles[role.id];
      if (!config) {
        increment("roles");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("roles");
        }
      } else if (!hasText(config.name ?? role.name)) {
        increment("roles");
      }
    });

    const milestoneSuggestions =
      mappingAnalysis.ambiguousEntities?.milestoneTypes ?? [];
    milestoneSuggestions.forEach((milestone) => {
      const config = mappingConfig.milestoneTypes[milestone.id];
      if (!config) {
        increment("milestone_types");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("milestone_types");
        }
      } else if (
        !hasText(config.name ?? milestone.name) ||
        !hasFiniteNumber(config.iconId)
      ) {
        increment("milestone_types");
      }
    });

    const groupSuggestions = mappingAnalysis.ambiguousEntities?.groups ?? [];
    groupSuggestions.forEach((group) => {
      const config = mappingConfig.groups[group.id];
      if (!config) {
        increment("groups");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("groups");
        }
      } else if (!hasText(config.name ?? group.name)) {
        increment("groups");
      }
    });

    const configurationSuggestions =
      mappingAnalysis.ambiguousEntities?.configurations ?? [];
    configurationSuggestions.forEach((suggestion) => {
      const config = mappingConfig.configurations[suggestion.id];
      if (!config) {
        increment("configs");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("configs");
        }
      } else {
        if (!hasText(config.name ?? suggestion.name)) {
          increment("configs");
        }
        suggestion.variantTokens.forEach((_, index) => {
          const variantConfig = config.variants?.[index];
          if (!variantConfig) {
            increment("configs");
            return;
          }
          switch (variantConfig.action) {
            case "map-variant":
              if (!hasFiniteNumber(variantConfig.mappedVariantId)) {
                increment("configs");
              }
              break;
            case "create-variant-existing-category":
              if (
                !hasFiniteNumber(variantConfig.categoryId) ||
                !hasText(variantConfig.variantName)
              ) {
                increment("configs");
              }
              break;
            case "create-category-variant":
              if (
                !hasText(variantConfig.categoryName) ||
                !hasText(variantConfig.variantName)
              ) {
                increment("configs");
              }
              break;
            default:
              increment("configs");
          }
        });
      }
    });

    const userSuggestions = mappingAnalysis.ambiguousEntities?.users ?? [];
    userSuggestions.forEach((user) => {
      const config = mappingConfig.users[user.id];
      if (!config) {
        increment("users");
        return;
      }
      if (config.action === "map") {
        if (!hasText(config.mappedTo ?? "")) {
          increment("users");
        }
      } else {
        const name = config.name ?? user.name;
        const email = config.email ?? user.email;
        const password = config.password;
        const roleId = config.roleId;
        if (
          !hasText(name) ||
          !hasText(email) ||
          !hasText(password) ||
          roleId === null ||
          roleId === undefined
        ) {
          increment("users");
        }
      }
    });

    const templateSuggestions =
      mappingAnalysis.ambiguousEntities?.templates ?? [];
    const templateTargetUsage = new Map<number, number>();
    templateSuggestions.forEach((template) => {
      const storedConfig = mappingConfig.templates[template.id];
      const config = storedConfig ?? {
        action: "create" as const,
        mappedTo: null,
        name: template.name ?? undefined,
      };
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("templates");
          return;
        }
        const targetId = Number(config.mappedTo);
        const count = (templateTargetUsage.get(targetId) ?? 0) + 1;
        templateTargetUsage.set(targetId, count);
        if (count > 1) {
          increment("templates");
        }
      } else if (!hasText(config.name ?? template.name)) {
        increment("templates");
      }
    });

    const templateFieldSuggestions =
      mappingAnalysis.ambiguousEntities?.templateFields ?? [];
    const templateFieldTargetUsage = new Map<string, number>();
    templateFieldSuggestions.forEach((field) => {
      const config = mappingConfig.templateFields[field.id];
      if (!config) {
        increment("template_fields");
        return;
      }
      if (config.action === "map") {
        if (!hasFiniteNumber(config.mappedTo)) {
          increment("template_fields");
          return;
        }
        const targetType = config.targetType ?? field.targetType;
        const key = `${targetType}:${config.mappedTo}`;
        const count = (templateFieldTargetUsage.get(key) ?? 0) + 1;
        templateFieldTargetUsage.set(key, count);
        if (count > 1) {
          increment("template_fields");
        }
      } else {
        const displayName = config.displayName ?? field.displayName ?? "";
        const systemName = config.systemName ?? field.systemName ?? "";
        const typeId = config.typeId ?? null;
        if (
          !hasText(displayName) ||
          !hasText(systemName) ||
          !hasFiniteNumber(typeId)
        ) {
          increment("template_fields");
        }
      }
    });

    const counts = { ...incomplete };
    const isComplete = Object.keys(counts).length === 0;
    return { incompleteCounts: counts, isComplete } as const;
  }, [mappingAnalysis, mappingConfig]);

  const datasetOutstandingCounts = mappingCompletion.incompleteCounts;
  const isMappingComplete = mappingCompletion.isComplete;
  const blockingDatasets = useMemo(
    () =>
      Object.entries(datasetOutstandingCounts)
        .filter(([, count]) => (count ?? 0) > 0)
        .map(([key, count]) => ({
          key,
          count,
          label: datasetLabelFor(key),
        })),
    [datasetLabelFor, datasetOutstandingCounts]
  );

  const handleMappingConfigurationChange = useCallback(
    (next: TestmoMappingConfiguration) => {
      setMappingConfig(next);
      setConfigurationError(null);
    },
    []
  );

  const wizardSteps = useMemo<WizardStepDefinition[]>(
    () => [
      {
        id: WizardStep.Upload,
        label: t("testmo.wizard.steps.upload"),
        icon: UploadCloud,
      },
      {
        id: WizardStep.Analyze,
        label: t("testmo.wizard.steps.analysis"),
        icon: FileSearch,
      },
      {
        id: WizardStep.Configure,
        label: t("testmo.wizard.steps.mapping"),
        icon: Settings2,
      },
      {
        id: WizardStep.Import,
        label: t("testmo.wizard.steps.import"),
        icon: Activity,
      },
    ],
    [t]
  );

  const stepStatusLabels = useMemo(
    () => ({
      pending: tCommon("status.pending"),
      active: tCommon("status.active"),
      completed: tCommon("fields.completed"),
    }),
    [tCommon]
  );

  useEffect(() => {
    if (!analysis) {
      setSelectedDataset("");
      return;
    }

    setSelectedDataset((previous) => {
      if (
        previous &&
        analysis.datasets.some((dataset) => dataset.name === previous)
      ) {
        return previous;
      }
      return "";
    });
  }, [analysis]);

  useEffect(() => {
    if (currentJob || initialJobLoadAttemptedRef.current) {
      return;
    }

    initialJobLoadAttemptedRef.current = true;

    let cancelled = false;

    const hydrateFromLatestJob = async () => {
      const jobs = await refreshJobHistory();
      const latestJob = jobs?.[0];
      if (!latestJob || cancelled) {
        return;
      }
      await loadJobDetails(latestJob.id, { autoStep: false });
    };

    hydrateFromLatestJob();

    return () => {
      cancelled = true;
    };
  }, [currentJob, loadJobDetails, refreshJobHistory]);

  const selectedDatasetSummary = useMemo(
    () =>
      analysis?.datasets.find((dataset) => dataset.name === selectedDataset) ??
      null,
    [analysis, selectedDataset]
  );

  const mappingSummaryItems = useMemo(() => {
    if (!mappingAnalysis || !mappingAnalysis.summary) {
      return [] as Array<{
        key: string;
        label: string;
        value: number;
        outstanding: number;
      }>;
    }

    const summary = mappingAnalysis.summary;
    const outstandingCounts = mappingCompletion.incompleteCounts;

    return [
      {
        key: "projects",
        label: t("testmo.mappingSummaryProjects"),
        value: (summary.projects ?? 0) as number,
        outstanding: (outstandingCounts.projects ?? 0) as number,
      },
      {
        key: "users",
        label: t("testmo.mappingSummaryUsers"),
        value: (summary.users ?? 0) as number,
        outstanding: (outstandingCounts.users ?? 0) as number,
      },
      {
        key: "testCases",
        label: t("testmo.mappingSummaryTestCases"),
        value: (summary.testCases ?? 0) as number,
        outstanding: (outstandingCounts.testCases ?? 0) as number,
      },
      {
        key: "testRuns",
        label: t("testmo.mappingSummaryTestRuns"),
        value: (summary.testRuns ?? 0) as number,
        outstanding: (outstandingCounts.testRuns ?? 0) as number,
      },
      {
        key: "sessions",
        label: t("testmo.mappingSummarySessions"),
        value: (summary.sessions ?? 0) as number,
        outstanding: (outstandingCounts.sessions ?? 0) as number,
      },
      {
        key: "workflows",
        label: t("testmo.mappingSummaryWorkflows"),
        value: (summary.workflows ?? 0) as number,
        outstanding: (outstandingCounts.states ?? 0) as number,
      },
      {
        key: "statuses",
        label: t("testmo.mappingSummaryStatuses"),
        value: (summary.statuses ?? 0) as number,
        outstanding: (outstandingCounts.statuses ?? 0) as number,
      },
      {
        key: "roles",
        label: t("testmo.mappingSummaryRoles"),
        value: (summary.roles ?? 0) as number,
        outstanding: (outstandingCounts.roles ?? 0) as number,
      },
      {
        key: "milestoneTypes",
        label: t("testmo.mappingSummaryMilestoneTypes"),
        value: (summary.milestoneTypes ?? 0) as number,
        outstanding: (outstandingCounts.milestone_types ?? 0) as number,
      },
      {
        key: "groups",
        label: t("testmo.mappingSummaryGroups"),
        value: (summary.groups ?? 0) as number,
        outstanding: (outstandingCounts.groups ?? 0) as number,
      },
      {
        key: "templates",
        label: t("testmo.mappingSummaryTemplates"),
        value: (summary.templates ?? 0) as number,
        outstanding: (outstandingCounts.templates ?? 0) as number,
      },
      {
        key: "templateFields",
        label: t("testmo.mappingSummaryTemplateFields"),
        value: (summary.templateFields ?? 0) as number,
        outstanding: (outstandingCounts.template_fields ?? 0) as number,
      },
      {
        key: "customFields",
        label: t("testmo.mappingSummaryCustomFields"),
        value: (summary.customFields ?? 0) as number,
        outstanding: (outstandingCounts.customFields ?? 0) as number,
      },
      {
        key: "configurations",
        label: t("testmo.mappingSummaryConfigurations"),
        value: (summary.configurations ?? 0) as number,
        outstanding: (outstandingCounts.configs ?? 0) as number,
      },
    ];
  }, [mappingAnalysis, mappingCompletion.incompleteCounts, t]);

  const canStartImport = useMemo(() => {
    if (!currentJob || currentJob.status !== "READY") {
      return false;
    }
    if (mappingAnalysis) {
      return isMappingComplete;
    }
    return !analysisLoading;
  }, [analysisLoading, currentJob, isMappingComplete, mappingAnalysis]);

  const importInProgress =
    currentJob?.status === "RUNNING" && currentJob?.phase === "IMPORTING";

  const maxUnlockedStep = useMemo<WizardStep>(() => {
    if (!currentJob) {
      return processingState !== "idle"
        ? WizardStep.Analyze
        : WizardStep.Upload;
    }

    if (currentJob.status === "COMPLETED") {
      return WizardStep.Import;
    }

    if (currentJob.phase === "IMPORTING") {
      return WizardStep.Import;
    }

    if (currentJob.status === "FAILED" || currentJob.status === "CANCELED") {
      if (currentJob.lastImportStartedAt) {
        return WizardStep.Import;
      }

      if (currentJob.configuration) {
        return WizardStep.Configure;
      }

      return WizardStep.Analyze;
    }

    if (
      currentJob.status === "READY" ||
      currentJob.phase === "CONFIGURING" ||
      currentJob.configuration
    ) {
      if (currentJob.configuration && mappingCompletion.isComplete) {
        return WizardStep.Import;
      }
      return WizardStep.Configure;
    }

    return WizardStep.Analyze;
  }, [currentJob, mappingCompletion.isComplete, processingState]);

  useEffect(() => {
    if (activeStep > maxUnlockedStep) {
      setActiveStep(maxUnlockedStep);
    }
  }, [activeStep, maxUnlockedStep]);

  const stepStatusFor = useCallback(
    (step: WizardStep): StepStatus => {
      if (step === activeStep) {
        return "active";
      }
      if (step < maxUnlockedStep) {
        return "completed";
      }
      return "pending";
    },
    [activeStep, maxUnlockedStep]
  );

  const handleFilesSelected = useCallback((files: File[]) => {
    const file = files.at(-1) ?? null;
    setSelectedFile(file);
    if (file) {
      setErrorKey(null);
      setAnalysis(null);
      setSelectedDataset("");
      datasetSummariesFetchedRef.current.clear();
      completedJobsRef.current.clear();
      analysisFetchedRef.current.clear();
      setMappingAnalysis(null);
    }
    if (!file) {
      setAnalysis(null);
      setSelectedDataset("");
      setUploadProgress({ state: "idle", percent: 0 });
    }
    setCurrentJob(null);
    setPollingError(null);
  }, []);

  const runAnalysis = useCallback(async (): Promise<boolean> => {
    if (!selectedFile) {
      setErrorKey("file-required");
      return false;
    }

    setErrorKey(null);
    setProcessingState("uploading");
    setUploadProgress({ state: "uploading", percent: 0 });

    let storageKey: string | null = null;

    try {
      const presignResponse = await fetch("/api/imports/testmo/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          contentType:
            selectedFile.type && selectedFile.type.length > 0
              ? selectedFile.type
              : "application/json",
        }),
      });

      if (!presignResponse.ok) {
        throw new Error("presign-failed");
      }

      const { url, key } = await presignResponse.json();

      if (!url || typeof url !== "string" || !key || typeof key !== "string") {
        throw new Error("presign-failed");
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader(
          "Content-Type",
          selectedFile.type && selectedFile.type.length > 0
            ? selectedFile.type
            : "application/json"
        );
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadProgress({ state: "uploading", percent });
          }
        };
        xhr.onerror = () => reject(new Error("upload-failed"));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error("upload-failed"));
          }
        };
        xhr.send(selectedFile);
      });

      setUploadProgress({ state: "analyzing", percent: 100 });
      storageKey = key;
    } catch (error) {
      console.error("Testmo import upload failed", error);
      setProcessingState("idle");
      setUploadProgress({ state: "idle", percent: 0 });
      const message =
        error instanceof Error && error.message === "presign-failed"
          ? "presign-failed"
          : "upload-failed";
      setErrorKey(message);
      return false;
    }

    if (!storageKey) {
      setProcessingState("idle");
      setUploadProgress({ state: "idle", percent: 0 });
      setErrorKey("upload-failed");
      return false;
    }

    let success = false;
    try {
      setProcessingState("analyzing");
      const createJobResponse = await fetch("/api/imports/testmo/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: storageKey,
          fileName: selectedFile.name,
          fileSizeBytes: selectedFile.size,
        }),
      });

      if (!createJobResponse.ok) {
        throw new Error("analysis-failed");
      }

      const { job } = (await createJobResponse.json()) as {
        job: TestmoImportJobPayload;
      };

      datasetSummariesFetchedRef.current.delete(job.id);
      completedJobsRef.current.delete(job.id);
      setCurrentJob(job);
      setErrorKey(null);
      setPollingError(null);
      refreshJobHistory();
      setUploadProgress({ state: "complete", percent: 100 });
      success = true;
    } catch (error) {
      console.error("Testmo import analysis failed", error);
      setErrorKey("analysis-failed");
      setUploadProgress({ state: "idle", percent: 0 });
    } finally {
      setProcessingState("idle");
    }

    return success;
  }, [
    selectedFile,
    setErrorKey,
    setProcessingState,
    setCurrentJob,
    setPollingError,
    refreshJobHistory,
  ]);

  const resetSelections = () => {
    setAnalysis(null);
    setErrorKey(null);
    setSelectedDataset("");
    setSelectedFile(null);
    setUploaderKey((key) => key + 1);
    setCurrentJob(null);
    setPollingError(null);
    datasetDetailCache.current.clear();
    setSelectedDatasetDetail(null);
    setDetailError(null);
    datasetSummariesFetchedRef.current.clear();
    completedJobsRef.current.clear();
    analysisFetchedRef.current.clear();
    setMappingAnalysis(null);
    setAnalysisError(null);
    setConfigurationError(null);
    setImportStarting(false);
    setAnalysisReloadToken(0);
    setMappingConfig(createEmptyMappingConfiguration());
    setActiveStep(WizardStep.Upload);
    setSelectedExistingJobId("");
    setUploadProgress({ state: "idle", percent: 0 });
  };

  const startImport = useCallback(async (): Promise<boolean> => {
    if (!currentJob) {
      return false;
    }

    setImportStarting(true);
    try {
      const serializedConfig = serializeMappingConfiguration(mappingConfig);

      const saveResponse = await fetch(
        `/api/imports/testmo/jobs/${currentJob.id}/configuration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ configuration: serializedConfig }),
        }
      );

      if (!saveResponse.ok) {
        throw new Error("configuration-failed");
      }

      const { job: savedJob } = (await saveResponse.json()) as {
        job: TestmoImportJobPayload;
      };

      setCurrentJob(savedJob);
      setMappingConfig(normalizeMappingConfiguration(savedJob.configuration));
      setConfigurationError(null);

      const response = await fetch(
        `/api/imports/testmo/jobs/${savedJob.id}/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        throw new Error("import-failed");
      }

      const { job } = (await response.json()) as {
        job: TestmoImportJobPayload;
      };

      setCurrentJob(job);
      setMappingConfig(normalizeMappingConfiguration(job.configuration));
      return true;
    } catch (error) {
      console.error("Failed to start background import", error);
      setConfigurationError(t("testmo.mappingImportFailed"));
      return false;
    } finally {
      setImportStarting(false);
    }
  }, [currentJob, mappingConfig, setCurrentJob, t]);

  const handleRefreshAnalysis = useCallback(() => {
    if (!currentJob) {
      return;
    }

    analysisFetchedRef.current.delete(currentJob.id);
    setAnalysisError(null);
    setMappingAnalysis(null);
    setAnalysisReloadToken((token) => token + 1);
  }, [currentJob]);

  const handleExportConfiguration = useCallback(() => {
    const serialized = serializeMappingConfiguration(mappingConfig);
    const blob = new Blob([JSON.stringify(serialized, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `testmo-mapping-${currentJob?.id ?? "configuration"}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [mappingConfig, currentJob?.id]);

  const handleTriggerImportConfiguration = useCallback(() => {
    importConfigInputRef.current?.click();
  }, []);

  const handleConfigurationFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          const normalized = normalizeMappingConfiguration(parsed);
          setMappingConfig(normalized);
          setConfigurationError(null);
        } catch (error) {
          console.error("Failed to import mapping configuration", error);
          setConfigurationError(t("testmo.mappingImportConfigurationFailed"));
        } finally {
          event.target.value = "";
        }
      };
      reader.onerror = () => {
        console.error("Failed to read configuration file", reader.error);
        setConfigurationError(t("testmo.mappingImportConfigurationFailed"));
        event.target.value = "";
      };
      reader.readAsText(file);
    },
    [t]
  );

  const fileSizeDisplay = useMemo(() => {
    const bytes =
      analysis?.meta.fileSizeBytes ?? selectedFile?.size ?? undefined;
    return typeof bytes === "number" ? filesize(bytes, { base: 2 }) : null;
  }, [analysis, selectedFile]);

  const uploadProgressLabel = useMemo(() => {
    switch (uploadProgress.state) {
      case "uploading":
        return t("testmo.uploadProgressUploading");
      case "analyzing":
        return t("testmo.uploadProgressAnalyzing");
      case "complete":
        return t("testmo.uploadProgressComplete");
      default:
        return "";
    }
  }, [uploadProgress, t]);

  const translatedError = useMemo(() => {
    if (!errorKey) {
      return null;
    }
    switch (errorKey) {
      case "file-required":
        return t("errors.fileRequired");
      case "presign-failed":
      case "upload-failed":
        return t("errors.uploadFailed");
      case "analysis-failed":
      default:
        return t("errors.analysisFailed");
    }
  }, [errorKey, t]);

  useEffect(() => {
    if (!currentJob) {
      return;
    }

    if (
      (currentJob.status === "COMPLETED" || currentJob.status === "READY") &&
      currentJob.summary
    ) {
      const latestSummary = currentJob.summary;
      setAnalysis((previous) => {
        if (!previous) {
          return {
            ...latestSummary,
            datasets: latestSummary.datasets ?? [],
          };
        }

        const preservedDatasets =
          previous.datasets && previous.datasets.length > 0
            ? previous.datasets
            : (latestSummary.datasets ?? []);

        return {
          ...latestSummary,
          datasets: preservedDatasets,
        };
      });
      setProcessingState("idle");

      if (!completedJobsRef.current.has(currentJob.id)) {
        completedJobsRef.current.add(currentJob.id);
        datasetDetailCache.current.clear();
        setSelectedDataset("");
        setSelectedDatasetDetail(null);
        setDetailError(null);
        setDetailLoading(false);
        setSelectedFile(null);
        setUploaderKey((key) => key + 1);
      }

      return;
    }

    if (currentJob.status === "FAILED") {
      setProcessingState("idle");
      setErrorKey("analysis-failed");
      setAnalysis(null);
      return;
    }
  }, [currentJob]);

  const activeJobId = currentJob?.id;
  const activeJobStatus = currentJob?.status;
  const isPollingCandidate =
    activeJobStatus === "QUEUED" || activeJobStatus === "RUNNING";

  useEffect(() => {
    if (activeJobStatus === "CANCELED") {
      setProcessingState("idle");
      setAnalysis(null);
    }
  }, [activeJobStatus]);

  useEffect(() => {
    if (!activeJobId || !isPollingCandidate) {
      return;
    }

    let isCancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/imports/testmo/jobs/${activeJobId}`);

        if (!response.ok) {
          throw new Error("status-failed");
        }

        const { job } = (await response.json()) as {
          job: TestmoImportJobPayload;
        };

        if (isCancelled) {
          return;
        }

        setCurrentJob(job);
        setPollingError(null);
      } catch (error) {
        if (!isCancelled) {
          console.error("Failed to poll import job", error);
          setPollingError("status-failed");
        }
      }
    };

    // Poll immediately
    poll();

    // Determine polling interval based on job status
    // Use shorter interval during active import, longer for queued/waiting states
    const pollInterval =
      currentJob?.phase === "IMPORTING"
        ? 1000 // 1 second during active import
        : currentJob?.status === "QUEUED"
          ? 5000 // 5 seconds when queued
          : 2000; // 2 seconds for other active states

    const interval = setInterval(poll, pollInterval);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [activeJobId, isPollingCandidate, currentJob?.phase, currentJob?.status]);

  useEffect(() => {
    if (!currentJob) {
      return;
    }

    if (currentJob.analysis && typeof currentJob.analysis === "object") {
      const possibleAnalysis =
        currentJob.analysis as unknown as TestmoMappingAnalysis;
      if (possibleAnalysis?.summary) {
        setMappingAnalysis(possibleAnalysis);
      }
    }
  }, [currentJob]);

  useEffect(() => {
    if (!currentJob) {
      setMappingConfig(createEmptyMappingConfiguration());
      return;
    }

    setMappingConfig(normalizeMappingConfiguration(currentJob.configuration));
  }, [currentJob]);

  useEffect(() => {
    const jobId = currentJob?.id;
    if (!jobId) {
      return;
    }

    const shouldFetchAnalysis =
      currentJob.status === "READY" ||
      currentJob.status === "COMPLETED" ||
      (currentJob.status === "RUNNING" && currentJob.phase === "CONFIGURING");

    if (!shouldFetchAnalysis) {
      return;
    }

    const alreadyFetched = analysisFetchedRef.current.has(jobId);
    const hasSuggestions = Boolean(
      mappingAnalysis?.ambiguousEntities?.workflows?.length ||
      mappingAnalysis?.ambiguousEntities?.statuses?.length ||
      mappingAnalysis?.ambiguousEntities?.configurations?.length
    );

    if (alreadyFetched) {
      const missingConfigurationData = !(
        mappingAnalysis?.ambiguousEntities?.configurations &&
        mappingAnalysis?.existingEntities?.configurationCategories &&
        mappingAnalysis?.existingEntities?.configurationVariants &&
        mappingAnalysis?.existingEntities?.configurations
      );

      if (!hasSuggestions || missingConfigurationData) {
        analysisFetchedRef.current.delete(jobId);
      }
    }

    if (analysisFetchedRef.current.has(jobId)) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const fetchAnalysis = async () => {
      try {
        setAnalysisLoading(true);
        setAnalysisError(null);
        const response = await fetch(
          `/api/imports/testmo/jobs/${jobId}/analysis`,
          {
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error("analysis-failed");
        }

        const { analysis } = (await response.json()) as {
          analysis: TestmoMappingAnalysis;
        };

        if (cancelled) {
          return;
        }

        const serializedAnalysis = JSON.parse(
          JSON.stringify(analysis)
        ) as Record<string, unknown>;

        analysisFetchedRef.current.add(jobId);
        setMappingAnalysis(analysis);
        setCurrentJob((previous) =>
          previous && previous.id === jobId
            ? { ...previous, analysis: serializedAnalysis }
            : previous
        );
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch mapping analysis", error);
          setAnalysisError("analysis-failed");
        }
      } finally {
        if (!cancelled) {
          setAnalysisLoading(false);
        }
      }
    };

    fetchAnalysis();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    currentJob?.id,
    currentJob?.status,
    currentJob?.phase,
    analysisReloadToken,
    mappingAnalysis?.ambiguousEntities,
    setCurrentJob,
    mappingAnalysis?.existingEntities?.configurationCategories,
    mappingAnalysis?.existingEntities?.configurationVariants,
    mappingAnalysis?.existingEntities?.configurations,
  ]);

  useEffect(() => {
    if (!mappingAnalysis) {
      return;
    }

    setMappingConfig((prevConfig) => {
      const next: TestmoMappingConfiguration = {
        workflows: { ...prevConfig.workflows },
        statuses: { ...prevConfig.statuses },
        roles: { ...prevConfig.roles },
        groups: { ...prevConfig.groups },
        tags: { ...prevConfig.tags },
        issueTargets: { ...prevConfig.issueTargets },
        users: { ...prevConfig.users },
        templateFields: { ...prevConfig.templateFields },
        templates: { ...prevConfig.templates },
        customFields: { ...prevConfig.customFields },
        milestoneTypes: { ...prevConfig.milestoneTypes },
        configurations: { ...prevConfig.configurations },
      };

      let changed = false;

      const existingWorkflows =
        mappingAnalysis.existingEntities?.workflows ?? [];
      const existingStatuses = mappingAnalysis.existingEntities?.statuses ?? [];
      const existingRoles = mappingAnalysis.existingEntities?.roles ?? [];
      const existingMilestoneTypes =
        mappingAnalysis.existingEntities?.milestoneTypes ?? [];
      const existingGroups = mappingAnalysis.existingEntities?.groups ?? [];
      const existingUsers = mappingAnalysis.existingEntities?.users ?? [];
      const existingCaseFields =
        mappingAnalysis.existingEntities?.caseFields ?? [];
      const existingResultFields =
        mappingAnalysis.existingEntities?.resultFields ?? [];
      const existingCaseFieldTypes =
        mappingAnalysis.existingEntities?.caseFieldTypes ?? [];
      const existingConfigurations =
        mappingAnalysis.existingEntities?.configurations ?? [];
      const existingConfigVariants =
        mappingAnalysis.existingEntities?.configurationVariants ?? [];

      const defaultWorkflowId = existingWorkflows[0]?.id ?? null;
      const existingUsersByEmail = new Map(
        existingUsers
          .filter((user) => user.email)
          .map((user) => [user.email.toLowerCase(), user])
      );
      const existingUsersByName = new Map(
        existingUsers
          .filter((user) => user.name)
          .map((user) => [user.name.trim().toLowerCase(), user])
      );
      const defaultRoleIdForUsers =
        existingRoles.find((role) => role.isDefault)?.id ?? null;
      const roleNameToId = new Map(
        existingRoles.map((role) => [role.name.trim().toLowerCase(), role.id])
      );

      const existingStatusIds = new Set(
        Object.keys(prevConfig.statuses ?? {}).map((id) => id.toString())
      );

      mappingAnalysis.ambiguousEntities?.workflows?.forEach((workflow) => {
        if (next.workflows[workflow.id]) {
          return;
        }

        const matchedWorkflow = existingWorkflows.find(
          (existing) =>
            workflow.suggestedWorkflowType &&
            existing.workflowType === workflow.suggestedWorkflowType
        );

        const mappedTo = matchedWorkflow?.id ?? defaultWorkflowId;

        next.workflows[workflow.id] = {
          action: mappedTo ? "map" : "create",
          mappedTo: mappedTo ?? null,
          workflowType: workflow.suggestedWorkflowType ?? null,
        };
        changed = true;
      });

      mappingAnalysis.ambiguousEntities?.statuses?.forEach((status) => {
        if (existingStatusIds.has(status.id.toString())) {
          return;
        }

        const matchedStatus = existingStatuses.find(
          (existing) =>
            existing.name.toLowerCase() === status.name.toLowerCase()
        );

        if (matchedStatus) {
          next.statuses[status.id] = {
            action: "map",
            mappedTo: matchedStatus.id,
            name: matchedStatus.name,
            systemName: matchedStatus.systemName,
            colorHex: matchedStatus.colorHex ?? undefined,
            colorId: matchedStatus.colorId ?? null,
            aliases: matchedStatus.aliases ?? undefined,
            isSuccess: matchedStatus.isSuccess,
            isFailure: matchedStatus.isFailure,
            isCompleted: matchedStatus.isCompleted,
            isEnabled: true,
            scopeIds: matchedStatus.scopeIds ?? [],
          };
        } else {
          next.statuses[status.id] = {
            action: "create",
            mappedTo: null,
            name: status.name,
            systemName: status.systemName ?? undefined,
            colorHex: status.colorHex ?? undefined,
            colorId: null,
            aliases: undefined,
            isSuccess: status.isSuccess,
            isFailure: status.isFailure,
            isCompleted: status.isCompleted,
            isEnabled: true,
            scopeIds: [],
          };
        }
        existingStatusIds.add(status.id.toString());
        changed = true;
      });

      mappingAnalysis.ambiguousEntities?.groups?.forEach((group) => {
        if (next.groups[group.id]) {
          return;
        }

        const matchedGroup = existingGroups.find(
          (existing) => existing.name.toLowerCase() === group.name.toLowerCase()
        );

        if (matchedGroup) {
          next.groups[group.id] = {
            action: "map",
            mappedTo: matchedGroup.id,
            name: matchedGroup.name,
            note: matchedGroup.note ?? undefined,
          };
        } else {
          next.groups[group.id] = {
            action: "create",
            mappedTo: null,
            name: group.name,
            note: group.note ?? undefined,
          };
        }
        changed = true;
      });

      const existingTags = mappingAnalysis.existingEntities?.tags ?? [];
      mappingAnalysis.ambiguousEntities?.tags?.forEach((tag) => {
        if (next.tags[tag.id]) {
          return;
        }

        const matchedTag = existingTags.find(
          (existing) => existing.name.toLowerCase() === tag.name.toLowerCase()
        );

        if (matchedTag) {
          next.tags[tag.id] = {
            action: "map",
            mappedTo: matchedTag.id,
            name: matchedTag.name,
          };
        } else {
          next.tags[tag.id] = {
            action: "create",
            mappedTo: null,
            name: tag.name,
          };
        }
        changed = true;
      });

      mappingAnalysis.ambiguousEntities?.users?.forEach((user) => {
        if (next.users[user.id]) {
          return;
        }

        let matchedUser =
          (user.email
            ? existingUsersByEmail.get(user.email.toLowerCase())
            : null) ?? null;

        if (!matchedUser && user.name) {
          matchedUser =
            existingUsersByName.get(user.name.trim().toLowerCase()) ?? null;
        }

        if (matchedUser) {
          next.users[user.id] = {
            action: "map",
            mappedTo: matchedUser.id,
          };
        } else {
          const suggestedRoleId = user.roleName
            ? (roleNameToId.get(user.roleName.trim().toLowerCase()) ??
              defaultRoleIdForUsers)
            : defaultRoleIdForUsers;
          next.users[user.id] = {
            action: "create",
            mappedTo: null,
            name: user.name ?? undefined,
            email: user.email ?? undefined,
            isActive: user.isActive ?? true,
            isApi: user.isApi ?? false,
            access: user.access ?? Access.USER,
            roleId: suggestedRoleId ?? null,
            password: generateRandomPassword(),
          };
        }
        changed = true;
      });

      const caseFieldById = new Map(
        existingCaseFields.map((field) => [field.id, field])
      );
      const caseFieldBySystem = new Map(
        existingCaseFields
          .filter((field) => field.systemName)
          .map((field) => [field.systemName.trim().toLowerCase(), field])
      );
      const caseFieldByDisplay = new Map(
        existingCaseFields
          .filter((field) => field.displayName)
          .map((field) => [field.displayName.trim().toLowerCase(), field])
      );
      const resultFieldById = new Map(
        existingResultFields.map((field) => [field.id, field])
      );
      const resultFieldBySystem = new Map(
        existingResultFields
          .filter((field) => field.systemName)
          .map((field) => [field.systemName.trim().toLowerCase(), field])
      );
      const resultFieldByDisplay = new Map(
        existingResultFields
          .filter((field) => field.displayName)
          .map((field) => [field.displayName.trim().toLowerCase(), field])
      );

      const normalizeFieldTypeName = (value?: string | null) =>
        value ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") || null : null;

      const fieldTypeLookup = new Map(
        existingCaseFieldTypes.map((type) => {
          const normalized =
            normalizeFieldTypeName(type.type) ?? type.type.trim().toLowerCase();
          return [normalized, type] as const;
        })
      );

      mappingAnalysis.ambiguousEntities?.templateFields?.forEach((field) => {
        if (next.templateFields[field.id]) {
          return;
        }

        const normalizedSystemName =
          field.systemName?.trim().toLowerCase() ?? null;
        const normalizedDisplayName =
          field.displayName?.trim().toLowerCase() ?? null;
        const isResultField = field.targetType === "result";

        const existingMatch = (() => {
          if (field.fieldId && field.fieldId !== null) {
            return isResultField
              ? resultFieldById.get(field.fieldId)
              : caseFieldById.get(field.fieldId);
          }
          if (normalizedSystemName) {
            const match = isResultField
              ? resultFieldBySystem.get(normalizedSystemName)
              : caseFieldBySystem.get(normalizedSystemName);
            if (match) {
              return match;
            }
          }
          if (normalizedDisplayName) {
            return isResultField
              ? resultFieldByDisplay.get(normalizedDisplayName)
              : caseFieldByDisplay.get(normalizedDisplayName);
          }
          return undefined;
        })();

        if (existingMatch) {
          next.templateFields[field.id] = {
            action: "map",
            targetType: field.targetType,
            mappedTo: existingMatch.id,
          };

          changed = true;
          return;
        }

        const normalizedTypeName = normalizeFieldTypeName(field.fieldType);
        const matchedTypeId = normalizedTypeName
          ? (fieldTypeLookup.get(normalizedTypeName)?.id ?? null)
          : null;

        next.templateFields[field.id] = {
          action: "create",
          targetType: field.targetType,
          mappedTo: null,
          displayName: field.displayName ?? undefined,
          systemName: field.systemName ?? undefined,
          typeId: matchedTypeId,
          typeName: field.fieldType ?? undefined,
          hint: field.hint ?? undefined,
          isRequired: field.isRequired ?? false,
          isRestricted: field.isRestricted ?? false,
          defaultValue: field.defaultValue ?? null,
          isChecked: field.isChecked ?? null,
          minValue: field.minValue ?? null,
          maxValue: field.maxValue ?? null,
          minIntegerValue: field.minIntegerValue ?? null,
          maxIntegerValue: field.maxIntegerValue ?? null,
          initialHeight: field.initialHeight ?? null,
          dropdownOptions: convertNamesToOptionConfigs(
            field.dropdownOptions?.map((option) => option?.name ?? "")
          ),
          templateName: field.templateName ?? undefined,
          order: field.order ?? undefined,
        };

        changed = true;
      });

      mappingAnalysis.ambiguousEntities?.roles?.forEach((role) => {
        if (next.roles[role.id]) {
          return;
        }

        const matchedRole = existingRoles.find(
          (existing) => existing.name.toLowerCase() === role.name.toLowerCase()
        );

        if (matchedRole) {
          next.roles[role.id] = {
            action: "map",
            mappedTo: matchedRole.id,
            name: matchedRole.name,
            isDefault: matchedRole.isDefault,
            permissions: matchedRole.permissions,
          };
        } else {
          next.roles[role.id] = {
            action: "create",
            mappedTo: null,
            name: role.name,
            isDefault: role.isDefault ?? false,
            permissions: role.permissions ?? {},
          };
        }
        changed = true;
      });

      mappingAnalysis.ambiguousEntities?.milestoneTypes?.forEach(
        (milestoneType) => {
          if (next.milestoneTypes[milestoneType.id]) {
            return;
          }

          const matchedMilestoneType = existingMilestoneTypes.find(
            (existing) =>
              existing.name.toLowerCase() === milestoneType.name.toLowerCase()
          );

          if (matchedMilestoneType) {
            next.milestoneTypes[milestoneType.id] = {
              action: "map",
              mappedTo: matchedMilestoneType.id,
              name: matchedMilestoneType.name,
              iconId: matchedMilestoneType.iconId ?? null,
              isDefault: matchedMilestoneType.isDefault,
            };
          } else {
            next.milestoneTypes[milestoneType.id] = {
              action: "create",
              mappedTo: null,
              name: milestoneType.name,
              iconId: null,
              isDefault: milestoneType.isDefault ?? false,
            };
          }
          changed = true;
        }
      );

      const variantLookup = new Map(
        existingConfigVariants.map((variant) => [
          variant.name.toLowerCase(),
          variant,
        ])
      );

      mappingAnalysis.ambiguousEntities?.configurations?.forEach(
        (configurationSuggestion) => {
          if (next.configurations[configurationSuggestion.id]) {
            return;
          }

          const matchedConfiguration = existingConfigurations.find(
            (existing) =>
              existing.name.toLowerCase() ===
              configurationSuggestion.name.toLowerCase()
          );

          if (matchedConfiguration) {
            next.configurations[configurationSuggestion.id] = {
              action: "map",
              mappedTo: matchedConfiguration.id,
              variants: {},
            } satisfies TestmoConfigurationMappingConfig;
            changed = true;
            return;
          }

          const variants: Record<number, TestmoConfigVariantMappingConfig> = {};

          configurationSuggestion.variantTokens.forEach((token, index) => {
            const existingVariant = variantLookup.get(token.toLowerCase());
            if (existingVariant) {
              variants[index] = {
                token,
                action: "map-variant",
                mappedVariantId: existingVariant.id,
              };
            } else {
              variants[index] = {
                token,
                action: "create-category-variant",
                mappedVariantId: undefined,
                categoryId: undefined,
                categoryName: token,
                variantName: token,
              };
            }
          });

          next.configurations[configurationSuggestion.id] = {
            action: "create",
            mappedTo: null,
            name: configurationSuggestion.name,
            variants,
          } satisfies TestmoConfigurationMappingConfig;
          changed = true;
        }
      );

      return changed ? next : prevConfig;
    });
  }, [mappingAnalysis]);

  useEffect(() => {
    if (
      !currentJob ||
      (currentJob.status !== "COMPLETED" && currentJob.status !== "READY") ||
      !currentJob.summary
    ) {
      return;
    }

    const jobId = currentJob.id;

    if (analysis?.datasets?.length) {
      datasetSummariesFetchedRef.current.add(jobId);
      return;
    }

    if (datasetSummariesFetchedRef.current.has(jobId)) {
      return;
    }

    datasetSummariesFetchedRef.current.add(jobId);

    let cancelled = false;

    fetch(`/api/imports/testmo/jobs/${jobId}/datasets`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("summary-failed");
        }
        return response.json() as Promise<{
          datasets: TestmoDatasetSummaryPayload[];
        }>;
      })
      .then(({ datasets }) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setAnalysis((previous) => {
            if (previous) {
              return {
                ...previous,
                datasets,
              };
            }

            return {
              ...currentJob.summary!,
              datasets,
            };
          });
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to fetch dataset summaries", error);
          setPollingError("summary-failed");
          datasetSummariesFetchedRef.current.delete(jobId);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentJob, analysis?.datasets?.length]);

  const isJobActive =
    currentJob?.status === "QUEUED" || currentJob?.status === "RUNNING";

  const isProcessing = processingState === "uploading" || Boolean(isJobActive);
  const uploadInProgress =
    processingState === "uploading" || processingState === "analyzing";

  const handleCancel = useCallback(async () => {
    if (!currentJob || !isJobActive) {
      return;
    }

    setCancelLoading(true);
    try {
      const response = await fetch(
        `/api/imports/testmo/jobs/${currentJob.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        }
      );

      if (!response.ok) {
        throw new Error("cancel-failed");
      }

      const { job } = (await response.json()) as {
        job: TestmoImportJobPayload;
      };
      setCurrentJob(job);
      setPollingError(null);
    } catch (error) {
      console.error("Failed to request cancellation", error);
      setPollingError("cancel-failed");
    } finally {
      setCancelLoading(false);
    }
  }, [currentJob, isJobActive]);

  useEffect(() => {
    if (!analysis) {
      datasetDetailCache.current.clear();
      setSelectedDatasetDetail(null);
      setDetailError(null);
    }
  }, [analysis]);

  useEffect(() => {
    if (
      !selectedDatasetSummary ||
      !currentJob ||
      (currentJob.status !== "COMPLETED" && currentJob.status !== "READY")
    ) {
      setSelectedDatasetDetail(null);
      setDetailError(null);
      return;
    }

    const cached = datasetDetailCache.current.get(selectedDatasetSummary.id);
    const needsRefresh = (() => {
      if (!cached) {
        return true;
      }
      const hasSchema = cached.schema && Object.keys(cached.schema).length > 0;
      const hasSamples =
        Array.isArray(cached.sampleRows) && cached.sampleRows.length > 0;
      const expectedSamples = selectedDatasetSummary.sampleRowCount > 0;

      if (!hasSchema) {
        return true;
      }

      if (expectedSamples && !hasSamples) {
        return true;
      }

      return false;
    })();

    if (!needsRefresh && cached) {
      setSelectedDatasetDetail(cached);
      setDetailError(null);
      return;
    }

    let canceled = false;
    setDetailLoading(true);
    setDetailError(null);

    fetch(
      `/api/imports/testmo/jobs/${currentJob.id}/datasets/${selectedDatasetSummary.id}`
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("detail-failed");
        }
        return response.json() as Promise<{
          dataset: TestmoDatasetDetailPayload;
        }>;
      })
      .then(({ dataset }) => {
        if (canceled) {
          return;
        }
        datasetDetailCache.current.set(dataset.id, dataset);
        setSelectedDatasetDetail(dataset);
        setDetailError(null);
      })
      .catch((error) => {
        if (!canceled) {
          console.error("Failed to fetch dataset detail", error);
          setDetailError("detail-failed");
          setSelectedDatasetDetail(null);
        }
      })
      .finally(() => {
        if (!canceled) {
          setDetailLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [selectedDatasetSummary, currentJob]);

  const jobStatusCard = currentJob ? (
    <div className="space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={(() => {
            switch (currentJob.status) {
              case "COMPLETED":
                return "secondary";
              case "FAILED":
              case "CANCELED":
                return "destructive";
              default:
                return "outline";
            }
          })()}
        >
          {currentJob.status}
        </Badge>
        {currentJob.statusMessage && currentJob.phase !== "ANALYZING" && (
          <span className="text-sm text-muted-foreground">
            {currentJob.statusMessage}
          </span>
        )}
      </div>
      {(() => {
        const total =
          currentJob.totalDatasets ??
          currentJob.summary?.meta.totalDatasets ??
          null;
        const processed = currentJob.processedDatasets ?? 0;

        if (currentJob.phase === "ANALYZING") {
          // Try to extract percentage from status message (e.g., "Scanning file... 25% complete")
          const statusMessage = currentJob.statusMessage || "";
          const percentMatch = statusMessage.match(/(\d+)%/);
          const bytePercent = percentMatch
            ? parseInt(percentMatch[1], 10)
            : null;

          if (bytePercent !== null && bytePercent >= 0 && bytePercent <= 100) {
            // We have byte-level progress from file scanning
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{statusMessage}</span>
                  <div className="flex items-center gap-2">
                    {currentJob.estimatedTimeRemaining && (
                      <span className="flex items-center gap-1">
                        <span className="font-medium">
                          {t("testmo.job.estimatedTimeRemaining")}
                        </span>
                        <DurationDisplay
                          seconds={Number(currentJob.estimatedTimeRemaining)}
                        />
                      </span>
                    )}
                  </div>
                </div>
                <Progress value={bytePercent} />
              </div>
            );
          } else if (total !== null && total > 0) {
            // We know the total datasets, show dataset-level progress
            const percent = Math.min(
              100,
              Math.round((processed / total) * 100)
            );
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-end text-xs text-muted-foreground">
                  <span>{`${percent}%`}</span>
                </div>
                <Progress value={percent} />
              </div>
            );
          } else {
            // We don't have any progress info yet, show indeterminate progress
            return (
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="absolute h-full w-1/3 animate-[shimmer_2s_infinite] bg-primary/20"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, transparent, hsl(var(--primary) / 0.6))",
                    animation: "shimmer 2s infinite",
                  }}
                />
              </div>
            );
          }
        }
        return null;
      })()}
      {isJobActive && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={cancelLoading || currentJob.cancelRequested}
          >
            {currentJob.cancelRequested
              ? t("testmo.job.cancelRequested")
              : t("testmo.job.cancel")}
          </Button>
        </div>
      )}
      {currentJob.error && (
        <Alert variant="destructive">
          <AlertTitle>{t("errors.analysisFailed")}</AlertTitle>
          <AlertDescription>{currentJob.error}</AlertDescription>
        </Alert>
      )}
    </div>
  ) : null;

  const analysisSectionContent = analysis && (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label={t("testmo.summary.datasets")}
          value={analysis.meta.totalDatasets.toLocaleString()}
        />
        <SummaryTile
          label={t("testmo.summary.rows")}
          value={analysis.meta.totalRows.toLocaleString()}
        />
        <SummaryTile
          label={t("testmo.summary.fileName")}
          value={
            <div className="space-y-1">
              <div className="truncate" title={analysis.meta.fileName}>
                {analysis.meta.fileName}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(analysis.meta.startedAt)}
              </div>
            </div>
          }
        />
        <SummaryTile
          label={t("testmo.summary.fileSize")}
          value={fileSizeDisplay ?? "—"}
        />
        <SummaryTile
          label={t("testmo.summary.analysisTime")}
          value={
            <div className="space-y-1">
              <div>{formatDuration(analysis.meta.durationMs)}</div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(analysis.meta.completedAt)}
              </div>
            </div>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("testmo.datasetTable.name")}</TableHead>
                  <TableHead className="text-right">
                    {t("testmo.datasetTable.rows")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.datasets.map((dataset) => {
                  const isSelected = dataset.name === selectedDataset;
                  return (
                    <TableRow
                      key={dataset.name}
                      className={`cursor-pointer ${
                        isSelected ? "bg-muted" : "hover:bg-muted/70"
                      }`}
                      onClick={() => setSelectedDataset(dataset.name)}
                    >
                      <TableCell className="font-medium">
                        {dataset.name}
                      </TableCell>
                      <TableCell className="text-right">
                        {dataset.rowCount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dataset-select">{t("testmo.selectDataset")}</Label>
            <Select
              value={selectedDataset}
              onValueChange={(value) => setSelectedDataset(value)}
              disabled={!analysis.datasets.length}
            >
              <SelectTrigger id="dataset-select">
                <SelectValue placeholder={t("testmo.selectDataset")} />
              </SelectTrigger>
              <SelectContent>
                {analysis.datasets.map((dataset) => (
                  <SelectItem key={dataset.name} value={dataset.name}>
                    {dataset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t("testmo.schema")}</Label>
            <ScrollArea className="h-48 rounded-md border bg-muted/40 p-4">
              {!selectedDatasetSummary ? (
                <p className="text-xs text-muted-foreground">
                  {t("testmo.selectDataset")}
                </p>
              ) : detailLoading ? (
                <LoadingSpinner />
              ) : detailError ? (
                <p className="text-xs text-destructive">
                  {t("errors.analysisFailed")}
                </p>
              ) : (
                <pre className="text-xs">
                  {selectedDatasetDetail?.schema
                    ? JSON.stringify(selectedDatasetDetail.schema, null, 2)
                    : "{}"}
                </pre>
              )}
            </ScrollArea>
          </div>
          <div className="space-y-2">
            <Label>{t("testmo.samples")}</Label>
            <ScrollArea className="h-48 rounded-md border bg-muted/40 p-4 wrap-anywhere">
              {!selectedDatasetSummary ? (
                <p className="text-xs text-muted-foreground">
                  {t("testmo.selectDataset")}
                </p>
              ) : detailLoading ? (
                <LoadingSpinner />
              ) : detailError ? (
                <p className="text-xs text-destructive">
                  {t("errors.analysisFailed")}
                </p>
              ) : selectedDatasetDetail?.sampleRows?.length ? (
                <pre className="whitespace-pre-wrap text-xs">
                  {JSON.stringify(selectedDatasetDetail.sampleRows, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("testmo.noSamples")}
                </p>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );

  const mappingSectionContent = currentJob ? (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("testmo.mappingDescription")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshAnalysis}
            disabled={analysisLoading}
          >
            {t("testmo.mappingRefresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleTriggerImportConfiguration}
            disabled={importInProgress}
          >
            <Import />
            {t("testmo.mappingImportConfiguration")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleExportConfiguration}
          >
            <FileUp />
            {t("testmo.mappingExportConfiguration")}
          </Button>
        </div>
      </div>
      {analysisError && (
        <Alert variant="destructive">
          <AlertTitle>{t("errors.analysisFailed")}</AlertTitle>
          <AlertDescription>
            {t("testmo.mappingAnalysisError")}
          </AlertDescription>
        </Alert>
      )}
      {analysisLoading && (
        <p className="text-xs text-muted-foreground">
          {t("testmo.mappingLoading")}
        </p>
      )}
      {!isMappingComplete && blockingDatasets.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>{t("testmo.mappingOutstandingTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("testmo.mappingOutstandingDescription")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {blockingDatasets.map((item) => (
                <li key={item.key}>
                  {t("testmo.mappingOutstandingItem", {
                    count: item.count,
                    label: item.label,
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {datasetEntries.length > 0 ? (
        <Tabs
          value={activeMappingDataset}
          onValueChange={setActiveMappingDataset}
          className="w-full"
        >
          <div className="w-full overflow-x-auto">
            <TabsList className="flex h-auto w-full gap-x-3 flex-wrap bg-primary/10">
              {datasetEntries.map(({ key, count }) => {
                const outstanding = datasetOutstandingCounts[key] ?? 0;
                return (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="flex items-center gap-2 border"
                  >
                    <span className="truncate">{datasetLabelFor(key)}</span>
                    <Badge variant="secondary">{count.toLocaleString()}</Badge>
                    {outstanding > 0 && (
                      <Badge variant="destructive">
                        {outstanding.toLocaleString()}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {datasetEntries.map(({ key, count }) => {
            const label = datasetLabelFor(key);
            const description = datasetDescriptionFor(key);
            const hasWorkflowMapping =
              key === "states" &&
              (mappingAnalysis?.ambiguousEntities?.workflows?.length ?? 0) > 0;
            const hasStatusMapping =
              key === "statuses" &&
              (mappingAnalysis?.ambiguousEntities?.statuses?.length ?? 0) > 0;
            const hasRoleMapping =
              key === "roles" &&
              (mappingAnalysis?.ambiguousEntities?.roles?.length ?? 0) > 0;
            const hasMilestoneMapping =
              key === "milestone_types" &&
              (mappingAnalysis?.ambiguousEntities?.milestoneTypes?.length ??
                0) > 0;
            const hasGroupMapping =
              key === "groups" &&
              (mappingAnalysis?.ambiguousEntities?.groups?.length ?? 0) > 0;
            const hasIssueTargetMapping =
              key === "issue_targets" &&
              ((mappingAnalysis?.ambiguousEntities?.issueTargets?.length ?? 0) >
                0 ||
                count > 0);
            const hasUserMapping =
              key === "users" &&
              ((mappingAnalysis?.ambiguousEntities?.users?.length ?? 0) > 0 ||
                count > 0);
            const hasTemplateFieldMapping =
              key === "template_fields" &&
              ((mappingAnalysis?.ambiguousEntities?.templateFields?.length ??
                0) > 0 ||
                count > 0);
            const hasTemplateMapping =
              key === "templates" &&
              ((mappingAnalysis?.ambiguousEntities?.templates?.length ?? 0) >
                0 ||
                count > 0);
            const hasConfigurationMapping =
              key === "configs" &&
              (mappingAnalysis?.ambiguousEntities?.configurations?.length ??
                0) > 0;
            const showConfigurator = SUPPORTED_MAPPING_DATASETS.has(key);
            const visibleSections =
              key === "states"
                ? { workflows: true }
                : key === "statuses"
                  ? { statuses: true }
                  : key === "roles"
                    ? { roles: true }
                    : key === "templates"
                      ? { templates: true }
                      : key === "template_fields"
                        ? { templateFields: true }
                        : key === "users"
                          ? { users: true, workflows: false }
                          : key === "milestone_types"
                            ? { milestoneTypes: true }
                            : key === "groups"
                              ? { groups: true }
                              : key === "issue_targets"
                                ? { issueTargets: true }
                                : key === "configs"
                                  ? { configurations: true }
                                  : {
                                      workflows: false,
                                      statuses: false,
                                      roles: false,
                                      templates: false,
                                      users: false,
                                      templateFields: false,
                                      milestoneTypes: false,
                                      groups: false,
                                      issueTargets: false,
                                      configurations: false,
                                    };
            const isMappingDataset = SUPPORTED_MAPPING_DATASETS.has(key);
            const sectionDescriptions = isMappingDataset
              ? key === "states"
                ? { workflows: description }
                : key === "statuses"
                  ? { statuses: description }
                  : key === "roles"
                    ? { roles: description }
                    : key === "templates"
                      ? { templates: description }
                      : key === "template_fields"
                        ? { templateFields: description }
                        : key === "users"
                          ? { users: description }
                          : key === "milestone_types"
                            ? { milestoneTypes: description }
                            : key === "groups"
                              ? { groups: description }
                              : key === "issue_targets"
                                ? { issueTargets: description }
                                : key === "configs"
                                  ? { configurations: description }
                                  : undefined
              : undefined;
            const sectionCounts = isMappingDataset
              ? key === "states"
                ? { workflows: count }
                : key === "statuses"
                  ? { statuses: count }
                  : key === "roles"
                    ? { roles: count }
                    : key === "templates"
                      ? { templates: count }
                      : key === "template_fields"
                        ? { templateFields: count }
                        : key === "users"
                          ? { users: count }
                          : key === "milestone_types"
                            ? { milestoneTypes: count }
                            : key === "groups"
                              ? { groups: count }
                              : key === "issue_targets"
                                ? { issueTargets: count }
                                : key === "configs"
                                  ? { configurations: count }
                                  : undefined
              : undefined;

            const hasMappingEntities =
              key === "configs"
                ? true
                : (key === "states" && hasWorkflowMapping) ||
                  (key === "statuses" && hasStatusMapping) ||
                  (key === "roles" && hasRoleMapping) ||
                  (key === "templates" && hasTemplateMapping) ||
                  (key === "template_fields" && hasTemplateFieldMapping) ||
                  (key === "milestone_types" && hasMilestoneMapping) ||
                  (key === "groups" && hasGroupMapping) ||
                  (key === "issue_targets" && hasIssueTargetMapping) ||
                  (key === "users" && hasUserMapping);

            return (
              <TabsContent
                key={key}
                value={key}
                className="focus-visible:outline-none"
              >
                <div className="mt-4 space-y-4">
                  {!isMappingDataset && (
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <h4 className="text-base font-semibold">{label}</h4>
                        <p className="text-sm text-muted-foreground">
                          {description}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {t("testmo.mappingDatasetCount", { count })}
                      </Badge>
                    </div>
                  )}

                  {showConfigurator ? (
                    hasMappingEntities ? (
                      <TestmoMappingConfigurator
                        analysis={mappingAnalysis}
                        configuration={mappingConfig}
                        onConfigurationChange={handleMappingConfigurationChange}
                        datasetKey={key}
                        visibleSections={visibleSections}
                        sectionDescriptions={sectionDescriptions}
                        sectionCounts={sectionCounts}
                      />
                    ) : (
                      <Alert>
                        <AlertTitle>
                          {t("testmo.mappingDatasetNoEntitiesTitle")}
                        </AlertTitle>
                        <AlertDescription>
                          {t("testmo.mappingDatasetNoEntitiesDescription")}
                        </AlertDescription>
                      </Alert>
                    )
                  ) : (
                    <Alert>
                      <AlertTitle>
                        {t("testmo.mappingDatasetUnsupportedTitle")}
                      </AlertTitle>
                      <AlertDescription>
                        {t("testmo.mappingDatasetUnsupportedDescription")}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        <Alert>
          <AlertTitle>{t("testmo.mappingDatasetEmptyTitle")}</AlertTitle>
          <AlertDescription>
            {t("testmo.mappingDatasetEmptyDescription")}
          </AlertDescription>
        </Alert>
      )}
      {configurationError && (
        <p className="text-xs text-destructive">{configurationError}</p>
      )}

      <input
        title={t("testmo.mappingImportConfiguration")}
        ref={importConfigInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleConfigurationFileChange}
      />
    </div>
  ) : null;

  interface ActivityLogEntryDisplay {
    type: "message" | "summary";
    timestamp: string | null;
    title: string;
    description?: string;
    details?: Record<string, unknown>;
  }

  const activityLogEntries = useMemo<ActivityLogEntryDisplay[]>(() => {
    if (!currentJob?.activityLog || !Array.isArray(currentJob.activityLog)) {
      return [];
    }

    const entries: ActivityLogEntryDisplay[] = [];

    (currentJob.activityLog as unknown[]).forEach((raw) => {
      if (!raw || typeof raw !== "object") {
        return;
      }

      const entry = raw as Record<string, unknown>;
      const type =
        entry.type === "summary" || entry.type === "message"
          ? entry.type
          : "message";
      const timestamp =
        typeof entry.timestamp === "string" ? entry.timestamp : null;

      if (type === "summary") {
        const entity = typeof entry.entity === "string" ? entry.entity : "";
        const total = typeof entry.total === "number" ? entry.total : undefined;
        const created =
          typeof entry.created === "number" ? entry.created : undefined;
        const mapped =
          typeof entry.mapped === "number" ? entry.mapped : undefined;
        const detailPieces: string[] = [];
        if (typeof created === "number") {
          detailPieces.push(
            t("testmo.activitySummaryCreated", { count: created })
          );
        }
        if (typeof mapped === "number") {
          detailPieces.push(
            t("testmo.activitySummaryMapped", { count: mapped })
          );
        }
        const descriptionParts = [
          total !== undefined
            ? t("testmo.activitySummaryProcessed", { count: total })
            : null,
          detailPieces.length > 0 ? detailPieces.join(" · ") : null,
        ].filter(Boolean) as string[];

        entries.push({
          type,
          timestamp,
          title: entity
            ? entity.replace(/_/g, " ")
            : t("testmo.activitySummaryUnknown"),
          description:
            descriptionParts.length > 0
              ? descriptionParts.join(" — ")
              : undefined,
          details:
            typeof entry.details === "object" && entry.details !== null
              ? (entry.details as Record<string, unknown>)
              : undefined,
        });
        return;
      }

      const message =
        typeof entry.message === "string"
          ? entry.message
          : t("testmo.activityDefaultMessage");

      entries.push({
        type: "message",
        timestamp,
        title: message,
        description:
          typeof entry.details === "object" && entry.details !== null
            ? JSON.stringify(entry.details)
            : undefined,
      });
    });

    return entries;
  }, [currentJob?.activityLog, t]);

  const displayedActivityLogEntries = useMemo(
    () => [...activityLogEntries].reverse().slice(0, activityLogDisplayLimit),
    [activityLogEntries, activityLogDisplayLimit]
  );

  const formatEntityProgressLabel = useCallback(
    (entityKey: string) => {
      if (!entityKey) {
        return t("testmo.activitySummaryUnknown");
      }
      const spaced = entityKey
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ");
      return spaced.replace(
        /(^|\s)([a-z])/g,
        (_, boundary, char: string) => `${boundary ?? ""}${char.toUpperCase()}`
      );
    },
    [t]
  );

  const entityProgressSummary = useMemo(() => {
    if (
      !currentJob?.entityProgress ||
      typeof currentJob.entityProgress !== "object"
    ) {
      return [] as Array<{
        key: string;
        label: string;
        total: number;
        processed: number;
        remaining: number;
      }>;
    }

    const entries: Array<{
      key: string;
      label: string;
      total: number;
      processed: number;
      remaining: number;
    }> = [];

    Object.entries(
      currentJob.entityProgress as Record<string, unknown>
    ).forEach(([key, value]) => {
      if (!value || typeof value !== "object") {
        return;
      }
      const record = value as Record<string, unknown>;
      const total =
        typeof record.total === "number" && Number.isFinite(record.total)
          ? record.total
          : 0;
      const created =
        typeof record.created === "number" && Number.isFinite(record.created)
          ? record.created
          : 0;
      const mapped =
        typeof record.mapped === "number" && Number.isFinite(record.mapped)
          ? record.mapped
          : 0;
      const processed = Math.max(created + mapped, 0);
      const remaining = Math.max(total - processed, 0);

      entries.push({
        key,
        label: formatEntityProgressLabel(key),
        total,
        processed,
        remaining,
      });
    });

    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }, [currentJob?.entityProgress, formatEntityProgressLabel]);

  const {
    totalRecords,
    processedRecords,
    totalRemainingRecords,
    completionPercent,
  } = useMemo(() => {
    const fallbackTotal = entityProgressSummary.reduce(
      (sum, entry) => sum + entry.total,
      0
    );
    const fallbackProcessed = entityProgressSummary.reduce(
      (sum, entry) => sum + entry.processed,
      0
    );

    const jobTotal =
      typeof currentJob?.totalCount === "number" && currentJob.totalCount > 0
        ? Number(currentJob.totalCount)
        : null;
    const jobProcessed =
      typeof currentJob?.processedCount === "number"
        ? Number(currentJob.processedCount)
        : null;

    const total = jobTotal ?? fallbackTotal;
    const processed = Math.min(jobProcessed ?? fallbackProcessed, total);
    const remaining = Math.max(total - processed, 0);
    const percent =
      total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

    return {
      totalRecords: total,
      processedRecords: processed,
      totalRemainingRecords: remaining,
      completionPercent: percent,
    };
  }, [
    currentJob?.processedCount,
    currentJob?.totalCount,
    entityProgressSummary,
  ]);

  const importSectionContent = currentJob ? (
    <div className="space-y-4">
      {entityProgressSummary.length > 0 && (
        <div className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold">
                {t("testmo.importProgressTitle")}
              </h4>
            </div>
            {currentJob?.phase === "IMPORTING" && (
              <span className="text-sm font-medium text-muted-foreground">
                {t("testmo.importProgressTotalRemaining", {
                  count: totalRemainingRecords,
                })}
              </span>
            )}
          </div>
          <div className="space-y-2">
            <Progress
              value={completionPercent}
              aria-label={t("testmo.importProgressAria", {
                percent: completionPercent,
              })}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("testmo.importProgressProcessed", {
                  processed: processedRecords,
                  total: totalRecords,
                })}
              </span>
              <span>
                {t("testmo.importProgressPercentLabel", {
                  percent: completionPercent,
                })}
              </span>
            </div>
            {currentJob?.phase === "IMPORTING" && (
              <div className="flex justify-between items-center">
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  {(() => {
                    const processed = currentJob.processedDatasets ?? 0;
                    const total =
                      currentJob.totalDatasets ??
                      currentJob.summary?.meta.totalDatasets ??
                      null;

                    if (total != null && total > 0) {
                      return (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">
                            {t("testmo.job.datasetsLabel", {
                              defaultValue: "Datasets:",
                            })}
                          </span>
                          <span>{`${processed}/${total}`}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  {currentJob.processingRate && (
                    <div className="flex items-center gap-1">
                      <span className="font-medium">
                        {t("testmo.job.processingRate")}
                      </span>
                      <span>{currentJob.processingRate}</span>
                    </div>
                  )}

                  {typeof currentJob.processedRows === "number" &&
                    currentJob.processedRows > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">
                          {t("testmo.job.rowsProcessedLabel", {
                            defaultValue: "Rows:",
                          })}
                        </span>
                        <span>{currentJob.processedRows.toLocaleString()}</span>
                      </div>
                    )}
                </div>
                {currentJob.estimatedTimeRemaining && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="font-medium">
                      {t("testmo.job.estimatedTimeRemaining")}
                    </span>
                    <DurationDisplay
                      seconds={Number(currentJob.estimatedTimeRemaining)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {importInProgress ? (
        <Alert>
          <AlertTitle>{t("testmo.mappingImportInProgress")}</AlertTitle>
          <AlertDescription>
            {currentJob.statusMessage ??
              t("testmo.mappingImportInProgressDescription")}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>{currentJob.status}</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <div>
                {currentJob.statusMessage ?? t("testmo.nextStepsDescription")}
              </div>
              {currentJob.status === "COMPLETED" &&
                currentJob.durationMs != null && (
                  <div className="text-sm">
                    <span className="font-medium">
                      {t("testmo.importDurationLabel")}
                    </span>{" "}
                    <DurationDisplay seconds={currentJob.durationMs / 1000} />
                  </div>
                )}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {activityLogEntries.length > 0 && (
        <div className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">
                {t("testmo.activityLogTitle")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t("testmo.activityLogDescription")}
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              {displayedActivityLogEntries.length === activityLogEntries.length
                ? `${activityLogEntries.length} ${activityLogEntries.length === 1 ? "entry" : "entries"}`
                : `Showing ${displayedActivityLogEntries.length} of ${activityLogEntries.length} entries`}
            </div>
          </div>
          <ScrollArea className="h-64">
            <div className="space-y-3 pr-2">
              {displayedActivityLogEntries.map((entry, index) => (
                <div
                  key={`${entry.type}-${entry.timestamp ?? "no-time"}-${index}`}
                  className="rounded border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{entry.title}</span>
                    {entry.timestamp && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
          {displayedActivityLogEntries.length < activityLogEntries.length && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActivityLogDisplayLimit((prev) => prev + 50)}
              >
                {`Load More (${activityLogEntries.length - displayedActivityLogEntries.length} remaining)`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  const uploadStatus = stepStatusFor(WizardStep.Upload);
  const analyzeStatus = stepStatusFor(WizardStep.Analyze);
  const configureStatus = stepStatusFor(WizardStep.Configure);
  const importStatus = stepStatusFor(WizardStep.Import);

  const canGoPrev = activeStep > WizardStep.Upload;
  const canGoNext = useMemo(() => {
    if (activeStep === WizardStep.Upload) {
      if (uploadInProgress) {
        return false;
      }
      if (currentJob) {
        return true;
      }
      return Boolean(selectedFile);
    }
    if (activeStep === WizardStep.Configure) {
      return canStartImport && !importInProgress && !importStarting;
    }
    return activeStep < maxUnlockedStep;
  }, [
    activeStep,
    canStartImport,
    currentJob,
    importInProgress,
    importStarting,
    maxUnlockedStep,
    selectedFile,
    uploadInProgress,
  ]);

  const scrollToTop = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleStepSelect = useCallback(
    (step: WizardStep) => {
      if (step <= maxUnlockedStep) {
        setActiveStep((previous) => {
          if (previous === step) {
            return previous;
          }
          requestAnimationFrame(() => scrollToTop());
          return step;
        });
      }
    },
    [maxUnlockedStep, scrollToTop]
  );

  const goPrev = useCallback(() => {
    setActiveStep((previous) => {
      if (previous > WizardStep.Upload) {
        const next = (previous - 1) as WizardStep;
        requestAnimationFrame(() => scrollToTop());
        return next;
      }
      return previous;
    });
  }, [scrollToTop]);

  const goNext = useCallback(() => {
    setActiveStep((previous) => {
      if (previous >= maxUnlockedStep) {
        return previous;
      }
      const next = Math.min(previous + 1, maxUnlockedStep) as WizardStep;
      if (next !== previous) {
        requestAnimationFrame(() => scrollToTop());
      }
      return next;
    });
  }, [maxUnlockedStep, scrollToTop]);

  const handleNext = useCallback(async () => {
    if (activeStep === WizardStep.Upload) {
      if (uploadInProgress) {
        return;
      }

      if (currentJob) {
        setActiveStep((previous) => {
          if (previous === WizardStep.Analyze) {
            return previous;
          }
          requestAnimationFrame(() => scrollToTop());
          return WizardStep.Analyze;
        });
        return;
      }

      const success = await runAnalysis();
      if (success) {
        setActiveStep((previous) => {
          if (previous === WizardStep.Analyze) {
            return previous;
          }
          requestAnimationFrame(() => scrollToTop());
          return WizardStep.Analyze;
        });
      }
      return;
    }

    if (activeStep === WizardStep.Configure) {
      if (!canStartImport || importStarting || importInProgress) {
        return;
      }
      const success = await startImport();
      if (success) {
        requestAnimationFrame(() => scrollToTop());
        setActiveStep(WizardStep.Import);
      }
      return;
    }

    goNext();
  }, [
    activeStep,
    goNext,
    uploadInProgress,
    currentJob,
    runAnalysis,
    scrollToTop,
    canStartImport,
    importStarting,
    importInProgress,
    startImport,
  ]);

  const stepIndicatorLabel = useMemo(
    () =>
      t("testmo.wizard.stepIndicator", {
        step: activeStep + 1,
        total: wizardSteps.length,
      }),
    [activeStep, t, wizardSteps]
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("testmo.intro")}</p>
      </div>

      <WizardProgress
        steps={wizardSteps}
        activeStep={activeStep}
        maxUnlockedStep={maxUnlockedStep}
        onStepSelect={handleStepSelect}
      />

      {activeStep === WizardStep.Upload && (
        <StepSection
          stepNumber={1}
          title={wizardSteps[0]?.label ?? t("testmo.wizard.steps.upload")}
          status={uploadStatus}
          statusLabel={stepStatusLabels[uploadStatus]}
        >
          <form
            className="space-y-4 rounded-md border p-4"
            onSubmit={(event) => event.preventDefault()}
            encType="multipart/form-data"
          >
            <div className="grid gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{t("testmo.fileLabel")}</Label>
                  <div className="flex items-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetSelections}
                      disabled={isProcessing}
                    >
                      {t("testmo.reset")}
                    </Button>
                  </div>
                </div>
                <UploadAttachments
                  key={uploaderKey}
                  compact
                  onFileSelect={handleFilesSelected}
                  disabled={isProcessing}
                  accept="application/json,.json"
                  allowedTypes={["application/json", ".json"]}
                />
                <p className="text-xs text-muted-foreground">
                  {t("testmo.fileHelp")}
                </p>
                {selectedFile && (
                  <div className="text-xs text-muted-foreground">
                    {selectedFile.name}
                  </div>
                )}
                {uploadProgress.state !== "idle" && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{uploadProgressLabel}</span>
                      {uploadProgress.state === "uploading" && (
                        <span>{`${uploadProgress.percent}%`}</span>
                      )}
                      {uploadProgress.state === "analyzing" &&
                        currentJob?.estimatedTimeRemaining && (
                          <span className="flex items-center gap-1">
                            <span className="font-medium">
                              {t("testmo.job.estimatedTimeRemaining")}
                            </span>
                            <DurationDisplay
                              seconds={Number(
                                currentJob.estimatedTimeRemaining
                              )}
                            />
                          </span>
                        )}
                    </div>
                    <Progress
                      value={
                        uploadProgress.state === "uploading"
                          ? uploadProgress.percent
                          : 100
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </form>

          <div className="space-y-3 rounded-md border bg-muted/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">
                  {t("testmo.previousImportsHeading")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("testmo.previousImportsDescription")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefreshJobHistory}
                disabled={jobHistoryLoading}
              >
                {jobHistoryLoading ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner className="h-4 w-4" />
                    {t("testmo.previousImportsRefresh")}
                  </span>
                ) : (
                  t("testmo.previousImportsRefresh")
                )}
              </Button>
            </div>
            {jobHistoryError && (
              <p className="text-xs text-destructive">{jobHistoryError}</p>
            )}
            <Select
              value={selectedExistingJobId}
              onValueChange={handleExistingJobSelect}
              disabled={jobHistoryLoading || jobHistory.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("testmo.previousImportsPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {jobHistory.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {`${formatDateTime(job.createdAt)} · ${job.status} · ${job.originalFileName ?? t("testmo.previousImportsNoFilename")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedJobSummary && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">
                    {t("testmo.previousImportsStatusLabel")}
                  </span>
                  {selectedJobSummary.status}
                </div>
                <div>
                  <span className="font-medium">
                    {t("testmo.previousImportsCreatedLabel")}
                  </span>
                  {formatDateTime(selectedJobSummary.createdAt)}
                </div>
                {selectedJobSummary.originalFileName && (
                  <div>
                    <span className="font-medium">
                      {t("testmo.previousImportsFileLabel")}
                    </span>
                    {selectedJobSummary.originalFileName}
                  </div>
                )}
              </div>
            )}
            {jobHistory.length === 0 &&
              !jobHistoryLoading &&
              !jobHistoryError && (
                <p className="text-xs text-muted-foreground">
                  {t("testmo.previousImportsEmpty")}
                </p>
              )}
          </div>

          {translatedError && (
            <Alert variant="destructive">
              <AlertTitle>
                {(() => {
                  switch (errorKey) {
                    case "file-required":
                      return t("errors.fileRequired");
                    case "presign-failed":
                    case "upload-failed":
                      return t("errors.uploadFailed");
                    default:
                      return t("errors.analysisFailed");
                  }
                })()}
              </AlertTitle>
              <AlertDescription>{translatedError}</AlertDescription>
            </Alert>
          )}
        </StepSection>
      )}

      {activeStep === WizardStep.Analyze && (
        <StepSection
          stepNumber={2}
          title={wizardSteps[1]?.label ?? t("testmo.summaryHeading")}
          status={analyzeStatus}
          statusLabel={stepStatusLabels[analyzeStatus]}
        >
          {pollingError && (
            <Alert variant="destructive">
              <AlertTitle>{t("errors.analysisFailed")}</AlertTitle>
              <AlertDescription>
                {t("errors.analysisFailed")} {"("}
                {pollingError}
                {")"}
              </AlertDescription>
            </Alert>
          )}
          {jobStatusCard}
          {analysisSectionContent}
        </StepSection>
      )}

      {activeStep === WizardStep.Configure && mappingSectionContent && (
        <StepSection
          stepNumber={3}
          title={wizardSteps[2]?.label ?? t("testmo.mappingHeading")}
          status={configureStatus}
          statusLabel={stepStatusLabels[configureStatus]}
        >
          {mappingSectionContent}
        </StepSection>
      )}

      {activeStep === WizardStep.Import && importSectionContent && (
        <StepSection
          stepNumber={4}
          title={wizardSteps[3]?.label ?? t("testmo.wizard.steps.import")}
          status={importStatus}
          statusLabel={stepStatusLabels[importStatus]}
        >
          {jobStatusCard}
          {importSectionContent}
        </StepSection>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {stepIndicatorLabel}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={goPrev}
            disabled={!canGoPrev}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            {tCommon("actions.previous")}
          </Button>
          <Button type="button" onClick={handleNext} disabled={!canGoNext}>
            {activeStep === WizardStep.Upload && uploadInProgress ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner className="h-4 w-4" />
                {tCommon("status.uploading")}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {activeStep === WizardStep.Configure
                  ? t("testmo.startImportButton")
                  : tCommon("actions.next")}
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: ReactNode;
  status?: "warning";
  hint?: ReactNode;
}

function SummaryTile({ label, value, status, hint }: SummaryTileProps) {
  const containerClasses =
    status === "warning"
      ? "rounded-md border bg-card p-4 border-destructive/60 bg-destructive/5"
      : "rounded-md border bg-card p-4";
  const valueClasses =
    status === "warning"
      ? "mt-2 text-lg font-semibold text-destructive"
      : "mt-2 text-lg font-semibold text-foreground";
  const hintClasses =
    status === "warning"
      ? "mt-2 text-xs text-destructive"
      : "mt-2 text-xs text-muted-foreground";

  return (
    <div className={containerClasses}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={valueClasses}>{value}</div>
      {hint ? <div className={hintClasses}>{hint}</div> : null}
    </div>
  );
}

interface StepSectionProps {
  stepNumber: number;
  title: string;
  status: StepStatus;
  statusLabel: string;
  description?: ReactNode;
  children: ReactNode;
}

function StepSection({
  stepNumber,
  title,
  status,
  description,
  children,
}: StepSectionProps) {
  const indicatorClasses = (() => {
    switch (status) {
      case "completed":
        return "bg-primary text-primary-foreground";
      case "active":
        return "border-2 border-primary text-primary bg-background";
      default:
        return "bg-muted text-muted-foreground";
    }
  })();

  return (
    <section
      className={`space-y-4 rounded-md border p-4 ${
        status === "active"
          ? "border-primary shadow-sm"
          : status === "completed"
            ? "bg-muted/40"
            : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${indicatorClasses}`}
          >
            {status === "completed" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              stepNumber
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface WizardProgressProps {
  steps: WizardStepDefinition[];
  activeStep: WizardStep;
  maxUnlockedStep: WizardStep;
  onStepSelect?: (step: WizardStep) => void;
}

function WizardProgress({
  steps,
  activeStep,
  maxUnlockedStep,
  onStepSelect,
}: WizardProgressProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {steps.map((step, index) => {
        const status: StepStatus =
          step.id === activeStep
            ? "active"
            : step.id < maxUnlockedStep
              ? "completed"
              : "pending";
        const Icon = step.icon;
        const isEnabled = step.id <= maxUnlockedStep;
        const indicatorClasses =
          status === "completed"
            ? "bg-muted-foreground/60 text-primary-foreground"
            : status === "active"
              ? "border-2 border-primary text-primary bg-background ring-offset-1 ring-offset-primary ring-1 ring-primary"
              : "bg-muted border-2 border-muted-foreground/20 text-muted-foreground";
        return (
          <div key={step.id} className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => isEnabled && onStepSelect?.(step.id)}
              disabled={!isEnabled}
              className={`flex items-center gap-2 border border-primary/60 shadow-md rounded-full py-6 text-sm font-medium transition ${
                isEnabled
                  ? "cursor-pointer text-foreground hover:bg-muted "
                  : "cursor-not-allowed text-muted-foreground border-muted-foreground/20"
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full ${indicatorClasses}`}
              >
                {status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </span>
              <span
                className={
                  status === "pending"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }
              >
                {step.label}
              </span>
            </Button>
            {index < steps.length - 1 && (
              <div
                className={`hidden h-px w-12 sm:block ${
                  step.id < maxUnlockedStep
                    ? "bg-primary animate-pulse"
                    : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
