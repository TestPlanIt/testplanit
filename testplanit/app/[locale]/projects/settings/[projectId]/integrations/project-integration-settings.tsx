"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WarningAlert } from "@/components/ui/warning-alert";
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
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SectionTitle, Text } from "@/components/ui/typography";
import type { Integration, ProjectIntegration } from "~/zenstack/models";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Loader2,
  Save,
  Star,
  Trash,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import { SYNC_STATUS } from "~/lib/integrations/syncStatus";

import { removeIntegrationProjectMapping } from "~/app/actions/project-integration";
import { ImportIssuesDialog } from "./import-issues-dialog";
import { MilestoneSyncSettings } from "./milestone-sync-settings";
import { readRequirementTypeConfig } from "~/lib/integrations/requirementTypeConfig";
import { RequirementsConfigSettings } from "./requirements-config-settings";

interface ProjectIntegrationSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
}

interface ExternalProject {
  id: string;
  key: string;
  name: string;
}

interface IssueType {
  id: string;
  name: string;
}

interface LinkedProjectSnapshotEntry {
  id: string;
  defaultIssueType: string | null;
}

/** Order-independent, primitive-only fingerprint of this section's Save-gated
 *  editable state: which mappings are linked, and each one's default issue
 *  type. Everything else in the section (add/remove/set-default) already
 *  commits immediately via its own mutation, so this exists purely to drive
 *  the Save button's dirty state. A JSON string of sorted primitives is
 *  cheap to recompute every render and stays equal across renders that carry
 *  the same underlying rows, even when the query hook hands back a new array
 *  reference — the identity-stability `useMemo` needs to avoid a false
 *  "dirty" reading on every unrelated re-render. */
function buildLinkedProjectsSnapshotKey(
  integrationProjects:
    Array<{ id: string; defaultIssueType?: string | null }> | undefined
): string | null {
  if (!integrationProjects) {
    return null;
  }
  const entries: LinkedProjectSnapshotEntry[] = integrationProjects
    .map((ip) => ({
      id: ip.id,
      defaultIssueType: ip.defaultIssueType ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(entries);
}

export function ProjectIntegrationSettings({
  projectIntegration,
  integration,
}: ProjectIntegrationSettingsProps) {
  const t = useTranslations("projects.settings.integrations");
  const tGlobal = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [_isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [externalProjects, setExternalProjects] = useState<ExternalProject[]>(
    []
  );
  const [config, _setConfig] = useState(
    (projectIntegration.config as Record<string, any>) || {}
  );

  // The requirement types saved in Requirement Sync. The import dialog's
  // typed path gates on receiving these: without them it refuses with
  // "select and save at least one issue type" even when they ARE saved,
  // which makes an uncapped requirement import unreachable from this row.
  // Read through the same shared reader that section uses, so the two
  // entry points can never disagree about what is configured.
  const savedRequirementConfig = useMemo(
    () => readRequirementTypeConfig(projectIntegration.config),
    [projectIntegration.config]
  );
  const [needsAuth, setNeedsAuth] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedNewProjects, setSelectedNewProjects] = useState<
    ExternalProject[]
  >([]);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(
    null
  );
  const [isAddingProjects, setIsAddingProjects] = useState(false);
  // The single, shared import dialog's request (28-20): which mapping, and
  // -- only when opened from the Requirement Sync section -- its configured
  // requirement types to preselect. Held as one object so opening from
  // EITHER entry point always fully replaces any stale preselection from
  // the other.
  const [importRequest, setImportRequest] = useState<{
    target: { id: string; name: string; key: string };
    initialIssueTypeIds?: string[];
    initialIssueTypeNames?: Record<string, string>;
  } | null>(null);

  // The stop-confirmation dialog targets one mapping (IntegrationProject) id
  // at a time -- moved here from requirements-config-settings.tsx (#501/28-21)
  // so progress and its stop control live on the same row as the Import
  // button that started the run, instead of a separate block that could only
  // describe where that button was.
  const [stopMappingId, setStopMappingId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const { mutateAsync: updateProjectIntegration } =
    useClientQueries(schema).projectIntegration.useUpdate();

  const {
    data: integrationProjects,
    isLoading: isLoadingLinkedProjects,
    refetch: refetchIntegrationProjects,
  } = useClientQueries(schema).integrationProject.useFindMany(
    {
      where: {
        projectIntegrationId: projectIntegration.id,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { externalProjectName: "asc" }],
    },
    {
      // While a row is mid-import (or re-sync) its syncStatus is "syncing";
      // poll so the badge advances to completed/error without a manual
      // reload. Extended to also poll while cancel-requested (#501/28-21) --
      // a stop request lands in that intermediate state before the running
      // import's own page loop honors it and moves the row to "cancelled",
      // and that is exactly when the user is watching hardest.
      refetchInterval: (query: any) => {
        const rows = query?.state?.data as
          Array<{ syncStatus?: string | null }> | undefined;
        return rows?.some(
          (r) =>
            r.syncStatus === SYNC_STATUS.syncing ||
            r.syncStatus === SYNC_STATUS.cancelRequested
        )
          ? 3000
          : false;
      },
    }
  );

  const { mutateAsync: upsertIntegrationProject } =
    useClientQueries(schema).integrationProject.useUpsert();
  const { mutateAsync: updateIntegrationProject } =
    useClientQueries(schema).integrationProject.useUpdate();

  // The Remove confirmation copy includes a bullet about cascade-deleting
  // the inbound webhook ONLY when one exists. Cheap query — same shape
  // the webhooks page uses, so React Query dedupes when both are mounted.
  const { data: inboundConfigs, refetch: refetchInboundConfigs } =
    useClientQueries(schema).webhookConfig.useFindMany({
      where: {
        projectId: projectIntegration.projectId,
        direction: "INBOUND",
      },
      select: { id: true },
    });
  const hasInboundWebhook = (inboundConfigs?.length ?? 0) > 0;
  const isLastActiveMapping = (integrationProjects?.length ?? 0) === 1;

  const currentLinkedProjectsSnapshot = useMemo(
    () => buildLinkedProjectsSnapshotKey(integrationProjects),
    [integrationProjects]
  );

  // Baseline the Save button compares against, seeded once the linked
  // projects query resolves (never while still loading, so the loading ->
  // loaded transition itself never reads as a pending edit) and advanced
  // only by a successful Save.
  const [savedLinkedProjectsSnapshot, setSavedLinkedProjectsSnapshot] =
    useState<string | null>(null);

  useEffect(() => {
    if (
      savedLinkedProjectsSnapshot === null &&
      currentLinkedProjectsSnapshot !== null
    ) {
      setSavedLinkedProjectsSnapshot(currentLinkedProjectsSnapshot);
    }
  }, [currentLinkedProjectsSnapshot, savedLinkedProjectsSnapshot]);

  const loadExternalProjects = useCallback(async () => {
    setIsLoadingProjects(true);

    try {
      const response = await fetch(
        `/api/integrations/${integration.id}/projects`
      );

      // 401 means the stored authorization must be renewed. Any other failure
      // is reported with the message the API returned, which names what to
      // fix — a re-authorize prompt would send the admin somewhere that
      // cannot resolve a rejected API key or a wrong site URL.
      if (response.status === 401) {
        setNeedsAuth(true);
        return;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        toast.error(data?.error ?? t("integration.loadProjectsError"));
        return;
      }

      setExternalProjects(data?.projects || []);
    } catch {
      toast.error(t("integration.loadProjectsError"));
    } finally {
      setIsLoadingProjects(false);
    }
  }, [integration.id, t]);

  const checkAuthAndLoadProjects = useCallback(async () => {
    // Check if user has auth for this integration
    const authResponse = await fetch(
      `/api/integrations/${integration.id}/auth/check`
    );

    if (!authResponse.ok) {
      setNeedsAuth(true);
      return;
    }

    void loadExternalProjects();
  }, [integration.id, loadExternalProjects]);

  useEffect(() => {
    // Only check auth and load projects for integrations that support it
    if (integration.provider !== "SIMPLE_URL") {
      void checkAuthAndLoadProjects();
    }
  }, [checkAuthAndLoadProjects, integration.provider]);

  // Real dirty-tracking, not a stub: enabled only when the linked-projects
  // list or a mapping's default issue type differs from the last-saved
  // snapshot — the same "disabled until dirty" contract Milestone Sync and
  // Requirement Types use.
  const canSave =
    savedLinkedProjectsSnapshot !== null &&
    currentLinkedProjectsSnapshot !== null &&
    currentLinkedProjectsSnapshot !== savedLinkedProjectsSnapshot;

  const handleSaveSettings = async () => {
    setIsSaving(true);

    try {
      await updateProjectIntegration({
        where: {
          id: projectIntegration.id,
        },
        data: {
          config,
        },
      });

      if (currentLinkedProjectsSnapshot !== null) {
        setSavedLinkedProjectsSnapshot(currentLinkedProjectsSnapshot);
      }
      toast.success(t("integration.settingsSaved"));
      router.refresh();
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error(t("integration.saveSettingsError"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAuthorize = () => {
    // Redirect to OAuth flow
    const params = new URLSearchParams({
      projectIntegrationId: projectIntegration.id,
      integrationId: integration.id.toString(),
      returnUrl: window.location.pathname,
    });

    window.location.href = `/api/integrations/oauth/${integration.provider.toLowerCase()}/auth?${params}`;
  };

  const handleSetDefault = async (id: string) => {
    try {
      // The single-default DB trigger (tpl_single_default_integrationproject)
      // clears the previous default for this integration atomically.
      await updateIntegrationProject({
        where: { id },
        data: { isDefault: true },
      });
    } catch (error) {
      console.error("Failed to set default project:", error);
      toast.error(t("integration.saveSettingsError"));
    }
  };

  const handleRemoveProject = async (id: string) => {
    try {
      const removedProject = integrationProjects?.find((ip) => ip.id === id);
      // Server action wraps the mapping deactivation in a transaction
      // and cascades to the parent ProjectIntegration + inbound webhook
      // when this is the last active mapping (the only path that can
      // strand an inbound webhook with a now-unassigned provider).
      const result = await removeIntegrationProjectMapping(id);
      if (!result.success) {
        toast.error(result.error ?? t("integration.saveSettingsError"));
        return;
      }
      setConfirmingRemoveId(null);
      // Server action bypasses ZenStack mutation hooks — invalidate
      // the React Query cache so parent's useFindManyProjectIntegration
      // and local IntegrationProject/WebhookConfig queries refetch.
      await queryClient.invalidateQueries({ queryKey: ["zenstack"] });
      if (result.inboundWebhookDeletedCount > 0) {
        await refetchInboundConfigs();
      }

      // If removed project was default and others remain, set first remaining as default
      if (removedProject?.isDefault) {
        const remaining = integrationProjects?.filter(
          (ip) => ip.id !== id && ip.isActive
        );
        if (remaining && remaining.length > 0) {
          await updateIntegrationProject({
            where: { id: remaining[0].id },
            data: { isDefault: true },
          });
        }
      }
    } catch (error) {
      console.error("Failed to remove project:", error);
      toast.error(t("integration.saveSettingsError"));
    }
  };

  // Requests cooperative cancellation of a running typed requirements import
  // for one mapping (#501/28-21, moved from requirements-config-settings.tsx
  // so the stop control lives on the same row as the Import button that
  // started the run).
  const handleConfirmStop = useCallback(async () => {
    if (!stopMappingId) return;
    setIsStopping(true);
    try {
      const res = await fetch(
        `/api/integrations/${integration.id}/requirements-import/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: projectIntegration.projectId,
            integrationProjectId: stopMappingId,
          }),
        }
      );
      if (res.status === 409) {
        toast.error(t("integration.requirementsConfig.importStopNotRunning"));
        setStopMappingId(null);
        return;
      }
      if (!res.ok) {
        throw new Error(t("integration.requirementsConfig.importFailed"));
      }
      toast.success(t("integration.requirementsConfig.importStopRequested"));
      setStopMappingId(null);
    } catch (e: any) {
      toast.error(
        e?.message || t("integration.requirementsConfig.importFailed")
      );
    } finally {
      setIsStopping(false);
    }
  }, [integration.id, projectIntegration.projectId, stopMappingId, t]);

  const handleAddProjects = async () => {
    if (selectedNewProjects.length === 0) return;
    setIsAddingProjects(true);

    try {
      const hasExistingLinkedProjects =
        integrationProjects && integrationProjects.length > 0;
      let isFirstProject = !hasExistingLinkedProjects;

      for (const project of selectedNewProjects) {
        await upsertIntegrationProject({
          where: {
            projectIntegrationId_externalProjectId: {
              projectIntegrationId: projectIntegration.id,
              externalProjectId: project.id,
            },
          },
          create: {
            projectIntegrationId: projectIntegration.id,
            externalProjectId: project.id,
            externalProjectKey: project.key,
            externalProjectName: project.name,
            isActive: true,
            isDefault: isFirstProject,
          },
          update: {
            isActive: true,
            isDefault: isFirstProject,
            externalProjectKey: project.key,
            externalProjectName: project.name,
          },
        });
        isFirstProject = false;
      }

      setSelectedNewProjects([]);
      setShowAddPanel(false);
    } catch (error: any) {
      console.error("Failed to add projects:", error);
      const message = error?.info?.message || error?.message || "Unknown error";
      toast.error(`${t("integration.saveSettingsError")}: ${message}`);
    } finally {
      setIsAddingProjects(false);
    }
  };

  // Projects that haven't been linked yet
  const availableToAdd = useMemo(() => {
    const linkedIds = new Set(
      integrationProjects?.map((ip) => ip.externalProjectId) || []
    );
    return externalProjects.filter((p) => !linkedIds.has(p.id));
  }, [externalProjects, integrationProjects]);

  // AsyncCombobox refetches whenever `fetchOptions` changes identity, so
  // fetchers must stay referentially stable across renders — an inline arrow
  // resets the dropdown to page 0 on every render and it can never load
  // more. The per-mapping issue-type fetchers live in a memoized map because
  // hooks can't be called inside the `integrationProjects?.map()` rows.
  const issueTypeFetchers = useMemo(() => {
    const fetchers = new Map<
      string,
      (
        query: string,
        page: number,
        pageSize: number
      ) => Promise<{ results: IssueType[]; total: number }>
    >();
    for (const ip of integrationProjects ?? []) {
      fetchers.set(ip.id, async (query, page, pageSize) => {
        try {
          const response = await fetch(
            `/api/integrations/${integration.id}/issue-types?projectKey=${encodeURIComponent(ip.externalProjectKey)}`
          );
          if (response.ok) {
            const data = await response.json();
            const issueTypes = data.issueTypes || [];
            const filtered = query
              ? issueTypes.filter((type: any) =>
                  type.name.toLowerCase().includes(query.toLowerCase())
                )
              : issueTypes;
            const start = page * pageSize;
            return {
              results: filtered.slice(start, start + pageSize),
              total: filtered.length,
            };
          }
        } catch (error) {
          console.error("Failed to fetch issue types:", error);
        }
        return { results: [], total: 0 };
      });
    }
    return fetchers;
  }, [integrationProjects, integration.id]);

  const fetchAddableExternalProjects = useCallback(
    async (query: string, page: number, pageSize: number) => {
      // Load external projects if not already loaded
      if (externalProjects.length === 0) {
        await loadExternalProjects();
      }
      const filtered = availableToAdd.filter(
        (p) =>
          !query ||
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.key.toLowerCase().includes(query.toLowerCase())
      );
      const start = page * pageSize;
      return {
        results: filtered.slice(start, start + pageSize),
        total: filtered.length,
      };
    },
    [externalProjects.length, loadExternalProjects, availableToAdd]
  );

  if (needsAuth) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("integration.authorizationRequired")}</CardTitle>
          <CardDescription>
            {t("integration.authorizationRequiredDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WarningAlert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              {t("integration.authorizationMessage")}
            </AlertDescription>
          </WarningAlert>
          <Button onClick={handleAuthorize} className="mt-4">
            {t("integration.authorizeIntegration", { name: integration.name })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("integration.integrationSettings", { name: integration.name })}
        </CardTitle>
        <CardDescription>
          {t("integration.integrationSettingsDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Show a simple message for SIMPLE_URL integrations */}
        {integration.provider === "SIMPLE_URL" && (
          <Alert>
            <AlertDescription>
              {t("integration.simpleUrlDescription")}
            </AlertDescription>
          </Alert>
        )}

        {/* Linked External Projects section for integrations that support it */}
        {integration.provider !== "SIMPLE_URL" && (
          <div className="space-y-4" data-testid="linked-projects-section">
            <div>
              <SectionTitle>{t("integration.linkedProjects")}</SectionTitle>
              <Text variant="subtitle">
                {t("integration.linkedProjectsDescription")}
              </Text>
            </div>

            <div className="space-y-3">
              {isLoadingLinkedProjects ? (
                <div className="space-y-2">
                  <div className="h-11 w-full animate-pulse rounded bg-muted" />
                  <div className="h-11 w-full animate-pulse rounded bg-muted" />
                  <div className="h-11 w-full animate-pulse rounded bg-muted" />
                </div>
              ) : !integrationProjects || integrationProjects.length === 0 ? (
                <div>
                  {!showAddPanel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddPanel(true);
                        if (externalProjects.length === 0) {
                          void loadExternalProjects();
                        }
                      }}
                    >
                      {t("integration.addProjects")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {integrationProjects?.map((ip) => (
                    <div
                      key={ip.id}
                      className="group rounded-md border px-3 py-2 space-y-2"
                      data-testid={`requirements-import-row-${ip.id}`}
                    >
                      <div className="flex items-center gap-2 min-h-[36px]">
                        <span className="flex-1 text-sm font-medium">
                          {ip.externalProjectName}
                        </span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {ip.externalProjectKey}
                        </Badge>

                        {/* Sync status badge */}
                        {ip.syncStatus === SYNC_STATUS.syncing && (
                          <Badge variant="secondary">
                            {t("integration.syncStatusSyncing")}
                          </Badge>
                        )}
                        {ip.syncStatus === SYNC_STATUS.cancelRequested && (
                          <Badge variant="secondary">
                            {t(
                              "integration.requirementsConfig.importStopRequested"
                            )}
                          </Badge>
                        )}
                        {ip.syncStatus === SYNC_STATUS.completed && (
                          <Badge className="bg-success text-success-foreground">
                            {t("integration.syncStatusCompleted")}
                          </Badge>
                        )}
                        {ip.syncStatus === SYNC_STATUS.cancelled && (
                          <Badge variant="outline">
                            {t(
                              "integration.requirementsConfig.importCancelled"
                            )}
                          </Badge>
                        )}
                        {ip.syncStatus === SYNC_STATUS.error && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="destructive">
                                {t("integration.syncStatusError")}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{ip.syncError}</TooltipContent>
                          </Tooltip>
                        )}

                        {/* Default star */}
                        {ip.isDefault ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Star className="h-4 w-4 fill-primary text-primary shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("integration.defaultIndicator")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => handleSetDefault(ip.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                aria-label={t("integration.setAsDefault")}
                              >
                                <Star className="h-4 w-4 text-muted-foreground" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("integration.setAsDefault")}
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {/* Import issues button */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              // `cancel-requested` counts as busy, the same
                              // way the poll interval above already treats
                              // it: the run is still winding down and the
                              // start route refuses it as already running,
                              // so an enabled button here only ever produces
                              // an error toast.
                              disabled={
                                ip.syncStatus === SYNC_STATUS.syncing ||
                                ip.syncStatus === SYNC_STATUS.cancelRequested
                              }
                              onClick={() =>
                                setImportRequest({
                                  initialIssueTypeIds:
                                    savedRequirementConfig.issueTypeIds,
                                  initialIssueTypeNames:
                                    savedRequirementConfig.issueTypeNames,
                                  target: {
                                    id: ip.id,
                                    name: ip.externalProjectName,
                                    key: ip.externalProjectKey,
                                  },
                                })
                              }
                              aria-label={t("integration.importIssues")}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("integration.importIssues")}
                          </TooltipContent>
                        </Tooltip>

                        {/* Stop button -- only while this mapping's import is
                            actually running (#501/28-21) */}
                        {ip.syncStatus === SYNC_STATUS.syncing && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setStopMappingId(ip.id)}
                            data-testid={`requirements-import-stop-${ip.id}`}
                          >
                            {t(
                              "integration.requirementsConfig.importStopAction"
                            )}
                          </Button>
                        )}

                        {/* Remove button */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="destructive"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={() => setConfirmingRemoveId(ip.id)}
                            >
                              <Trash className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("integration.removeProject")}
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {/* Per-project default issue type (Jira only) */}
                      {integration.provider === "JIRA" && (
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground whitespace-nowrap">
                            {t("integration.defaultIssueType")}
                          </Label>
                          <AsyncCombobox<IssueType>
                            value={
                              ip.defaultIssueType
                                ? {
                                    id: ip.defaultIssueType,
                                    name:
                                      ip.defaultIssueTypeName ||
                                      ip.defaultIssueType,
                                  }
                                : null
                            }
                            onValueChange={(value) => {
                              void updateIntegrationProject({
                                where: { id: ip.id },
                                data: {
                                  defaultIssueType: value?.id || null,
                                  defaultIssueTypeName: value?.name || null,
                                },
                              });
                            }}
                            fetchOptions={issueTypeFetchers.get(ip.id)!}
                            renderOption={(type) => type.name}
                            getOptionValue={(type) => type.id}
                            placeholder={t(
                              "integration.selectDefaultIssueType"
                            )}
                            className="flex-1 max-w-xs h-8 text-xs"
                            dropdownClassName="p-0 min-w-[250px] max-w-[350px]"
                          />
                        </div>
                      )}

                      {/* Inline remove confirmation */}
                      {confirmingRemoveId === ip.id && (
                        <div className="p-3 bg-muted rounded-md text-sm space-y-2">
                          <p>{t("integration.removeProjectConfirmation")}</p>
                          {isLastActiveMapping && hasInboundWebhook && (
                            <ul className="list-disc ps-5 text-muted-foreground">
                              <li>
                                {t(
                                  "integration.removeProjectWebhookCascadeBullet"
                                )}
                              </li>
                            </ul>
                          )}
                          <div className="flex gap-2">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleRemoveProject(ip.id)}
                            >
                              {t("integration.confirmRemove", {
                                name: integration.name,
                              })}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmingRemoveId(null)}
                            >
                              {t("integration.keepProject")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add Projects panel toggle */}
              {!showAddPanel &&
                integrationProjects &&
                integrationProjects.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowAddPanel(true);
                      if (externalProjects.length === 0) {
                        void loadExternalProjects();
                      }
                    }}
                  >
                    {t("integration.addProjects")}
                  </Button>
                )}

              {/* Add Projects inline panel */}
              {showAddPanel && (
                <div
                  className="border rounded-md p-3 space-y-3"
                  data-testid="add-projects-panel"
                >
                  <MultiAsyncCombobox<ExternalProject>
                    value={selectedNewProjects}
                    onValueChange={setSelectedNewProjects}
                    fetchOptions={fetchAddableExternalProjects}
                    renderOption={(project) => (
                      <span>
                        {project.name}{" "}
                        <span className="text-muted-foreground">
                          {"("}
                          {project.key}
                          {")"}
                        </span>
                      </span>
                    )}
                    getOptionValue={(project) => project.id}
                    getOptionLabel={(project) =>
                      `${project.name} (${project.key})`
                    }
                    placeholder={t("integration.addProjects")}
                    hideSelected
                  />

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddProjects}
                      disabled={
                        selectedNewProjects.length === 0 || isAddingProjects
                      }
                    >
                      {isAddingProjects ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t("integration.addSelected")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddPanel(false);
                        setSelectedNewProjects([]);
                      }}
                    >
                      {tGlobal("common.cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Automatic sync via webhooks is not yet implemented - hiding this option
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="syncEnabled"
                    checked={config.syncEnabled || false}
                    onCheckedChange={(checked) =>
                      setConfig({ ...config, syncEnabled: !!checked })
                    }
                  />
                  <Label
                    htmlFor="syncEnabled"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {t("integration.automaticSync")}
                  </Label>
                  <HelpPopover helpKey="projects.settings.integrations.automaticSyncHelp" />
                </div>
              </div>
              */}

            <div className="flex justify-end">
              <Button
                onClick={handleSaveSettings}
                disabled={isSaving || !canSave}
                aria-label={tGlobal("admin.notifications.save")}
                className="group gap-0 transition-all duration-200 hover:gap-2"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                  {tGlobal("admin.notifications.save")}
                </span>
              </Button>
            </div>
          </div>
        )}

        <MilestoneSyncSettings
          projectIntegration={projectIntegration}
          integration={integration}
        />

        <RequirementsConfigSettings
          projectIntegration={projectIntegration}
          integration={integration}
          onRequestImport={setImportRequest}
        />

        <ImportIssuesDialog
          integrationId={integration.id}
          projectId={projectIntegration.projectId}
          target={importRequest?.target ?? null}
          open={importRequest !== null}
          onOpenChange={(open) => {
            if (!open) setImportRequest(null);
          }}
          onStarted={() => {
            void refetchIntegrationProjects();
          }}
          initialIssueTypeIds={importRequest?.initialIssueTypeIds}
          initialIssueTypeNames={importRequest?.initialIssueTypeNames}
        />

        <AlertDialog
          open={stopMappingId !== null}
          onOpenChange={(open) => {
            if (!open) setStopMappingId(null);
          }}
        >
          <AlertDialogContent data-testid="requirements-import-stop-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("integration.requirementsConfig.importStopConfirmTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("integration.requirementsConfig.importStopConfirmBody")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                type="button"
                onClick={() => setStopMappingId(null)}
              >
                {tGlobal("common.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                disabled={isStopping}
                onClick={(e) => {
                  e.preventDefault();
                  void handleConfirmStop();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="requirements-import-stop-confirm"
              >
                {t("integration.requirementsConfig.importStopAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
