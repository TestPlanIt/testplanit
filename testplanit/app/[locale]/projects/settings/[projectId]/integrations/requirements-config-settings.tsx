"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { Loader2, Save } from "lucide-react";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SectionTitle, Text } from "@/components/ui/typography";
import type { Integration, ProjectIntegration } from "~/zenstack/models";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  diffRequirementTypeIds,
  effectiveRequirementTypeIds,
  readRequirementTypeConfig,
  type RequirementTypeConfig,
} from "~/lib/integrations/requirementTypeConfig";
import { SYNC_STATUS } from "~/lib/integrations/syncStatus";

interface RequirementsConfigSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
}

interface IssueType {
  id: string;
  name: string;
}

interface RequirementImportMapping {
  id: string;
  externalProjectId: string;
  externalProjectKey: string;
  externalProjectName: string | null;
  syncStatus?: string | null;
  syncError?: string | null;
}

/** Per-mapping, keyed by `mapping.id` so two mappings' dialogs can never
 *  share state -- the same class of bug 25-20 closed on the requirement
 *  detail panel, where state outlived the thing it was about. */
interface ImportOfferState {
  preview: { matched: number; hasMore: boolean } | null;
  isPreviewing: boolean;
  error: string | null;
}

/**
 * Providers whose adapter implements `getIssueTypes` (verified by reading
 * lib/integrations/adapters/*Adapter.ts). Adapters run server-side only
 * (credentialed API clients), so this small client-safe set mirrors a
 * static, provider-determined fact rather than round-tripping to the
 * server just to learn it. Mirrors MilestoneSyncSettings' own
 * MILESTONE_CAPABLE_PROVIDERS shape and source-of-truth reasoning.
 */
const REQUIREMENT_TYPE_CAPABLE_PROVIDERS = new Set([
  "JIRA",
  "AZURE_DEVOPS",
  "GITLAB",
  "REDMINE",
  "MANTISBT",
]);

function isRequirementTypeCapable(provider: string): boolean {
  return REQUIREMENT_TYPE_CAPABLE_PROVIDERS.has(provider);
}

/** Saved chips render without a tracker round trip: seed from the stored
 *  ids plus the display-only issueTypeNames map. */
function seedSelectedIssueTypes(config: RequirementTypeConfig): IssueType[] {
  return config.issueTypeIds.map((id) => ({
    id,
    name: config.issueTypeNames?.[id] ?? id,
  }));
}

export function RequirementsConfigSettings({
  projectIntegration,
  integration,
}: RequirementsConfigSettingsProps) {
  const t = useTranslations("projects.settings.integrations.integration");
  const tGlobal = useTranslations();
  const queryClient = useQueryClient();

  // Mapped tracker projects — the union issue-type fetcher's data source,
  // and the list an import runs against, one row per active mapping.
  const { data: mappings } = useClientQueries(
    schema
  ).integrationProject.useFindMany(
    {
      where: {
        projectIntegration: {
          integrationId: projectIntegration.integrationId,
          projectId: projectIntegration.projectId,
        },
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        externalProjectId: true,
        externalProjectKey: true,
        externalProjectName: true,
        syncStatus: true,
        syncError: true,
      },
    },
    {
      enabled: isRequirementTypeCapable(integration.provider),
      // Mirrors project-integration-settings.tsx's own poll predicate
      // verbatim, extended to keep polling while a stop request is still in
      // flight -- that is exactly when the user is watching hardest.
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
  ) as { data: RequirementImportMapping[] | undefined };

  const savedConfig = useMemo(
    () => readRequirementTypeConfig(projectIntegration.config),
    [projectIntegration.config]
  );

  // Pending selection held locally, committed only by an explicit Save. The
  // deliberate deviation from milestoneSync's persist-on-toggle pattern: a
  // save here also reconciles existing rows, and that write must be atomic
  // with the config write (plan 22-03's route), so nothing here persists
  // until Save is pressed.
  const [enabled, setEnabled] = useState(savedConfig.enabled);
  const [selected, setSelected] = useState<IssueType[]>(() =>
    seedSelectedIssueTypes(savedConfig)
  );
  const [isSaving, setIsSaving] = useState(false);

  // The import offer/consent dialog, keyed by mapping id (see
  // ImportOfferState's own comment). `openImportMappingId` is which
  // mapping's dialog is currently visible; the state for every mapping ever
  // opened this session lives in `importOffers` so a late-resolving fetch
  // for a mapping the user has since closed can never leak into whichever
  // mapping's dialog is open now.
  const [importOffers, setImportOffers] = useState<
    Record<string, ImportOfferState>
  >({});
  const [openImportMappingId, setOpenImportMappingId] = useState<string | null>(
    null
  );
  const [isImportStarting, setIsImportStarting] = useState(false);

  // The stop-confirmation dialog targets one mapping id at a time.
  const [stopMappingId, setStopMappingId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  // Re-seed whenever the saved config identity changes — a successful save
  // re-reads ProjectIntegration and this reflects the newly-saved state
  // instead of leaving the card showing pre-save pending edits.
  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setSelected(seedSelectedIssueTypes(savedConfig));
  }, [savedConfig]);

  // AsyncCombobox-family components refetch whenever `fetchOptions` changes
  // identity (see project-integration-settings.tsx's issueTypeFetchers
  // comment) — an inline lambda here would cause a refetch loop.
  const fetchIssueTypes = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const byId = new Map<string, IssueType>();
      await Promise.all(
        (mappings ?? []).map(async (mapping) => {
          try {
            const response = await fetch(
              `/api/integrations/${integration.id}/issue-types?projectKey=${encodeURIComponent(mapping.externalProjectKey)}`
            );
            if (response.ok) {
              const data = await response.json();
              const issueTypes: IssueType[] = data.issueTypes || [];
              for (const issueType of issueTypes) {
                if (!byId.has(issueType.id)) {
                  byId.set(issueType.id, issueType);
                }
              }
            }
          } catch (error) {
            console.error("Failed to fetch issue types:", error);
          }
        })
      );
      const all = Array.from(byId.values());
      const filtered = query
        ? all.filter((issueType) =>
            issueType.name.toLowerCase().includes(query.toLowerCase())
          )
        : all;
      const start = page * pageSize;
      return {
        results: filtered.slice(start, start + pageSize),
        total: filtered.length,
      };
    },
    [mappings, integration.id]
  );

  // Deriving the diff from effectiveRequirementTypeIds (not the raw id
  // arrays) is what makes flipping the enable switch off show its real
  // impact: every configured type moves into `removed`.
  const diff = diffRequirementTypeIds(
    effectiveRequirementTypeIds(savedConfig),
    effectiveRequirementTypeIds({
      enabled,
      issueTypeIds: selected.map((issueType) => issueType.id),
    })
  );
  const hasChanges = diff.added.length > 0 || diff.removed.length > 0;

  const projectId = projectIntegration.projectId;

  const { data: becomingCount } = useClientQueries(schema).issue.useCount(
    {
      where: {
        projectId,
        issueTypeId: { in: diff.added },
        isRequirement: false,
        isDeleted: false,
      },
    },
    { enabled: diff.added.length > 0 }
  );

  const { data: stoppingCount } = useClientQueries(schema).issue.useCount(
    {
      where: {
        projectId,
        issueTypeId: { in: diff.removed },
        isRequirement: true,
        isDeleted: false,
      },
    },
    { enabled: diff.removed.length > 0 }
  );

  const { data: detachedOrLocalCount } = useClientQueries(
    schema
  ).issue.useCount(
    {
      where: {
        projectId,
        issueTypeId: { in: diff.removed },
        isRequirement: true,
        isDeleted: false,
        OR: [{ requirementDetachedAt: { not: null } }, { integrationId: null }],
      },
    },
    { enabled: diff.removed.length > 0 }
  );

  // The tracker-side count for the consent prompt -- deliberately NOT
  // `becomingCount` (a local-database reclassification count computed
  // above). That gap between "already in our DB" and "exists in the
  // tracker" is precisely what this phase exists to close.
  //
  // NOTE: every hook below (useCallback) MUST stay above the
  // `isRequirementTypeCapable` early return further down -- React's Rules of
  // Hooks forbid calling a hook after a conditional return.
  const openImportOffer = useCallback(
    async (mapping: RequirementImportMapping) => {
      setOpenImportMappingId(mapping.id);
      const typeIds = effectiveRequirementTypeIds(savedConfig);
      if (typeIds.length === 0) {
        setImportOffers((prev) => ({
          ...prev,
          [mapping.id]: {
            preview: null,
            isPreviewing: false,
            error: t("requirementsConfig.importNoTypes"),
          },
        }));
        return;
      }
      setImportOffers((prev) => ({
        ...prev,
        [mapping.id]: { preview: null, isPreviewing: true, error: null },
      }));
      try {
        const res = await fetch(
          `/api/integrations/${integration.id}/requirements-import/preview`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: projectIntegration.projectId,
              integrationProjectId: mapping.id,
            }),
          }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            data?.error || t("requirementsConfig.importCountUnavailable")
          );
        }
        if (data?.enabled === false) {
          setImportOffers((prev) => ({
            ...prev,
            [mapping.id]: {
              preview: null,
              isPreviewing: false,
              error: t("requirementsConfig.importNoTypes"),
            },
          }));
          return;
        }
        setImportOffers((prev) => ({
          ...prev,
          [mapping.id]: {
            preview: {
              matched: data?.matched ?? 0,
              hasMore: Boolean(data?.hasMore),
            },
            isPreviewing: false,
            error: null,
          },
        }));
      } catch (e: any) {
        setImportOffers((prev) => ({
          ...prev,
          [mapping.id]: {
            preview: null,
            isPreviewing: false,
            error: e?.message || t("requirementsConfig.importCountUnavailable"),
          },
        }));
      }
    },
    [integration.id, projectIntegration.projectId, savedConfig, t]
  );

  const closeImportOffer = useCallback(() => {
    setOpenImportMappingId(null);
  }, []);

  const handleConfirmImport = useCallback(
    async (mappingId: string) => {
      setIsImportStarting(true);
      try {
        const res = await fetch(
          `/api/integrations/${integration.id}/requirements-import`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: projectIntegration.projectId,
              integrationProjectId: mappingId,
            }),
          }
        );
        if (res.status === 409) {
          toast.error(t("requirementsConfig.importAlreadyRunning"));
          setOpenImportMappingId(null);
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || t("requirementsConfig.importFailed"));
        }
        toast.success(t("requirementsConfig.importStarted"));
        setOpenImportMappingId(null);
      } catch (e: any) {
        toast.error(e?.message || t("requirementsConfig.importFailed"));
      } finally {
        setIsImportStarting(false);
      }
    },
    [integration.id, projectIntegration.projectId, t]
  );

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
        toast.error(t("requirementsConfig.importStopNotRunning"));
        setStopMappingId(null);
        return;
      }
      if (!res.ok) {
        throw new Error(t("requirementsConfig.importFailed"));
      }
      toast.success(t("requirementsConfig.importStopRequested"));
      setStopMappingId(null);
    } catch (e: any) {
      toast.error(e?.message || t("requirementsConfig.importFailed"));
    } finally {
      setIsStopping(false);
    }
  }, [integration.id, projectIntegration.projectId, stopMappingId, t]);

  if (!isRequirementTypeCapable(integration.provider)) {
    return null;
  }

  const handleSave = async () => {
    setIsSaving(true);
    // Captured BEFORE the post-save cache invalidation: `diff` is derived
    // from `savedConfig`, and the invalidation below causes `savedConfig` to
    // re-read as the newly-saved value, at which point `diff.added` is
    // already empty. Reading `diff.added` again after the invalidation
    // would silently mean the offer never fires.
    const addedTypesAtSaveTime = diff.added;
    try {
      const issueTypeIds = selected.map((issueType) => issueType.id);
      const issueTypeNames = Object.fromEntries(
        selected.map((issueType) => [issueType.id, issueType.name])
      );
      const response = await fetch(
        `/api/integrations/${integration.id}/requirements-config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: projectIntegration.projectId,
            enabled,
            issueTypeIds,
            issueTypeNames,
          }),
        }
      );
      if (!response.ok) {
        throw new Error(
          `Requirements-config save failed with status ${response.status}`
        );
      }
      toast.success(t("requirementsConfig.settingsSaved"));
      await queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === "zenstack" &&
          query.queryKey[1] === "ProjectIntegration",
      });
      // The offer-on-save: only when this save just newly classified a type
      // (never on a removal-only save) and only when there is an active
      // mapping to import into.
      if (addedTypesAtSaveTime.length > 0 && (mappings?.length ?? 0) > 0) {
        void openImportOffer(mappings![0]);
      }
    } catch (error) {
      console.error("Failed to save requirements config:", error);
      toast.error(t("requirementsConfig.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="space-y-4 border-t pt-6"
      data-testid="requirements-config-section"
    >
      <div>
        <SectionTitle>{t("requirementsConfig.title")}</SectionTitle>
        <Text variant="subtitle">{t("requirementsConfig.description")}</Text>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="requirementsConfigEnabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={isSaving}
        />
        <Label htmlFor="requirementsConfigEnabled">
          {t("requirementsConfig.enableLabel")}
        </Label>
      </div>

      <div className="space-y-2">
        <Label className="text-sm text-muted-foreground">
          {t("requirementsConfig.issueTypesLabel")}
        </Label>
        <MultiAsyncCombobox<IssueType>
          value={selected}
          onValueChange={setSelected}
          fetchOptions={fetchIssueTypes}
          renderOption={(issueType) => <span>{issueType.name}</span>}
          getOptionValue={(issueType) => issueType.id}
          getOptionLabel={(issueType) => issueType.name}
          placeholder={t("requirementsConfig.issueTypesPlaceholder")}
          ariaLabel={t("requirementsConfig.issueTypesAriaLabel")}
          disabled={!enabled || isSaving}
        />
      </div>

      {hasChanges ? (
        <div className="space-y-1">
          <Label className="text-sm text-muted-foreground">
            {t("requirementsConfig.previewHeading")}
          </Label>
          {diff.added.length > 0 && (
            <p className="text-sm">
              {t("requirementsConfig.becomingRequirements", {
                count: becomingCount ?? 0,
              })}
            </p>
          )}
          {diff.removed.length > 0 && (
            <p className="text-sm">
              {t("requirementsConfig.stoppingRequirements", {
                count: stoppingCount ?? 0,
              })}
            </p>
          )}
          {(detachedOrLocalCount ?? 0) > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("requirementsConfig.detachedCallout", {
                count: detachedOrLocalCount ?? 0,
              })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("requirementsConfig.reversibilityNote")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("requirementsConfig.noChanges")}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => void handleSave()}
          disabled={!hasChanges || isSaving}
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

      {(mappings?.length ?? 0) > 0 && (
        <div
          className="space-y-2 border-t pt-4"
          data-testid="requirements-import-section"
        >
          <div>
            <Label className="text-sm font-medium">
              {t("requirementsConfig.importHeading")}
            </Label>
            <Text variant="subtitle">
              {t("requirementsConfig.importDescription")}
            </Text>
          </div>

          <div className="space-y-2">
            {mappings!.map((mapping) => {
              const name =
                mapping.externalProjectName || mapping.externalProjectKey;
              const isSyncing = mapping.syncStatus === SYNC_STATUS.syncing;
              const isCancelRequested =
                mapping.syncStatus === SYNC_STATUS.cancelRequested;
              const isCancelled = mapping.syncStatus === SYNC_STATUS.cancelled;
              const isError = mapping.syncStatus === SYNC_STATUS.error;
              const isCompleted = mapping.syncStatus === SYNC_STATUS.completed;

              return (
                <div
                  key={mapping.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                  data-testid={`requirements-import-row-${mapping.id}`}
                >
                  <div className="flex items-center gap-2 min-h-[28px]">
                    <span className="text-sm">{name}</span>
                    {isSyncing && (
                      <Badge variant="secondary">
                        {t("syncStatusSyncing")}
                      </Badge>
                    )}
                    {isCancelRequested && (
                      <Badge variant="secondary">
                        {t("requirementsConfig.importStopRequested")}
                      </Badge>
                    )}
                    {isCompleted && (
                      <Badge className="bg-success text-success-foreground">
                        {t("syncStatusCompleted")}
                      </Badge>
                    )}
                    {isCancelled && (
                      <Badge variant="outline">
                        {t("requirementsConfig.importCancelled")}
                      </Badge>
                    )}
                    {isError && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive">
                            {t("syncStatusError")}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{mapping.syncError}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isSyncing ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setStopMappingId(mapping.id)}
                        data-testid={`requirements-import-stop-${mapping.id}`}
                      >
                        {t("requirementsConfig.importStopAction")}
                      </Button>
                    ) : (
                      !isCancelRequested && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void openImportOffer(mapping)}
                          data-testid={`requirements-import-action-${mapping.id}`}
                        >
                          {t("requirementsConfig.importAction", { name })}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AlertDialog
        open={openImportMappingId !== null}
        onOpenChange={(open) => {
          if (!open) closeImportOffer();
        }}
      >
        <AlertDialogContent data-testid="requirements-import-offer-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("requirementsConfig.importOfferTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const offer = openImportMappingId
                  ? importOffers[openImportMappingId]
                  : undefined;
                if (offer?.isPreviewing || !offer) {
                  return tGlobal("common.loading");
                }
                if (offer.error) return offer.error;
                return t("requirementsConfig.importOfferBody", {
                  count: offer.preview?.matched ?? 0,
                });
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" onClick={closeImportOffer}>
              {t("requirementsConfig.importOfferDecline")}
            </AlertDialogCancel>
            {openImportMappingId &&
              importOffers[openImportMappingId]?.preview &&
              (importOffers[openImportMappingId]?.preview?.matched ?? 0) >
                0 && (
                <AlertDialogAction
                  type="button"
                  disabled={isImportStarting}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleConfirmImport(openImportMappingId);
                  }}
                  data-testid="requirements-import-offer-confirm"
                >
                  {t("requirementsConfig.importOfferConfirm")}
                </AlertDialogAction>
              )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={stopMappingId !== null}
        onOpenChange={(open) => {
          if (!open) setStopMappingId(null);
        }}
      >
        <AlertDialogContent data-testid="requirements-import-stop-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("requirementsConfig.importStopConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("requirementsConfig.importStopConfirmBody")}
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
              {t("requirementsConfig.importStopAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
