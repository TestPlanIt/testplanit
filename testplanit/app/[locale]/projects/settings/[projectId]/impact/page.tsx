"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash,
  Unlink,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod/v4";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRepoCacheRefresh } from "~/hooks/useRepoCacheRefresh";
import { useRepoPreviewFiles } from "~/hooks/useRepoPreviewFiles";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import type { RepoBranch } from "~/lib/integrations/adapters/GitRepoAdapter";
import { Link } from "~/lib/navigation";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";
import { ApplicationArea } from "~/zenstack/models";
import { readMarkerScanReport } from "./markerScanReport";

interface CodeRepository {
  id: number;
  name: string;
  provider: string;
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
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function ImpactSettingsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("projects.settings.impact");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const pathPatternSchema = z.object({
    path: z.string().min(1, t("validation.pathRequired")),
    pattern: z.string().min(1, t("validation.patternRequired")),
  });

  const formSchema = z.object({
    repositoryId: z.string().min(1, t("validation.repositoryRequired")),
    branch: z.string().optional().default(""),
    pathPatterns: z
      .array(pathPatternSchema)
      .min(1, t("validation.pathPatternRequired")),
    cacheEnabled: z.boolean().default(true),
    cacheTtlDays: z.number().int().min(1).max(30).default(7),
  });

  type FormData = z.infer<typeof formSchema>;

  const defaultFormValues: FormData = {
    repositoryId: "",
    branch: "",
    pathPatterns: DEFAULT_PATH_PATTERNS,
    cacheEnabled: true,
    cacheTtlDays: 7,
  };

  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [defaultBranchName, setDefaultBranchName] = useState<string | null>(
    null
  );
  const branchListRef = useRef<{ key: string; branches: RepoBranch[] } | null>(
    null
  );

  const { data: existingConfig, refetch: refetchConfig } = useClientQueries(
    schema
  ).projectCodeRepositoryConfig.useFindFirst({
    where: { projectId, purpose: "IMPACT" },
    include: {
      repository: {
        select: { id: true, name: true, provider: true },
      },
    },
  });

  const { data: pinCount } = useClientQueries(
    schema
  ).repositoryCaseCodePin.useCount(
    { where: { configId: existingConfig?.id ?? 0, isDeleted: false } },
    { enabled: !!existingConfig }
  );

  const { data: repositories, isLoading: repositoriesLoading } =
    useClientQueries(schema).codeRepository.useFindMany({
      where: { isDeleted: false, status: "ACTIVE" },
      select: { id: true, name: true, provider: true },
    });

  const createConfig =
    useClientQueries(schema).projectCodeRepositoryConfig.useCreate();
  const updateConfig =
    useClientQueries(schema).projectCodeRepositoryConfig.useUpdate();
  const deleteConfig =
    useClientQueries(schema).projectCodeRepositoryConfig.useDelete();

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        impactEnabled: true,
      },
    },
    {
      enabled: status === "authenticated",
      retry: 3,
      retryDelay: 1000,
    }
  );
  const updateProject = useClientQueries(schema).projects.useUpdate();

  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;

    if (!project || !isProjectAdmin) {
      notFound();
    }
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  const { isPreviewing, preview, previewProgress, runPreview, clearPreview } =
    useRepoPreviewFiles({ networkErrorMessage: t("networkError") });

  const { isRefreshing, refreshStep, refreshError, refreshCache } =
    useRepoCacheRefresh({
      refetchConfig,
      messages: {
        pending: t("cache.statusPending"),
        listingFiles: t("cache.listingFiles"),
        cachingFiles: (count) =>
          t("cache.cachingFiles", { count: String(count) }),
        contentsError: t("contentsError"),
        networkError: t("networkError"),
        refreshComplete: (fileCount) =>
          t("refreshComplete", { fileCount: String(fileCount) }),
        refreshInProgress: t("refreshInProgress"),
      },
    });

  const handleToggleImpact = async (enabled: boolean) => {
    await updateProject.mutateAsync({
      where: { id: projectId },
      data: { impactEnabled: enabled },
    });
    toast.success(enabled ? t("enabledToast") : t("disabledToast"));
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
      });
    }
  }, [existingConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRepositoryId = form.watch("repositoryId");
  const cacheEnabled = form.watch("cacheEnabled");

  const handleDisconnect = async () => {
    if (!existingConfig) return;
    try {
      await deleteConfig.mutateAsync({
        where: { id: existingConfig.id },
      });
      form.reset(defaultFormValues);
      clearPreview();
      branchListRef.current = null;
      setBranchesError(null);
      setDefaultBranchName(null);
      toast.success(t("disconnectSuccess"));
      void refetchConfig();
    } catch {
      toast.error(t("disconnectError"));
    }
  };

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
        <span>{t("repository.defaultBranch")}</span>
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
    void refreshCache({
      repositoryId: existingConfig.repositoryId,
      configId: existingConfig.id,
    });
  };

  const onSubmit = async (values: FormData) => {
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
        ...cacheResetFields,
      };

      if (existingConfig) {
        await updateConfig.mutateAsync({
          where: { id: existingConfig.id },
          data: {
            ...sharedData,
            repository: { connect: { id: repositoryId } },
          },
        });
      } else {
        await createConfig.mutateAsync({
          data: {
            ...sharedData,
            purpose: "IMPACT",
            repository: { connect: { id: repositoryId } },
            project: { connect: { id: projectId } },
          },
        });
      }

      branchListRef.current = null;
      setBranchesError(null);
      toast.success(t("saved"));
      void refetchConfig();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("saveError");
      toast.error(message);
    }
  };

  const preferences = session?.user.preferences;
  const preferredDateTimeFormat =
    preferences?.dateFormat && preferences?.timeFormat
      ? `${preferences.dateFormat} ${preferences.timeFormat}`
      : preferences?.dateFormat;

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

  const isSaving = createConfig.isPending || updateConfig.isPending;
  const configData = existingConfig;
  const markerView = readMarkerScanReport(existingConfig?.markerScanReport);

  if (isAuthLoading) {
    return <Loading />;
  }

  if (projectLoading || permissionsLoading || repositoriesLoading) {
    return <Loading />;
  }

  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-100 h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <PageTitle className="mb-2">
            {tCommon("errors.projectNotFound")}
          </PageTitle>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{t("title")}</CardTitle>
            <HelpPopover helpKey="projectImpact" />
          </SectionHeader>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="impact-enabled-toggle"
                    checked={project?.impactEnabled ?? false}
                    onCheckedChange={handleToggleImpact}
                    disabled={updateProject.isPending}
                    data-testid="impact-enabled-toggle"
                  />
                  <span className="text-base font-medium">
                    {t("enableLabel")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("enableDescription")}
                </p>
              </div>
            </CardContent>
          </Card>

          {repositories?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <GitBranch className="h-10 w-10 text-muted-foreground/40" />
                {session?.user?.access === "ADMIN" ? (
                  <>
                    <div>
                      <p className="font-medium">{t("noRepos.title")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("noRepos.adminDescription")}
                      </p>
                    </div>
                    <Button asChild>
                      <Link href="/admin/code-repositories">
                        {t("noRepos.adminLink")}
                      </Link>
                    </Button>
                  </>
                ) : (
                  <div>
                    <p className="font-medium">{t("noRepos.title")}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("noRepos.userDescription")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Form {...(form as any)}>
              <form
                onSubmit={(form as any).handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>{t("repository.title")}</CardTitle>
                      {existingConfig && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setShowDisconnectDialog(true)}
                          data-testid="impact-disconnect-button"
                        >
                          <Unlink className="h-4 w-4" />
                          {t("disconnect")}
                        </Button>
                      )}
                    </div>
                    <CardDescription>
                      {t("repository.description")}
                    </CardDescription>
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
                          >
                            <FormControl>
                              <SelectTrigger data-testid="impact-repository-select">
                                <SelectValue
                                  placeholder={t("repository.placeholder")}
                                />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(
                                (repositories as
                                  CodeRepository[] | undefined) ?? []
                              ).map((repo) => (
                                <SelectItem
                                  key={repo.id}
                                  value={String(repo.id)}
                                >
                                  {repo.name} {"("}
                                  {repo.provider}
                                  {")"}
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
                          <FormLabel>{t("repository.branchLabel")}</FormLabel>
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
                                ariaLabel={t("repository.branchLabel")}
                                className="w-full"
                                showPagination={false}
                              />
                            </div>
                          ) : (
                            <>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={t(
                                    "repository.branchInputPlaceholder"
                                  )}
                                  data-testid="impact-branch-input"
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
                    <CardTitle>{t("pathPatterns.title")}</CardTitle>
                    <CardDescription>
                      {t("pathPatterns.description")}
                    </CardDescription>
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
                                <FormLabel>
                                  {t("pathPatterns.pathLabel")}
                                </FormLabel>
                              )}
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={t(
                                    "pathPatterns.pathPlaceholder"
                                  )}
                                  data-testid={`impact-path-${index}`}
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
                                  {t("pathPatterns.patternLabel")}
                                </FormLabel>
                              )}
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder="**/*"
                                  data-testid={`impact-pattern-${index}`}
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
                          disabled={fields.length === 1}
                          aria-label={tCommon("actions.delete")}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ path: "", pattern: "**/*" })}
                      data-testid="impact-add-path"
                    >
                      <Plus className="h-4 w-4" />
                      {t("pathPatterns.addPath")}
                    </Button>

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
                        {t("pathPatterns.previewFiles")}
                      </Button>
                      {isPreviewing && previewProgress && (
                        <span className="text-sm text-muted-foreground">
                          {previewProgress.step === "branch" &&
                            t("preview.resolvingBranch")}
                          {previewProgress.step === "listing" &&
                            (previewProgress.filesFound != null
                              ? t("preview.scanningFilesCount", {
                                  count: previewProgress.filesFound,
                                  scope: previewProgress.scope ?? "",
                                })
                              : t("preview.scanningFiles", {
                                  scope: previewProgress.scope ?? "",
                                }))}
                          {previewProgress.step === "filtering" &&
                            t("preview.filtering", {
                              count: previewProgress.totalFiles ?? 0,
                            })}
                          {previewProgress.step === "rate-limited" &&
                            t("preview.rateLimited", {
                              seconds: previewProgress.waitSeconds ?? 0,
                            })}
                        </span>
                      )}
                    </div>

                    {preview && !preview.error && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>
                            {t("pathPatterns.files", {
                              count: preview.fileCount,
                            })}
                          </span>
                          <span>{preview.totalSizeFormatted}</span>
                          {preview.truncated && (
                            <Badge variant="secondary">
                              {t("pathPatterns.truncatedBadge")}
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
                    <CardTitle>{t("cache.title")}</CardTitle>
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
                              data-testid="impact-cache-enabled"
                            />
                          </FormControl>
                          <FormLabel className="font-medium">
                            {t("cache.enableLabel")}
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
                                      {t("cache.ttlBefore")}
                                    </FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        type="number"
                                        min={1}
                                        max={30}
                                        className="w-16"
                                        aria-label={t("cache.ttlAriaLabel")}
                                        onChange={(e) =>
                                          field.onChange(
                                            parseInt(e.target.value) || 7
                                          )
                                        }
                                      />
                                    </FormControl>
                                    <span>
                                      {t("cache.ttlDays", {
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
                                      {t("cache.statusTitle")}
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
                                        : t("cache.refreshButton")}
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
                                            {t("cache.statusNeverFetched")}
                                          </Badge>
                                        )}
                                        {configData.cacheStatus ===
                                          "success" && (
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
                                        {configData.cacheStatus ===
                                          "pending" && (
                                          <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <Badge variant="secondary">
                                              {t("cache.statusPending")}
                                            </Badge>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <span className="text-muted-foreground">
                                        {t("cache.lastFetched")}
                                      </span>
                                      <div className="mt-1">
                                        {configData.cacheLastFetchedAt ? (
                                          <DateFormatter
                                            date={
                                              new Date(
                                                configData.cacheLastFetchedAt
                                              )
                                            }
                                            formatString={
                                              preferredDateTimeFormat
                                            }
                                            timezone={preferences?.timezone}
                                          />
                                        ) : (
                                          "—"
                                        )}
                                      </div>
                                    </div>

                                    <div>
                                      <span className="text-muted-foreground">
                                        {t("cache.filesCached")}
                                      </span>
                                      <div className="mt-1">
                                        {configData.cacheFileCount ?? "—"}
                                      </div>
                                    </div>

                                    <div>
                                      <span className="text-muted-foreground">
                                        {t("cache.contentsCached")}
                                      </span>
                                      <div className="mt-1">
                                        {configData.cacheContentFileCount ??
                                          "—"}
                                      </div>
                                    </div>

                                    <div>
                                      <span className="text-muted-foreground">
                                        {t("cache.totalSize")}
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
                                            total: String(
                                              configData.cacheFileCount
                                            ),
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
                    <CardTitle>{t("markers.title")}</CardTitle>
                    <CardDescription>
                      {t("markers.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent
                    className="space-y-3 text-sm"
                    data-testid="impact-markers"
                  >
                    {markerView.kind === "never" && (
                      <Badge variant="secondary">{t("markers.never")}</Badge>
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
                          {t("markers.error", { error: markerView.error })}
                        </AlertDescription>
                      </Alert>
                    )}

                    {markerView.kind === "scanned" && (
                      <>
                        <p className="text-muted-foreground">
                          {t("markers.lastScan", {
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
                              {markerView.problemDetails.map(
                                (detail, index) => (
                                  <li key={`${index}-${detail}`}>{detail}</li>
                                )
                              )}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={isSaving}
                    aria-label={t("save")}
                    className="group gap-0 transition-all duration-200 hover:gap-2"
                    data-testid="impact-save"
                  >
                    {isSaving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                      {t("save")}
                    </span>
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("disconnect")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-2">
              <div>
                <p>
                  {t("confirmDisconnect", {
                    name: existingConfig?.repository?.name ?? "",
                  })}
                </p>
                <div>
                  <p className="font-medium">{t("disconnectWarningTitle")}</p>
                  <ul className="list-disc ps-5 mt-1">
                    <li>{t("disconnectWarning1", { count: pinCount ?? 0 })}</li>
                    <li>{t("disconnectWarning2")}</li>
                    <li>{t("disconnectWarning3")}</li>
                  </ul>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="impact-disconnect-confirm"
            >
              {t("disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
