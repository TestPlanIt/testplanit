"use client";

import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AsyncCombobox } from "@/components/ui/async-combobox";
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  History,
  Loader2,
  Plus,
  RefreshCw,
  ScanSearch,
  Trash,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";
import { useIssueScan } from "~/hooks/useIssueScan";
import { useRepoCacheRefresh } from "~/hooks/useRepoCacheRefresh";
import { useRepoPreviewFiles } from "~/hooks/useRepoPreviewFiles";
import type { RepoBranch } from "~/lib/integrations/adapters/GitRepoAdapter";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";
import { isIssueScanStale, readIssueScanReport } from "./issueScanReport";
import { readMarkerScanReport } from "./markerScanReport";

export interface CodeRepositoryOption {
  id: number;
  name: string;
  provider: string;
}

/** One IMPACT row of ProjectCodeRepositoryConfig with its repository. */
export interface ImpactConfigRow {
  id: number;
  repositoryId: number;
  branch: string | null;
  pathPatterns: unknown;
  cacheEnabled: boolean;
  cacheTtlDays: number;
  cacheStatus: string | null;
  cacheLastFetchedAt: Date | string | null;
  cacheFileCount: number | null;
  cacheContentFileCount: number | null;
  cacheTotalSize: bigint | number | string | null;
  cacheError: string | null;
  markerScanReport: unknown;
  issueScanEnabled: boolean;
  issueScanReport: unknown;
  repository: CodeRepositoryOption;
}

export interface DatePreferences {
  dateFormat?: string | null;
  timeFormat?: string | null;
  timezone?: string | null;
}

/** `name === ""` selects the repository's default branch. */
interface BranchOption {
  name: string;
}

const DEFAULT_BRANCH_OPTION: BranchOption = { name: "" };
const DEFAULT_BRANCH_VALUE = "*";
const DEFAULT_PATH_PATTERNS = [{ path: "src", pattern: "**/*" }];
const DEFAULT_DATE_FORMAT = "MM-dd-yyyy";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ImpactRepositoryFormMode = "add" | "edit" | "view";

interface ImpactRepositoryFormProps {
  projectId: number;
  /** The connection being shown or edited, or null to connect a new repository. */
  config: ImpactConfigRow | null;
  /** `view` shows the connection read-only; the operational buttons still work. */
  mode: ImpactRepositoryFormMode;
  /** The `<form>` id, so a dialog footer can submit it. */
  formId: string;
  /** Every active registered repository. */
  repositories: CodeRepositoryOption[];
  /** Repositories already connected to this project for Impact. */
  connectedRepositoryIds: number[];
  preferences?: DatePreferences | null;
  refetchConfigs: () => Promise<{ data?: ImpactConfigRow[] | null }>;
  /** Called with the saved row's id after a create or update. */
  onSaved: (configId: number) => void;
}

/**
 * The connection form for one Impact repository: repository and branch, path
 * patterns, cache, linked tickets and repository markers. Saving a connection
 * whose files were never fetched starts the first cache refresh, which also
 * runs the marker and linked-ticket scans the feature depends on.
 */
export function ImpactRepositoryForm({
  projectId,
  config,
  mode,
  formId,
  repositories,
  connectedRepositoryIds,
  preferences,
  refetchConfigs,
  onSaved,
}: ImpactRepositoryFormProps) {
  const t = useTranslations("projects.settings.impact");
  const tCommon = useTranslations("common");
  const tAutomation = useTranslations("automation.settings");
  const tRepo = useTranslations("projects.settings.codeRepository");
  // "Cancel Scan" is the duplicate-scan button's string; reused, not copied.
  const tDuplicates = useTranslations("repository.duplicates");
  const locale = useLocale();
  const existingConfig = config;
  const readOnly = mode === "view";

  const pathPatternSchema = z.object({
    path: z.string().min(1, tRepo("validation.pathRequired")),
    pattern: z.string().min(1, tRepo("validation.patternRequired")),
  });

  const formSchema = z.object({
    repositoryId: z.string().min(1, tRepo("validation.repositoryRequired")),
    branch: z.string().optional().default(""),
    pathPatterns: z
      .array(pathPatternSchema)
      .min(1, tRepo("validation.pathPatternRequired")),
    cacheEnabled: z.boolean().default(true),
    cacheTtlDays: z.number().int().min(1).max(30).default(7),
    issueScanEnabled: z.boolean().default(true),
  });

  type FormData = z.infer<typeof formSchema>;

  const defaultFormValues: FormData = {
    repositoryId: "",
    branch: "",
    pathPatterns: DEFAULT_PATH_PATTERNS,
    cacheEnabled: true,
    cacheTtlDays: 7,
    issueScanEnabled: true,
  };

  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [defaultBranchName, setDefaultBranchName] = useState<string | null>(
    null
  );
  const branchListRef = useRef<{ key: string; branches: RepoBranch[] } | null>(
    null
  );
  // The row a running refresh polls; set before the refresh starts so a
  // just-created connection is found in the list.
  const activeConfigIdRef = useRef<number | null>(existingConfig?.id ?? null);
  useEffect(() => {
    if (existingConfig) activeConfigIdRef.current = existingConfig.id;
  }, [existingConfig]);

  // A repository can be connected once per project; the one being edited
  // stays selectable.
  const selectableRepositories = repositories.filter(
    (repo) =>
      repo.id === existingConfig?.repositoryId ||
      !connectedRepositoryIds.includes(repo.id)
  );

  const createConfig =
    useClientQueries(schema).projectCodeRepositoryConfig.useCreate();
  const updateConfig =
    useClientQueries(schema).projectCodeRepositoryConfig.useUpdate();

  const refetchConfig = useCallback(async () => {
    const result = await refetchConfigs();
    const row =
      result.data?.find((item) => item.id === activeConfigIdRef.current) ??
      null;
    return { data: row };
  }, [refetchConfigs]);

  const { isPreviewing, preview, previewProgress, runPreview } =
    useRepoPreviewFiles({ networkErrorMessage: tRepo("networkError") });

  const { isRefreshing, refreshStep, refreshError, refreshCache } =
    useRepoCacheRefresh({
      refetchConfig,
      messages: {
        pending: tRepo("cache.statusPending"),
        listingFiles: tRepo("cache.listingFiles"),
        cachingFiles: (count) =>
          tRepo("cache.cachingFiles", { count: String(count) }),
        contentsError: tRepo("contentsError"),
        networkError: tRepo("networkError"),
        refreshComplete: (fileCount) =>
          tRepo("refreshComplete", { fileCount: String(fileCount) }),
        refreshInProgress: tRepo("refreshInProgress"),
      },
    });

  const {
    isScanning,
    isFollowing,
    scanError,
    startScan,
    cancelScan,
    followScan,
  } = useIssueScan({
    refetchConfig,
    messages: {
      started: t("tickets.scanStarted"),
      cancelRequested: t("tickets.cancelRequested"),
      stillRunning: t("tickets.scanStillRunning"),
      failedToStart: t("tickets.scanFailedToStart"),
      networkError: tRepo("networkError"),
    },
  });

  const [requestedFull, setRequestedFull] = useState<boolean | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const handleCancelScan = async () => {
    if (!existingConfig) return;
    setCancelling(true);
    try {
      await cancelScan({
        repositoryId: existingConfig.repositoryId,
        configId: existingConfig.id,
      });
    } finally {
      setCancelling(false);
    }
  };
  const handleScan = (full: boolean) => {
    if (!existingConfig) return;
    activeConfigIdRef.current = existingConfig.id;
    setRequestedFull(full);
    void startScan({
      repositoryId: existingConfig.repositoryId,
      configId: existingConfig.id,
      full,
    });
  };

  const form = useForm<FormData>({
    resolver: standardSchemaResolver(formSchema) as any,
    defaultValues: defaultFormValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control as any,
    name: "pathPatterns",
  });

  useEffect(() => {
    if (existingConfig) {
      form.reset({
        repositoryId: String(existingConfig.repositoryId),
        branch: existingConfig.branch ?? "",
        pathPatterns: (existingConfig.pathPatterns as {
          path: string;
          pattern: string;
        }[]) ?? [{ path: "", pattern: "**/*" }],
        cacheEnabled: existingConfig.cacheEnabled ?? true,
        cacheTtlDays: existingConfig.cacheTtlDays ?? 7,
        issueScanEnabled: existingConfig.issueScanEnabled ?? true,
      });
    }
  }, [existingConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRepositoryId = form.watch("repositoryId");
  const cacheEnabled = form.watch("cacheEnabled");

  const branchesConfigId =
    existingConfig &&
    String(existingConfig.repositoryId) === selectedRepositoryId
      ? existingConfig.id
      : null;
  const branchesFetchFailed = tCommon("errors.fetchFailed");

  const fetchBranchOptions = useCallback<AsyncOptionsFetcher<BranchOption>>(
    async (query) => {
      if (branchesConfigId == null) return { results: [], total: 0 };
      const key = `${selectedRepositoryId}:${branchesConfigId}`;
      let branches =
        branchListRef.current?.key === key
          ? branchListRef.current.branches
          : null;

      if (!branches) {
        try {
          const res = await fetch(
            `/api/code-repositories/${selectedRepositoryId}/branches?configId=${branchesConfigId}`
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.error) {
            setBranchesError(data.error ?? branchesFetchFailed);
            return { results: [], total: 0 };
          }
          branches = (data.branches as RepoBranch[] | undefined) ?? [];
          branchListRef.current = { key, branches };
          setDefaultBranchName(data.defaultBranch ?? null);
        } catch (err) {
          setBranchesError(
            err instanceof Error ? err.message : branchesFetchFailed
          );
          return { results: [], total: 0 };
        }
      }

      const needle = query.trim().toLowerCase();
      const matches = branches
        .filter((b) => !needle || b.name.toLowerCase().includes(needle))
        .map((b) => ({ name: b.name }));
      const results = needle ? matches : [DEFAULT_BRANCH_OPTION, ...matches];
      return { results, total: results.length };
    },
    [branchesConfigId, selectedRepositoryId, branchesFetchFailed]
  );

  const renderBranchOption = (option: BranchOption) =>
    option.name === "" ? (
      <span className="flex items-center gap-2">
        <span>{tAutomation("defaultRefDefault")}</span>
        {defaultBranchName && (
          <span className="font-mono text-xs text-muted-foreground">
            {defaultBranchName}
          </span>
        )}
      </span>
    ) : (
      <span className="font-mono text-sm">{option.name}</span>
    );

  const handlePreview = () => {
    const values = form.getValues();
    if (!values.repositoryId) return;
    void runPreview(values.repositoryId, {
      branch: values.branch || undefined,
      pathPatterns: values.pathPatterns,
      cacheEnabled: values.cacheEnabled,
    });
  };

  const handleRefreshCache = () => {
    if (!existingConfig) return;
    activeConfigIdRef.current = existingConfig.id;
    void refreshCache({
      repositoryId: existingConfig.repositoryId,
      configId: existingConfig.id,
    });
  };

  const onSubmit = async (values: FormData) => {
    if (readOnly || createConfig.isPending || updateConfig.isPending) return;
    try {
      const repositoryId = parseInt(values.repositoryId);

      const cacheContentChanged =
        !existingConfig ||
        existingConfig.repositoryId !== repositoryId ||
        existingConfig.branch !== (values.branch || null) ||
        JSON.stringify(existingConfig.pathPatterns) !==
          JSON.stringify(values.pathPatterns);

      const cacheResetFields = cacheContentChanged
        ? {
            cacheStatus: null,
            cacheLastFetchedAt: null,
            cacheFileCount: null,
            cacheTotalSize: null,
            cacheError: null,
          }
        : {};

      const sharedData = {
        branch: values.branch || null,
        pathPatterns: values.pathPatterns,
        cacheEnabled: values.cacheEnabled,
        cacheTtlDays: values.cacheTtlDays,
        issueScanEnabled: values.issueScanEnabled,
        ...cacheResetFields,
      };

      let savedId: number;
      if (existingConfig) {
        await updateConfig.mutateAsync({
          where: { id: existingConfig.id },
          data: {
            ...sharedData,
            repository: { connect: { id: repositoryId } },
          },
        });
        savedId = existingConfig.id;
      } else {
        const created = await createConfig.mutateAsync({
          data: {
            ...sharedData,
            purpose: "IMPACT",
            repository: { connect: { id: repositoryId } },
            project: { connect: { id: projectId } },
          },
        });
        savedId = created.id;
      }

      // Nothing was fetched for this connection yet (new, re-pointed, or
      // never refreshed): fetch the files now so markers and linked tickets
      // are scanned and the feature has something to work with.
      const needsInitialScan =
        values.cacheEnabled &&
        (cacheContentChanged || existingConfig?.cacheStatus == null);

      branchListRef.current = null;
      setBranchesError(null);
      toast.success(t("saved"));
      // The list must hold the row before the page switches this form to it,
      // or the form is unmounted and the refresh below reports into nothing.
      await refetchConfigs();
      onSaved(savedId);
      if (needsInitialScan) {
        activeConfigIdRef.current = savedId;
        toast.info(t("initialScanStarted"));
        void refreshCache({ repositoryId, configId: savedId });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : tRepo("saveError");
      toast.error(message);
    }
  };

  const preferredDateTimeFormat =
    preferences?.dateFormat && preferences?.timeFormat
      ? `${preferences.dateFormat} ${preferences.timeFormat}`
      : (preferences?.dateFormat ?? undefined);

  const formatScanDate = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const formatString = mapDateTimeFormatString(
      preferredDateTimeFormat ?? DEFAULT_DATE_FORMAT
    );
    const dateLocale = getDateFnsLocale(locale);
    const timezone = preferences?.timezone;
    try {
      return timezone
        ? formatInTimeZone(date, timezone.replace(/_/g, "/"), formatString, {
            locale: dateLocale,
          })
        : format(date, formatString, { locale: dateLocale });
    } catch {
      return format(date, formatString, { locale: dateLocale });
    }
  };

  const configData = existingConfig;
  const markerView = readMarkerScanReport(existingConfig?.markerScanReport);
  const issueView = readIssueScanReport(existingConfig?.issueScanReport);
  const scanRunning = issueView.kind === "running";
  const scanStale =
    issueView.kind === "running" && isIssueScanStale(issueView.progress);
  // Which button's scan is in flight: the report knows once the worker has
  // written it; until then, the one that was clicked.
  const activeScanFull: boolean | null =
    issueView.kind === "running" && !scanStale
      ? issueView.progress.full
      : isScanning
        ? requestedFull
        : null;

  // A scan queued elsewhere (or before a reload) is followed the same way,
  // unless its flag is old enough to be a leftover nobody will clear.
  const followedRef = useRef(false);
  useEffect(() => {
    if (
      scanRunning &&
      !scanStale &&
      !isScanning &&
      !isFollowing &&
      !followedRef.current
    ) {
      followedRef.current = true;
      void followScan().finally(() => {
        followedRef.current = false;
      });
    }
  }, [scanRunning, scanStale, isScanning, isFollowing, followScan]);

  return (
    <Form {...(form as any)}>
      <form
        id={formId}
        onSubmit={(form as any).handleSubmit(onSubmit)}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>{t("repository.title")}</CardTitle>
            <CardDescription>{t("repository.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control as any}
              name="repositoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("repository.title")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={readOnly}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="impact-repository-select">
                        <SelectValue
                          placeholder={tRepo("repository.placeholder")}
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectableRepositories.map((repo) => (
                        <SelectItem key={repo.id} value={String(repo.id)}>
                          <CodeRepositoryName
                            name={repo.name}
                            provider={repo.provider}
                          />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control as any}
              name="branch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tRepo("repository.branchLabel")}</FormLabel>
                  {branchesConfigId != null && !branchesError ? (
                    <div data-testid="impact-branch-combobox">
                      <AsyncCombobox<BranchOption>
                        value={{ name: field.value ?? "" }}
                        onValueChange={(option) =>
                          field.onChange(option?.name ?? "")
                        }
                        fetchOptions={fetchBranchOptions}
                        renderOption={renderBranchOption}
                        getOptionValue={(option) =>
                          option.name || DEFAULT_BRANCH_VALUE
                        }
                        placeholder={t("repository.branchPlaceholder")}
                        ariaLabel={tRepo("repository.branchLabel")}
                        className="w-full"
                        showPagination={false}
                        disabled={readOnly}
                      />
                    </div>
                  ) : (
                    <>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("repository.branchInputPlaceholder")}
                          data-testid="impact-branch-input"
                          disabled={readOnly}
                        />
                      </FormControl>
                      {branchesError && (
                        <p className="text-xs text-muted-foreground">
                          {t("repository.branchesUnavailable", {
                            error: branchesError,
                          })}{" "}
                          {t("repository.branchesFallbackHint")}
                        </p>
                      )}
                    </>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tRepo("pathPatterns.title")}</CardTitle>
            <CardDescription>{t("pathPatterns.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-start gap-2">
                <FormField
                  control={form.control as any}
                  name={`pathPatterns.${index}.path`}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      {index === 0 && (
                        <FormLabel>{tRepo("pathPatterns.pathLabel")}</FormLabel>
                      )}
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("pathPatterns.pathPlaceholder")}
                          data-testid={`impact-path-${index}`}
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name={`pathPatterns.${index}.pattern`}
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      {index === 0 && (
                        <FormLabel>
                          {tRepo("pathPatterns.patternLabel")}
                        </FormLabel>
                      )}
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="**/*"
                          data-testid={`impact-pattern-${index}`}
                          disabled={readOnly}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={index === 0 ? "mt-8" : ""}
                  onClick={() => remove(index)}
                  disabled={readOnly || fields.length === 1}
                  aria-label={tCommon("actions.delete")}
                >
                  <Trash className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ path: "", pattern: "**/*" })}
                data-testid="impact-add-path"
              >
                <Plus className="h-4 w-4" />
                {tRepo("pathPatterns.addPath")}
              </Button>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePreview}
                disabled={isPreviewing || !selectedRepositoryId}
                data-testid="impact-preview-button"
              >
                {isPreviewing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                {tRepo("pathPatterns.previewFiles")}
              </Button>
              {isPreviewing && previewProgress && (
                <span className="text-sm text-muted-foreground">
                  {previewProgress.step === "branch" &&
                    tRepo("preview.resolvingBranch")}
                  {previewProgress.step === "listing" &&
                    (previewProgress.filesFound != null
                      ? tRepo("preview.scanningFilesCount", {
                          count: previewProgress.filesFound,
                          scope: previewProgress.scope ?? "",
                        })
                      : tRepo("preview.scanningFiles", {
                          scope: previewProgress.scope ?? "",
                        }))}
                  {previewProgress.step === "filtering" &&
                    tRepo("preview.filtering", {
                      count: previewProgress.totalFiles ?? 0,
                    })}
                  {previewProgress.step === "rate-limited" &&
                    tRepo("preview.rateLimited", {
                      seconds: previewProgress.waitSeconds ?? 0,
                    })}
                </span>
              )}
            </div>

            {preview && !preview.error && (
              <div className="space-y-3">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>
                    {tRepo("pathPatterns.files", {
                      count: preview.fileCount,
                    })}
                  </span>
                  <span>{preview.totalSizeFormatted}</span>
                  {preview.truncated && (
                    <Badge variant="secondary">
                      {tRepo("pathPatterns.truncatedBadge")}
                    </Badge>
                  )}
                </div>

                <ScrollArea className="h-48 rounded-md border p-3">
                  <div className="space-y-1">
                    {preview.files.map((f) => (
                      <div
                        key={f.path}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {f.path}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {preview?.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{preview.error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tRepo("cache.title")}</CardTitle>
            <CardDescription>{t("cache.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control as any}
              name="cacheEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readOnly}
                      data-testid="impact-cache-enabled"
                    />
                  </FormControl>
                  <FormLabel className="font-medium">
                    {tRepo("cache.enableLabel")}
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <div
                aria-hidden={cacheEnabled}
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                  !cacheEnabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <Alert>
                    <AlertDescription>
                      {t("cache.disabledWarning")}
                    </AlertDescription>
                  </Alert>
                </div>
              </div>

              <div
                aria-hidden={!cacheEnabled}
                className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                  cacheEnabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-4">
                    <FormField
                      control={form.control as any}
                      name="cacheTtlDays"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center gap-2 text-sm">
                            <FormLabel className="font-normal">
                              {tRepo("cache.ttlBefore")}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min={1}
                                max={30}
                                disabled={readOnly}
                                className="w-16"
                                aria-label={tRepo("cache.ttlAriaLabel")}
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value) || 7)
                                }
                              />
                            </FormControl>
                            <span>
                              {tRepo("cache.ttlDays", {
                                count: field.value,
                              })}
                            </span>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {configData && (
                      <>
                        <Separator />
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">
                              {tRepo("cache.statusTitle")}
                            </h4>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleRefreshCache}
                              disabled={isRefreshing}
                              data-testid="impact-refresh-cache"
                            >
                              {isRefreshing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                              {isRefreshing && refreshStep
                                ? refreshStep
                                : tRepo("cache.refreshButton")}
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <span className="text-muted-foreground">
                                {tCommon("actions.status")}
                              </span>
                              <div className="mt-1 flex items-center gap-2">
                                {!configData.cacheStatus && (
                                  <Badge variant="secondary">
                                    {tRepo("cache.statusNeverFetched")}
                                  </Badge>
                                )}
                                {configData.cacheStatus === "success" && (
                                  <>
                                    <CheckCircle className="h-4 w-4 text-success" />
                                    <Badge variant="default">
                                      {tCommon("fields.success")}
                                    </Badge>
                                  </>
                                )}
                                {configData.cacheStatus === "error" && (
                                  <>
                                    <XCircle className="h-4 w-4 text-destructive" />
                                    <Badge variant="destructive">
                                      {tCommon("errors.error")}
                                    </Badge>
                                  </>
                                )}
                                {configData.cacheStatus === "pending" && (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <Badge variant="secondary">
                                      {tRepo("cache.statusPending")}
                                    </Badge>
                                  </>
                                )}
                              </div>
                            </div>

                            <div>
                              <span className="text-muted-foreground">
                                {tRepo("cache.lastFetched")}
                              </span>
                              <div className="mt-1">
                                {configData.cacheLastFetchedAt ? (
                                  <DateFormatter
                                    date={
                                      new Date(configData.cacheLastFetchedAt)
                                    }
                                    formatString={preferredDateTimeFormat}
                                    timezone={preferences?.timezone}
                                  />
                                ) : (
                                  "—"
                                )}
                              </div>
                            </div>

                            <div>
                              <span className="text-muted-foreground">
                                {tRepo("cache.filesCached")}
                              </span>
                              <div className="mt-1">
                                {configData.cacheFileCount ?? "—"}
                              </div>
                            </div>

                            <div>
                              <span className="text-muted-foreground">
                                {tRepo("cache.contentsCached")}
                              </span>
                              <div className="mt-1">
                                {configData.cacheContentFileCount ?? "—"}
                              </div>
                            </div>

                            <div>
                              <span className="text-muted-foreground">
                                {tRepo("cache.totalSize")}
                              </span>
                              <div className="mt-1">
                                {configData.cacheTotalSize != null
                                  ? formatBytes(
                                      Number(configData.cacheTotalSize)
                                    )
                                  : "—"}
                              </div>
                            </div>
                          </div>

                          {configData.cacheStatus === "error" &&
                            configData.cacheError && (
                              <Alert variant="destructive">
                                <XCircle className="h-4 w-4" />
                                <AlertDescription>
                                  {configData.cacheError}
                                </AlertDescription>
                              </Alert>
                            )}

                          {configData.cacheStatus === "success" &&
                            configData.cacheContentFileCount != null &&
                            configData.cacheFileCount != null &&
                            configData.cacheContentFileCount <
                              configData.cacheFileCount && (
                              <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>
                                  {t("cache.contentsIncomplete", {
                                    cached: String(
                                      configData.cacheContentFileCount
                                    ),
                                    total: String(configData.cacheFileCount),
                                  })}
                                </AlertDescription>
                              </Alert>
                            )}

                          {refreshError && (
                            <Alert variant="destructive">
                              <AlertDescription className="flex items-center gap-2 font-mono text-xs break-all select-all">
                                <XCircle className="h-4 w-4 shrink-0" />
                                {refreshError}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>{t("tickets.title")}</CardTitle>
              {existingConfig && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleScan(false)}
                    disabled={isScanning}
                    data-testid="impact-issue-scan-recent"
                  >
                    {activeScanFull === false ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ScanSearch className="h-4 w-4" />
                    )}
                    {t("tickets.scanRecent")}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleScan(true)}
                        disabled={isScanning}
                        data-testid="impact-issue-scan-full"
                      >
                        {activeScanFull === true ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <History className="h-4 w-4" />
                        )}
                        {t("tickets.scanFull")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("tickets.scanFullHint")}</TooltipContent>
                  </Tooltip>
                  {scanRunning && !scanStale && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={handleCancelScan}
                      disabled={cancelling}
                      data-testid="impact-issue-scan-cancel"
                    >
                      {cancelling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      {tDuplicates("cancelScan")}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <CardDescription>{t("tickets.description")}</CardDescription>
          </CardHeader>
          <CardContent
            className="space-y-3 text-sm"
            data-testid="impact-tickets"
          >
            <FormField
              control={form.control as any}
              name="issueScanEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={readOnly}
                      data-testid="impact-issue-scan-enabled"
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="font-medium">
                      {t("tickets.enableLabel")}
                    </FormLabel>
                    <p className="text-muted-foreground">
                      {t("tickets.enableDescription")}
                    </p>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {scanError && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{scanError}</AlertDescription>
              </Alert>
            )}

            {issueView.kind === "never" && (
              <Badge variant="secondary">{t("scanNever")}</Badge>
            )}

            {issueView.kind === "running" && scanStale && (
              <Alert data-testid="impact-issue-scan-stale">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t("tickets.stale", {
                    date: issueView.progress.startedAt
                      ? formatScanDate(issueView.progress.startedAt)
                      : "",
                  })}
                </AlertDescription>
              </Alert>
            )}

            {issueView.kind === "running" && !scanStale && (
              <div
                className="flex items-center gap-2"
                data-testid="impact-issue-scan-progress"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {t(
                    issueView.progress.full
                      ? "tickets.runningFull"
                      : "tickets.runningRecent"
                  )}
                </span>
                <span className="text-muted-foreground">
                  {issueView.progress.stage === "walk" &&
                    t("tickets.runningWalk", {
                      commits: issueView.progress.scannedCommits,
                      cached: issueView.progress.cachedCommits,
                    })}
                  {issueView.progress.stage === "import" &&
                    t("tickets.runningImport", {
                      commits: issueView.progress.scannedCommits,
                      lookups: issueView.progress.importLookups,
                      imported: issueView.progress.importedIssues,
                    })}
                  {issueView.progress.stage === "inspect" &&
                    t("tickets.runningProgress", {
                      commits: issueView.progress.scannedCommits,
                      matched: issueView.progress.matchedCommits,
                      fetched: issueView.progress.fetchedCommits,
                    })}
                </span>
              </div>
            )}

            {issueView.kind === "error" && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("scanError", { error: issueView.error })}
                </AlertDescription>
              </Alert>
            )}

            {issueView.kind === "cancelled" && (
              <p
                className="flex items-center gap-2 text-muted-foreground"
                data-testid="impact-issue-scan-cancelled"
              >
                <XCircle className="h-4 w-4" />
                {t("tickets.cancelled", {
                  date: issueView.scannedAt
                    ? formatScanDate(issueView.scannedAt)
                    : "",
                })}
              </p>
            )}

            {issueView.kind === "scanned" && (
              <>
                <p className="flex items-center gap-2 text-muted-foreground">
                  {t("scanLastScan", {
                    date: formatScanDate(issueView.report.scannedAt),
                  })}
                  {issueView.report.full && (
                    <Badge
                      variant="outline"
                      data-testid="impact-issue-scan-full-badge"
                    >
                      {t("tickets.fullBadge")}
                    </Badge>
                  )}
                </p>
                <p data-testid="impact-issue-scan-summary">
                  {issueView.namingCountsKnown
                    ? t("tickets.summaryCommits", {
                        commits: issueView.report.scannedCommits,
                        cached: issueView.report.cachedCommits,
                        naming: issueView.report.commitsNamingTickets,
                        tickets: issueView.report.namedTickets,
                      })
                    : t("tickets.summaryCommitsOnly", {
                        commits: issueView.report.scannedCommits,
                      })}
                </p>
                <p data-testid="impact-issue-scan-matched">
                  {t("tickets.summaryMatched", {
                    matched: issueView.report.matchedCommits,
                  })}
                </p>
                <p data-testid="impact-issue-scan-pins">
                  {t("tickets.summaryPins", {
                    created: issueView.report.created,
                    updated: issueView.report.updated,
                    removed: issueView.report.removed,
                  })}
                  {issueView.report.createdSymbolPins > 0 && (
                    <>
                      {" "}
                      {t("tickets.summarySymbolPins", {
                        count: issueView.report.createdSymbolPins,
                      })}
                    </>
                  )}
                </p>
                {issueView.report.matchedCommits === 0 &&
                  (issueView.report.commitsNamingTickets > 0 ||
                    issueView.report.importedIssues > 0 ||
                    issueView.report.importFailures > 0) && (
                    <p
                      className="flex items-center gap-2 text-muted-foreground"
                      data-testid="impact-issue-scan-unlinked-hint"
                    >
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      {t("tickets.noLinkedHint")}
                    </p>
                  )}
                {(issueView.report.importedIssues > 0 ||
                  issueView.report.importFailures > 0 ||
                  issueView.report.importSkipped > 0 ||
                  issueView.report.importMoved > 0) && (
                  <div
                    className="space-y-1"
                    data-testid="impact-issue-scan-imported"
                  >
                    <p>
                      {t("tickets.imported", {
                        imported: issueView.report.importedIssues,
                      })}
                    </p>
                    {issueView.report.importFailures > 0 && (
                      <p>
                        {t("tickets.importFailed", {
                          failed: issueView.report.importFailures,
                        })}
                      </p>
                    )}
                    {issueView.report.importMoved > 0 && (
                      <p>
                        {t("tickets.importMoved", {
                          moved: issueView.report.importMoved,
                        })}
                      </p>
                    )}
                    {issueView.report.importSkipped > 0 && (
                      <p>
                        {t("tickets.importSkipped", {
                          skipped: issueView.report.importSkipped,
                        })}
                      </p>
                    )}
                  </div>
                )}
                {issueView.report.importFailureDetails.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-muted-foreground">
                      {t("tickets.importFailuresTitle", {
                        shown: issueView.report.importFailureDetails.length,
                        total: issueView.report.importFailures,
                      })}
                    </p>
                    <ul
                      className="list-disc ps-5 font-mono text-xs text-muted-foreground"
                      data-testid="impact-issue-scan-import-failures"
                    >
                      {issueView.report.importFailureDetails.map((item) => (
                        <li key={item.key}>
                          {item.key}
                          {": "}
                          {item.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {issueView.report.skippedLargeCommits > 0 && (
                  <p className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    {t("tickets.skippedLarge", {
                      count: issueView.report.skippedLargeCommits,
                    })}
                  </p>
                )}
                {issueView.report.truncated && (
                  <p
                    className="flex items-center gap-2"
                    data-testid="impact-issue-scan-truncated"
                  >
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    {t(
                      issueView.report.full
                        ? "tickets.fullCapped"
                        : "tickets.windowCapped",
                      { count: issueView.report.scannedCommits }
                    )}
                  </p>
                )}
                {issueView.report.fetchCapped && (
                  <p className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    {t("tickets.fetchCapped")}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("markers.title")}</CardTitle>
            <CardDescription>{t("markers.description")}</CardDescription>
          </CardHeader>
          <CardContent
            className="space-y-3 text-sm"
            data-testid="impact-markers"
          >
            {markerView.kind === "never" && (
              <Badge variant="secondary">{t("scanNever")}</Badge>
            )}

            {markerView.kind === "skipped" && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t(
                    markerView.reason === "privacy_mode"
                      ? "markers.skippedPrivacy"
                      : "markers.skippedPartial"
                  )}
                </AlertDescription>
              </Alert>
            )}

            {markerView.kind === "error" && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("scanError", { error: markerView.error })}
                </AlertDescription>
              </Alert>
            )}

            {markerView.kind === "scanned" && (
              <>
                <p className="text-muted-foreground">
                  {t("scanLastScan", {
                    date: formatScanDate(markerView.report.scannedAt),
                  })}
                </p>
                <p>
                  {t("markers.summary", {
                    annotations: markerView.report.annotationMarkers,
                    mapEntries: markerView.report.mapEntries,
                    created: markerView.report.created,
                    updated: markerView.report.updated,
                    removed: markerView.report.removed,
                  })}
                </p>
                {markerView.report.problemCount > 0 && (
                  <div className="space-y-1">
                    <p className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      {t("markers.problems", {
                        count: markerView.report.problemCount,
                      })}
                    </p>
                    <ul className="list-disc ps-5 font-mono text-xs text-muted-foreground">
                      {markerView.problemDetails.map((detail, index) => (
                        <li key={`${index}-${detail}`}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
