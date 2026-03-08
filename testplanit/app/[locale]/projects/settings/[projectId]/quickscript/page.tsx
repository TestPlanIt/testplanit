"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4";
import { toast } from "sonner";
import {
  useFindManyCodeRepository,
  useFindFirstProjectCodeRepositoryConfig,
  useCreateProjectCodeRepositoryConfig,
  useUpdateProjectCodeRepositoryConfig,
  useDeleteProjectCodeRepositoryConfig,
  useFindUniqueProjects,
  useUpdateProjects,
} from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  GitBranch,
  Unlink,
} from "lucide-react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useSession } from "next-auth/react";
import { DateFormatter } from "@/components/DateFormatter";
import { Link } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { ProjectIcon } from "@/components/ProjectIcon";

interface PreviewFile {
  path: string;
  size: number;
}

interface PreviewResult {
  files: PreviewFile[];
  fileCount: number;
  totalSize: number;
  totalSizeFormatted: string;
  exceedsLimit: boolean;
  overflowBytes: number;
  truncated: boolean;
  error?: string;
}

interface CodeRepository {
  id: number;
  name: string;
  provider: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function QuickScriptPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  useRequireAuth();
  const { data: session } = useSession();
  const t = useTranslations("projects.settings.quickScript");
  const tCommon = useTranslations("common");

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

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStep, setRefreshStep] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // Load existing config
  const { data: existingConfig, refetch: refetchConfig } =
    useFindFirstProjectCodeRepositoryConfig({
      where: { projectId },
      include: {
        repository: {
          select: { id: true, name: true, provider: true },
        },
      },
    });

  // Load available repositories for selector
  const { data: repositories, isLoading: repositoriesLoading } =
    useFindManyCodeRepository({
      where: { isDeleted: false, status: "ACTIVE" },
      select: { id: true, name: true, provider: true },
    });

  const createConfig = useCreateProjectCodeRepositoryConfig();
  const updateConfig = useUpdateProjectCodeRepositoryConfig();
  const deleteConfig = useDeleteProjectCodeRepositoryConfig();

  // QuickScript enabled toggle
  const { data: project } = useFindUniqueProjects({
    where: { id: projectId },
    select: { id: true, name: true, iconUrl: true, quickScriptEnabled: true },
  });
  const updateProject = useUpdateProjects();

  const handleToggleQuickScript = async (enabled: boolean) => {
    await updateProject.mutateAsync({
      where: { id: projectId },
      data: { quickScriptEnabled: enabled },
    });
    toast.success(enabled ? t("enabledToast") : t("disabledToast"));
  };

  const handleDisconnect = async () => {
    if (!existingConfig) return;
    try {
      await deleteConfig.mutateAsync({
        where: { id: existingConfig.id },
      });
      form.reset({
        repositoryId: "",
        branch: "",
        pathPatterns: [{ path: "tests/e2e", pattern: "**/*.ts" }],
        cacheEnabled: true,
        cacheTtlDays: 7,
      });
      setPreview(null);
      toast.success(t("disconnectSuccess"));
      refetchConfig();
    } catch {
      toast.error(t("disconnectError"));
    }
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      repositoryId: "",
      branch: "",
      pathPatterns: [{ path: "tests/e2e", pattern: "**/*.ts" }],
      cacheEnabled: true,
      cacheTtlDays: 7,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control as any,
    name: "pathPatterns",
  });

  // Populate form when existing config loads
  useEffect(() => {
    if (existingConfig) {
      form.reset({
        repositoryId: String(existingConfig.repositoryId),
        branch: existingConfig.branch ?? "",
        pathPatterns: (existingConfig.pathPatterns as {
          path: string;
          pattern: string;
        }[]) ?? [{ path: "", pattern: "*" }],
        cacheEnabled: (existingConfig as any).cacheEnabled ?? true,
        cacheTtlDays: existingConfig.cacheTtlDays ?? 7,
      });
    }
  }, [existingConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRepositoryId = form.watch("repositoryId");
  const cacheEnabled = form.watch("cacheEnabled");

  const handlePreview = async () => {
    const values = form.getValues();
    if (!values.repositoryId) return;

    setIsPreviewing(true);
    setPreview(null);

    try {
      const response = await fetch(
        `/api/code-repositories/${values.repositoryId}/preview-files`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch: values.branch || undefined,
            pathPatterns: values.pathPatterns,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        setPreview({
          files: [],
          fileCount: 0,
          totalSize: 0,
          totalSizeFormatted: "0 B",
          exceedsLimit: false,
          overflowBytes: 0,
          truncated: false,
          error: data.error,
        });
      } else {
        setPreview(data);
      }
    } catch {
      setPreview({
        files: [],
        fileCount: 0,
        totalSize: 0,
        totalSizeFormatted: "0 B",
        exceedsLimit: false,
        overflowBytes: 0,
        truncated: false,
        error: t("networkError"),
      });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleRefreshCache = async () => {
    if (!existingConfig) return;
    setIsRefreshing(true);

    const post = (step: string) =>
      fetch(
        `/api/code-repositories/${existingConfig.repositoryId}/refresh-cache`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectConfigId: existingConfig.id, step }),
        }
      ).then((r) => r.json());

    setRefreshError(null);

    try {
      // Step 1: fetch file list (fast — single git tree API call)
      setRefreshStep(t("cache.listingFiles"));
      const listData = await post("list-only");
      if (!listData.success) {
        setRefreshError(listData.error ?? t("listError"));
        refetchConfig();
        return;
      }

      // Step 2: fetch and cache file contents (slow — one call per file)
      setRefreshStep(t("cache.cachingFiles", { count: listData.fileCount }));
      const contentData = await post("contents-only");

      if (!contentData.success) {
        setRefreshError(contentData.error ?? t("contentsError"));
        refetchConfig();
        return;
      }

      if (contentData.contentRateLimited) {
        toast.warning(
          t("refreshRateLimited", {
            fileCount: listData.fileCount,
            contentCached: contentData.contentCached,
          })
        );
      } else {
        toast.success(
          t("refreshSuccess", {
            fileCount: listData.fileCount,
            contentCached: contentData.contentCached,
          })
        );
      }
      refetchConfig();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setIsRefreshing(false);
      setRefreshStep("");
    }
  };

  const onSubmit = async (values: FormData) => {
    try {
      const repositoryId = parseInt(values.repositoryId);

      // Only reset cache status when content-affecting fields actually change.
      // Changing TTL or cacheEnabled doesn't invalidate the existing cached files.
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
            repository: { connect: { id: repositoryId } },
            project: { connect: { id: projectId } },
          },
        });
      }

      toast.success(t("saved"));
      refetchConfig();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("saveError");
      toast.error(message);
    }
  };

  const isSaving = createConfig.isPending || updateConfig.isPending;
  const configData = existingConfig as
    | (typeof existingConfig & {
        cacheEnabled: boolean;
        cacheStatus: string | null;
        cacheLastFetchedAt: string | Date | null;
        cacheFileCount: number | null;
        cacheTotalSize: bigint | number | null;
        cacheError: string | null;
      })
    | null
    | undefined;

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{t("title")}</span>
            </CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

      {/* QuickScript Enable/Disable */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label
                htmlFor="quickscript-enabled-toggle"
                className="text-base font-medium"
              >
                {t("enableLabel")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("enableDescription")}
              </p>
            </div>
            <Switch
              id="quickscript-enabled-toggle"
              checked={project?.quickScriptEnabled ?? false}
              onCheckedChange={handleToggleQuickScript}
              disabled={updateProject.isPending}
              data-testid="quickscript-enabled-toggle"
            />
          </div>
        </CardContent>
      </Card>

      {!repositoriesLoading && repositories?.length === 0 ? (
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
        !repositoriesLoading && (
          <Form {...(form as any)}>
            <form
              onSubmit={(form as any).handleSubmit(onSubmit)}
              className="space-y-6"
            >
              {/* Repository Selector */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
                    <CardTitle>{t("repository.title")}</CardTitle>
                    {existingConfig && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setShowDisconnectDialog(true)}
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
                        <FormLabel>{t("repository.label")}</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("repository.placeholder")}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(
                              (repositories as CodeRepository[] | undefined) ??
                              []
                            ).map((repo) => (
                              <SelectItem key={repo.id} value={String(repo.id)}>
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
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t("repository.branchPlaceholder")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Path Patterns */}
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
                                placeholder={t("pathPatterns.pathPlaceholder")}
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
                              <Input {...field} placeholder="*" />
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
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ path: "", pattern: "*" })}
                  >
                    <Plus className="h-4 w-4" />
                    {t("pathPatterns.addPath")}
                  </Button>

                  {/* Preview */}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handlePreview}
                      disabled={isPreviewing || !selectedRepositoryId}
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      {t("pathPatterns.previewFiles")}
                    </Button>
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

                      {preview.exceedsLimit && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            {t("pathPatterns.exceedsLimit", {
                              overflow: formatBytes(preview.overflowBytes),
                            })}
                          </AlertDescription>
                        </Alert>
                      )}

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

              {/* Cache Settings + Status */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("cache.title")}</CardTitle>
                  <CardDescription>{t("cache.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Enable/disable cache toggle */}
                  <FormField
                    control={form.control as any}
                    name="cacheEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-medium">
                          {t("cache.enableLabel")}
                        </FormLabel>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!cacheEnabled && (
                    <Alert>
                      <AlertDescription>
                        {t("cache.disabledWarning")}
                      </AlertDescription>
                    </Alert>
                  )}

                  {cacheEnabled && (
                    <>
                      <FormField
                        control={form.control as any}
                        name="cacheTtlDays"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("cache.ttlLabel")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min={1}
                                max={30}
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value) || 7)
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Cache Status Panel */}
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
                                  {t("cache.statusLabel")}
                                </span>
                                <div className="mt-1 flex items-center gap-2">
                                  {!configData.cacheStatus && (
                                    <Badge variant="secondary">
                                      {t("cache.statusNeverFetched")}
                                    </Badge>
                                  )}
                                  {configData.cacheStatus === "success" && (
                                    <>
                                      <CheckCircle className="h-4 w-4 text-success" />
                                      <Badge variant="default">
                                        {t("cache.statusSuccess")}
                                      </Badge>
                                    </>
                                  )}
                                  {configData.cacheStatus === "error" && (
                                    <>
                                      <XCircle className="h-4 w-4 text-destructive" />
                                      <Badge variant="destructive">
                                        {t("cache.statusError")}
                                      </Badge>
                                    </>
                                  )}
                                  {configData.cacheStatus === "pending" && (
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
                                        new Date(configData.cacheLastFetchedAt)
                                      }
                                      formatString={
                                        session?.user.preferences?.dateFormat &&
                                        session?.user.preferences?.timeFormat
                                          ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat}`
                                          : session?.user.preferences
                                              ?.dateFormat
                                      }
                                      timezone={
                                        session?.user.preferences?.timezone
                                      }
                                    />
                                  ) : (
                                    "\u2014"
                                  )}
                                </div>
                              </div>

                              <div>
                                <span className="text-muted-foreground">
                                  {t("cache.filesCached")}
                                </span>
                                <div className="mt-1">
                                  {configData.cacheFileCount ?? "\u2014"}
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
                                    : "\u2014"}
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
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("save")}
                </Button>
              </div>
            </form>
          </Form>
        )
      )}
        </CardContent>
      </Card>

      <AlertDialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("disconnect")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {t("confirmDisconnect", {
                  name: (existingConfig as any)?.repository?.name ?? "",
                })}
              </p>
              <div>
                <p className="font-medium">{t("disconnectWarningTitle")}</p>
                <ul className="list-disc pl-5 mt-1">
                  <li>{t("disconnectWarning1")}</li>
                  <li>{t("disconnectWarning2")}</li>
                  <li>{t("disconnectWarning3")}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
