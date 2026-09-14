"use client";

import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  GitBranch,
  Loader2,
  SquarePen,
  Plus,
  Unlink,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { Link } from "~/lib/navigation";
import { ApplicationArea } from "~/zenstack/models";
import { ImpactRepositoryDialog } from "./ImpactRepositoryDialog";
import {
  type CodeRepositoryOption,
  type ImpactConfigRow,
  type ImpactRepositoryFormMode,
} from "./ImpactRepositoryForm";
import { readIssueScanReport } from "./issueScanReport";

interface DialogState {
  open: boolean;
  mode: ImpactRepositoryFormMode;
  configId: number | null;
}

/** A refresh or scan is in flight for this connection. */
function isBusy(config: ImpactConfigRow): boolean {
  return (
    config.cacheStatus === "pending" ||
    readIssueScanReport(config.issueScanReport).kind === "running"
  );
}

export default function ImpactSettingsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const t = useTranslations("projects.settings.impact");
  const tCommon = useTranslations("common");

  const [dialog, setDialog] = useState<DialogState>({
    open: false,
    mode: "add",
    configId: null,
  });
  const [disconnectTarget, setDisconnectTarget] =
    useState<ImpactConfigRow | null>(null);

  const { data: existingConfigs, refetch: refetchConfigs } = useClientQueries(
    schema
  ).projectCodeRepositoryConfig.useFindMany(
    {
      where: { projectId, purpose: "IMPACT" },
      orderBy: { id: "asc" },
      include: {
        repository: {
          select: { id: true, name: true, provider: true },
        },
      },
    },
    {
      // Keep the cards live while a refresh or scan runs in the worker.
      refetchInterval: (query) => {
        const rows = (query.state.data ?? []) as unknown as ImpactConfigRow[];
        return rows.some(isBusy) ? 5000 : false;
      },
    }
  );
  const configs = (existingConfigs ?? []) as unknown as ImpactConfigRow[];

  const { data: pinCount } = useClientQueries(
    schema
  ).repositoryCaseCodePin.useCount(
    { where: { configId: disconnectTarget?.id ?? 0, isDeleted: false } },
    { enabled: !!disconnectTarget }
  );

  const { data: repositories, isLoading: repositoriesLoading } =
    useClientQueries(schema).codeRepository.useFindMany({
      where: { isDeleted: false, status: "ACTIVE" },
      select: { id: true, name: true, provider: true },
    });
  const repositoryOptions = (repositories ?? []) as CodeRepositoryOption[];

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

  const handleToggleImpact = async (enabled: boolean) => {
    await updateProject.mutateAsync({
      where: { id: projectId },
      data: { impactEnabled: enabled },
    });
    toast.success(enabled ? t("enabledToast") : t("disabledToast"));
  };

  const connectedRepositoryIds = configs.map((config) => config.repositoryId);
  const canConnectMore = repositoryOptions.some(
    (repo) => !connectedRepositoryIds.includes(repo.id)
  );

  const openDialog = (
    mode: ImpactRepositoryFormMode,
    configId: number | null
  ) => setDialog({ open: true, mode, configId });
  const dialogConfig =
    dialog.configId === null
      ? null
      : (configs.find((config) => config.id === dialog.configId) ?? null);

  const handleSaved = () => {
    setDialog((prev) => ({ ...prev, open: false }));
    void refetchConfigs();
  };

  const handleDisconnect = async () => {
    if (!disconnectTarget) return;
    const target = disconnectTarget;
    try {
      await deleteConfig.mutateAsync({ where: { id: target.id } });
      setDisconnectTarget(null);
      if (dialog.configId === target.id) {
        setDialog((prev) => ({ ...prev, open: false }));
      }
      toast.success(t("disconnectSuccess"));
      void refetchConfigs();
    } catch {
      toast.error(t("disconnectError"));
    }
  };

  const preferences = session?.user.preferences;
  const preferredDateTimeFormat =
    preferences?.dateFormat && preferences?.timeFormat
      ? `${preferences.dateFormat} ${preferences.timeFormat}`
      : (preferences?.dateFormat ?? undefined);

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

  const renderCacheStatus = (config: ImpactConfigRow) => {
    if (!config.cacheEnabled) {
      return (
        <Badge variant="secondary">{t("repositories.cacheDisabled")}</Badge>
      );
    }
    if (config.cacheStatus === "success") {
      return (
        <span className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-success" />
          <span>
            {config.cacheFileCount != null
              ? t("pathPatterns.files", { count: config.cacheFileCount })
              : tCommon("fields.success")}
          </span>
          {config.cacheLastFetchedAt && (
            <span className="text-muted-foreground">
              <DateFormatter
                date={new Date(config.cacheLastFetchedAt)}
                formatString={preferredDateTimeFormat}
                timezone={preferences?.timezone}
              />
            </span>
          )}
        </span>
      );
    }
    if (config.cacheStatus === "error") {
      return (
        <span className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-destructive" />
          <span>{tCommon("errors.error")}</span>
        </span>
      );
    }
    if (config.cacheStatus === "pending") {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("cache.statusPending")}</span>
        </span>
      );
    }
    return <Badge variant="secondary">{t("cache.statusNeverFetched")}</Badge>;
  };

  const renderTicketStatus = (config: ImpactConfigRow) => {
    const view = readIssueScanReport(config.issueScanReport);
    switch (view.kind) {
      case "running":
        return (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {t(
                view.progress.full
                  ? "tickets.runningFull"
                  : "tickets.runningRecent"
              )}
            </span>
          </span>
        );
      case "scanned":
        return (
          <span>
            {t("repositories.lastScan", {
              created: view.report.created,
            })}{" "}
            <span className="text-muted-foreground">
              <DateFormatter
                date={new Date(view.report.scannedAt)}
                formatString={preferredDateTimeFormat}
                timezone={preferences?.timezone}
              />
            </span>
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive" />
            <span>{t("repositories.scanFailed")}</span>
          </span>
        );
      case "cancelled":
        return <span>{t("repositories.scanCancelled")}</span>;
      default:
        return <Badge variant="secondary">{t("tickets.never")}</Badge>;
    }
  };

  const connectButton = (
    <Button
      type="button"
      onClick={() => openDialog("add", null)}
      disabled={!canConnectMore}
      title={canConnectMore ? undefined : t("repositories.allConnected")}
      data-testid="impact-connect-repository"
    >
      <Plus className="h-4 w-4" />
      {t("repositories.connect")}
    </Button>
  );

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

          {repositoryOptions.length === 0 ? (
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
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>{t("repositories.title")}</CardTitle>
                    <CardDescription>
                      {t("repositories.description")}
                    </CardDescription>
                  </div>
                  {connectButton}
                </div>
              </CardHeader>
              <CardContent
                className="space-y-3"
                data-testid="impact-connected-repositories"
              >
                {configs.length === 0 && (
                  <div
                    className="flex flex-col items-center gap-3 py-10 text-center"
                    data-testid="impact-repos-empty"
                  >
                    <GitBranch className="h-10 w-10 text-muted-foreground/40" />
                    <div>
                      <p className="font-medium">{t("repositories.empty")}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("repositories.emptyDescription")}
                      </p>
                    </div>
                  </div>
                )}

                {configs.map((config) => (
                  <Card
                    key={config.id}
                    shadow="none"
                    data-testid={`impact-repo-card-${config.id}`}
                  >
                    <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <CodeRepositoryName
                            name={config.repository.name}
                            provider={config.repository.provider}
                            branch={config.branch}
                            nameClassName="font-medium"
                            data-testid={`impact-repo-name-${config.id}`}
                          />
                          {!config.branch && (
                            <span className="text-xs text-muted-foreground">
                              {t("repository.defaultBranch")}
                            </span>
                          )}
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          <dt className="text-muted-foreground">
                            {t("repositories.columnCache")}
                          </dt>
                          <dd data-testid={`impact-repo-cache-${config.id}`}>
                            {renderCacheStatus(config)}
                          </dd>
                          <dt className="text-muted-foreground">
                            {t("tickets.title")}
                          </dt>
                          <dd data-testid={`impact-repo-tickets-${config.id}`}>
                            {renderTicketStatus(config)}
                          </dd>
                        </dl>
                        {config.cacheStatus === "error" &&
                          config.cacheError && (
                            <p className="flex items-center gap-2 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              <span className="truncate">
                                {config.cacheError}
                              </span>
                            </p>
                          )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("repositories.view")}
                          onClick={() => openDialog("view", config.id)}
                          data-testid={`impact-repo-view-${config.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t("repositories.edit")}
                          onClick={() => openDialog("edit", config.id)}
                          data-testid={`impact-repo-edit-${config.id}`}
                        >
                          <SquarePen className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label={t("disconnect")}
                          onClick={() => setDisconnectTarget(config)}
                          data-testid={`impact-repo-disconnect-${config.id}`}
                        >
                          <Unlink className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {dialog.open && (
        <ImpactRepositoryDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
          mode={dialog.mode}
          onModeChange={(mode) => setDialog((prev) => ({ ...prev, mode }))}
          projectId={projectId}
          config={dialogConfig}
          repositories={repositoryOptions}
          connectedRepositoryIds={connectedRepositoryIds}
          preferences={preferences}
          refetchConfigs={async () => {
            const result = await refetchConfigs();
            return {
              data: (result.data ?? null) as unknown as
                ImpactConfigRow[] | null,
            };
          }}
          onSaved={handleSaved}
        />
      )}

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null);
        }}
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
                    name: disconnectTarget?.repository?.name ?? "",
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
