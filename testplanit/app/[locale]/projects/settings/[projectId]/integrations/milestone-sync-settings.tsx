"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Integration, ProjectIntegration } from "~/zenstack/models";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
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

export function MilestoneSyncSettings({
  projectIntegration,
  integration,
}: MilestoneSyncSettingsProps) {
  const t = useTranslations("projects.settings.integrations.integration");
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

  const config = useMemo(() => {
    const raw = (projectIntegration.config as Record<string, any>) || {};
    const milestoneSync: Partial<MilestoneSyncConfig> = raw.milestoneSync ?? {};
    return {
      ...DEFAULT_CONFIG,
      ...milestoneSync,
    } as MilestoneSyncConfig;
  }, [projectIntegration.config]);

  if (!isMilestoneSyncCapable(integration.provider)) {
    return null;
  }

  const persist = async (next: MilestoneSyncConfig) => {
    const rawConfig = (projectIntegration.config as Record<string, any>) || {};
    try {
      await updateProjectIntegration({
        where: { id: projectIntegration.id },
        data: {
          config: {
            ...rawConfig,
            milestoneSync: next,
          } as Record<string, any>,
        },
      });
      toast.success(t("milestoneSync.settingsSaved"));
    } catch (error) {
      console.error("Failed to save milestone sync settings:", error);
      toast.error(t("milestoneSync.saveError"));
    }
  };

  // Drop the persisted auto-track baseline so the worker's next pass
  // re-baselines against what exists at THIS moment — "newly created"
  // always means "since auto-track (re-)enabled".
  const clearBaseline = ({
    autoTrackBaseline: _drop,
    ...rest
  }: MilestoneSyncConfig): MilestoneSyncConfig => rest;

  const handleEnableToggle = (checked: boolean) => {
    const next: MilestoneSyncConfig = {
      ...(checked && config.autoTrack ? clearBaseline(config) : config),
      enabled: checked,
      // Attribution: record the admin who enabled sync so auto-added
      // milestones are attributed to them, not whoever's page-load later
      // triggers the auto-track pass.
      ...(checked && session?.user?.id
        ? { autoTrackAdminId: session.user.id }
        : {}),
    };
    void persist(next);
  };

  const handleKindToggle = (kind: MilestoneKind, checked: boolean) => {
    const kinds = checked
      ? Array.from(new Set([...config.kinds, kind]))
      : config.kinds.filter((k) => k !== kind);
    // Kind changes alter auto-track's scope — re-baseline so a newly
    // enabled kind's existing artifacts aren't backfilled as "new".
    void persist({ ...clearBaseline(config), kinds });
  };

  const handleAutoTrackToggle = (checked: boolean) => {
    void persist({
      ...(checked ? clearBaseline(config) : config),
      autoTrack: checked,
      ...(checked && session?.user?.id
        ? { autoTrackAdminId: session.user.id }
        : {}),
    });
  };

  const handleProjectScanToggle = (
    externalProjectId: string,
    checked: boolean
  ) => {
    const current = new Set(config.autoTrackExcludedExternalProjectIds ?? []);
    if (checked) {
      current.delete(externalProjectId);
    } else {
      current.add(externalProjectId);
    }
    // Scanned-projects changes alter auto-track's scope — re-baseline so a
    // re-included project's existing artifacts aren't backfilled as "new".
    void persist({
      ...clearBaseline(config),
      autoTrackExcludedExternalProjectIds: Array.from(current),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("milestoneSync.title")}</CardTitle>
        <CardDescription>{t("milestoneSync.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch
            id="milestoneSyncEnabled"
            checked={config.enabled}
            onCheckedChange={handleEnableToggle}
          />
          <Label htmlFor="milestoneSyncEnabled">
            {t("milestoneSync.enableLabel")}
          </Label>
        </div>

        {config.enabled && (
          <>
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                {t("milestoneSync.kindsLabel")}
              </Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="milestoneSyncKindRelease"
                  checked={config.kinds.includes("RELEASE")}
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
                  checked={config.kinds.includes("ITERATION")}
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
                checked={config.autoTrack}
                onCheckedChange={handleAutoTrackToggle}
              />
              <Label htmlFor="milestoneSyncAutoTrack">
                {t("milestoneSync.autoTrackLabel")}
              </Label>
            </div>

            {config.autoTrack && (mappings?.length ?? 0) > 0 && (
              <div className="space-y-2 ps-8">
                <Label className="text-sm text-muted-foreground">
                  {t("milestoneSync.autoTrackProjectsLabel")}
                </Label>
                {(mappings ?? []).map((mapping) => {
                  const included = !(
                    config.autoTrackExcludedExternalProjectIds ?? []
                  ).includes(mapping.externalProjectId);
                  return (
                    <div key={mapping.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`milestoneSyncScanProject-${mapping.id}`}
                        checked={included}
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
      </CardContent>
    </Card>
  );
}
