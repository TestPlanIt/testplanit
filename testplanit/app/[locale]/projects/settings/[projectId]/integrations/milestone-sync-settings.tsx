"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionTitle, Text } from "@/components/ui/typography";
import type { Integration, ProjectIntegration } from "~/zenstack/models";
import { Loader2, Save } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface MilestoneSyncSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
}

type MilestoneKind = "RELEASE" | "ITERATION";

interface MilestoneSyncConfig {
  enabled: boolean;
  kinds: MilestoneKind[];
  autoTrack: boolean;
  autoTrackAdminId?: string;
  /** Written by the sync worker on the first auto-track pass: the artifact
   *  ids that already existed when auto-track came on. Auto-track imports
   *  only artifacts OUTSIDE this baseline ("newly created"), so enabling it
   *  never backfills everything. Cleared here whenever auto-track's scope
   *  changes (flipped on, kinds changed, scanned projects changed) so the
   *  worker re-baselines at that moment. */
  autoTrackBaseline?: string[];
  /** Tracker projects opted OUT of new-milestone scanning. Absent/empty =
   *  scan every mapped project (the default — a mapping added later is
   *  included automatically). Keyed by the stable externalProjectId, not
   *  the renamable key. */
  autoTrackExcludedExternalProjectIds?: string[];
}

/**
 * Providers whose adapter declares a non-`false` `milestones` capability
 * (`IssueAdapterCapabilities.milestones`). Adapters run server-side only
 * (credentialed API clients), so this small client-safe map mirrors each
 * adapter's `getCapabilities()` return value rather than round-tripping to
 * the server just to learn a static, provider-determined fact. Source of
 * truth: `lib/integrations/adapters/*Adapter.ts` `getCapabilities()`.
 */
const MILESTONE_CAPABLE_PROVIDERS = new Set(["JIRA"]);

function isMilestoneSyncCapable(provider: string): boolean {
  return MILESTONE_CAPABLE_PROVIDERS.has(provider);
}

const DEFAULT_CONFIG: MilestoneSyncConfig = {
  enabled: false,
  kinds: ["RELEASE", "ITERATION"],
  autoTrack: true,
};

/** Order-independent comparison so re-adding then removing a kind (or an
 *  excluded project) doesn't read as a pending change just because array
 *  insertion order differs from the saved config. */
function normalizeForComparison(config: MilestoneSyncConfig) {
  return {
    enabled: config.enabled,
    kinds: [...config.kinds].sort(),
    autoTrack: config.autoTrack,
    autoTrackAdminId: config.autoTrackAdminId ?? null,
    autoTrackBaseline: config.autoTrackBaseline
      ? [...config.autoTrackBaseline].sort()
      : null,
    autoTrackExcludedExternalProjectIds: (
      config.autoTrackExcludedExternalProjectIds ?? []
    )
      .slice()
      .sort(),
  };
}

export function MilestoneSyncSettings({
  projectIntegration,
  integration,
}: MilestoneSyncSettingsProps) {
  const t = useTranslations("projects.settings.integrations.integration");
  const tGlobal = useTranslations();
  const { data: session } = useSession();

  const { mutateAsync: updateProjectIntegration } =
    useClientQueries(schema).projectIntegration.useUpdate();

  // Mapped tracker projects for the per-project auto-track opt-out list.
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
      },
    },
    { enabled: isMilestoneSyncCapable(integration.provider) }
  );

  const savedConfig = useMemo(() => {
    const raw = (projectIntegration.config as Record<string, any>) || {};
    const milestoneSync: Partial<MilestoneSyncConfig> = raw.milestoneSync ?? {};
    return {
      ...DEFAULT_CONFIG,
      ...milestoneSync,
    } as MilestoneSyncConfig;
  }, [projectIntegration.config]);

  // Pending edits held locally, committed only by an explicit Save — the
  // same deviation from the old persist-on-toggle pattern that
  // requirements-config-settings.tsx already uses. Every toggle below
  // updates `pending`; nothing reaches the server until Save is pressed.
  const [pending, setPending] = useState<MilestoneSyncConfig>(savedConfig);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed whenever the saved config identity changes — a successful save
  // re-reads ProjectIntegration and this reflects the newly-saved state
  // instead of leaving the section showing pre-save pending edits.
  useEffect(() => {
    setPending(savedConfig);
  }, [savedConfig]);

  if (!isMilestoneSyncCapable(integration.provider)) {
    return null;
  }

  const hasChanges =
    JSON.stringify(normalizeForComparison(pending)) !==
    JSON.stringify(normalizeForComparison(savedConfig));

  // Drop the persisted auto-track baseline so the worker's next pass
  // re-baselines against what exists at THIS moment — "newly created"
  // always means "since auto-track (re-)enabled".
  const clearBaseline = ({
    autoTrackBaseline: _drop,
    ...rest
  }: MilestoneSyncConfig): MilestoneSyncConfig => rest;

  const handleEnableToggle = (checked: boolean) => {
    setPending((current) => ({
      ...(checked && current.autoTrack ? clearBaseline(current) : current),
      enabled: checked,
      // Attribution: record the admin who enabled sync so auto-added
      // milestones are attributed to them, not whoever's page-load later
      // triggers the auto-track pass.
      ...(checked && session?.user?.id
        ? { autoTrackAdminId: session.user.id }
        : {}),
    }));
  };

  const handleKindToggle = (kind: MilestoneKind, checked: boolean) => {
    setPending((current) => {
      const kinds = checked
        ? Array.from(new Set([...current.kinds, kind]))
        : current.kinds.filter((k) => k !== kind);
      // Kind changes alter auto-track's scope — re-baseline so a newly
      // enabled kind's existing artifacts aren't backfilled as "new".
      return { ...clearBaseline(current), kinds };
    });
  };

  const handleAutoTrackToggle = (checked: boolean) => {
    setPending((current) => ({
      ...(checked ? clearBaseline(current) : current),
      autoTrack: checked,
      ...(checked && session?.user?.id
        ? { autoTrackAdminId: session.user.id }
        : {}),
    }));
  };

  const handleProjectScanToggle = (
    externalProjectId: string,
    checked: boolean
  ) => {
    setPending((current) => {
      const excluded = new Set(
        current.autoTrackExcludedExternalProjectIds ?? []
      );
      if (checked) {
        excluded.delete(externalProjectId);
      } else {
        excluded.add(externalProjectId);
      }
      // Scanned-projects changes alter auto-track's scope — re-baseline so a
      // re-included project's existing artifacts aren't backfilled as "new".
      return {
        ...clearBaseline(current),
        autoTrackExcludedExternalProjectIds: Array.from(excluded),
      };
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    const rawConfig = (projectIntegration.config as Record<string, any>) || {};
    try {
      await updateProjectIntegration({
        where: { id: projectIntegration.id },
        data: {
          config: {
            ...rawConfig,
            milestoneSync: pending,
          } as Record<string, any>,
        },
      });
      toast.success(t("milestoneSync.settingsSaved"));
    } catch (error) {
      console.error("Failed to save milestone sync settings:", error);
      toast.error(t("milestoneSync.saveError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="space-y-4 border-t pt-6"
      data-testid="milestone-sync-section"
    >
      <div>
        <SectionTitle>{t("milestoneSync.title")}</SectionTitle>
        <Text variant="subtitle">{t("milestoneSync.description")}</Text>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="milestoneSyncEnabled"
          checked={pending.enabled}
          onCheckedChange={handleEnableToggle}
          disabled={isSaving}
        />
        <Label htmlFor="milestoneSyncEnabled">
          {t("milestoneSync.enableLabel")}
        </Label>
      </div>

      {pending.enabled && (
        <>
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              {t("milestoneSync.kindsLabel")}
            </Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="milestoneSyncKindRelease"
                checked={pending.kinds.includes("RELEASE")}
                disabled={isSaving}
                onCheckedChange={(checked) =>
                  handleKindToggle("RELEASE", !!checked)
                }
              />
              <Label htmlFor="milestoneSyncKindRelease">
                {t("milestoneSync.releasesLabel")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="milestoneSyncKindIteration"
                checked={pending.kinds.includes("ITERATION")}
                disabled={isSaving}
                onCheckedChange={(checked) =>
                  handleKindToggle("ITERATION", !!checked)
                }
              />
              <Label htmlFor="milestoneSyncKindIteration">
                {t("milestoneSync.sprintsLabel")}
              </Label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="milestoneSyncAutoTrack"
              checked={pending.autoTrack}
              onCheckedChange={handleAutoTrackToggle}
              disabled={isSaving}
            />
            <Label htmlFor="milestoneSyncAutoTrack">
              {t("milestoneSync.autoTrackLabel")}
            </Label>
          </div>

          {pending.autoTrack && (mappings?.length ?? 0) > 0 && (
            <div className="space-y-2 ps-8">
              <Label className="text-sm text-muted-foreground">
                {t("milestoneSync.autoTrackProjectsLabel")}
              </Label>
              {(mappings ?? []).map((mapping) => {
                const included = !(
                  pending.autoTrackExcludedExternalProjectIds ?? []
                ).includes(mapping.externalProjectId);
                return (
                  <div key={mapping.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`milestoneSyncScanProject-${mapping.id}`}
                      checked={included}
                      disabled={isSaving}
                      onCheckedChange={(checked) =>
                        handleProjectScanToggle(
                          mapping.externalProjectId,
                          !!checked
                        )
                      }
                    />
                    <Label htmlFor={`milestoneSyncScanProject-${mapping.id}`}>
                      {mapping.externalProjectName ||
                        mapping.externalProjectKey}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
        </>
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
    </div>
  );
}
