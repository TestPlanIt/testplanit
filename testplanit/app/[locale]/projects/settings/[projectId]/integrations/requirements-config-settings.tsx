"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { Switch } from "@/components/ui/switch";
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

interface RequirementsConfigSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
}

interface IssueType {
  id: string;
  name: string;
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

  // Mapped tracker projects — the union issue-type fetcher's data source.
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
    { enabled: isRequirementTypeCapable(integration.provider) }
  );

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

  if (!isRequirementTypeCapable(integration.provider)) {
    return null;
  }

  const handleSave = async () => {
    setIsSaving(true);
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
    </div>
  );
}
