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
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  LABEL_MODE_PROVIDERS,
  isIssueTypeCapable,
  useTrackerIssueTypes,
  type TrackerIssueType,
} from "@/components/integrations/useTrackerIssueTypes";
import {
  diffRequirementTypeIds,
  effectiveRequirementTypeIds,
  readRequirementTypeConfig,
  type RequirementTypeConfig,
} from "~/lib/integrations/requirementTypeConfig";

/** The target/preselection shape the shared ImportIssuesDialog (28-20)
 *  accepts -- opening it is now the caller's job, not this component's. */
interface ImportRequest {
  target: { id: string; name: string; key: string };
  initialIssueTypeIds: string[];
  initialIssueTypeNames: Record<string, string>;
}

interface RequirementsConfigSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
  /** Opens the single, shared import dialog (28-20) -- this section no
   *  longer owns its own per-mapping import buttons or consent dialog. */
  onRequestImport: (request: ImportRequest) => void;
}

type IssueType = TrackerIssueType;

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
  onRequestImport,
}: RequirementsConfigSettingsProps) {
  const t = useTranslations("projects.settings.integrations.integration");
  const tGlobal = useTranslations();
  const queryClient = useQueryClient();

  // Mapped tracker projects — the union issue-type fetcher's data source,
  // and the list an import runs against, one row per active mapping.
  const { mappings, fetchIssueTypes } = useTrackerIssueTypes(
    projectIntegration.projectId,
    integration
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

  // Label mode (GitHub, Gitea): the selections are label names, matched
  // against `Issue.data->'labels'` server-side. The three impact-preview
  // counts below are keyed on the `issueTypeId` COLUMN, which is NULL on
  // every label-classified row — running them would preview a confident
  // zero for a save that reclassifies plenty, so label mode disables them
  // and renders a plain-language note instead.
  const labelMode = LABEL_MODE_PROVIDERS.has(integration.provider);

  const { data: becomingCount } = useClientQueries(schema).issue.useCount(
    {
      where: {
        projectId,
        issueTypeId: { in: diff.added },
        isRequirement: false,
        isDeleted: false,
      },
    },
    { enabled: !labelMode && diff.added.length > 0 }
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
    { enabled: !labelMode && diff.removed.length > 0 }
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
    { enabled: !labelMode && diff.removed.length > 0 }
  );

  if (!isIssueTypeCapable(integration.provider)) {
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
      // mapping to import into. Opens the single, shared import dialog
      // (28-20) -- this section no longer manages its own consent flow.
      if (addedTypesAtSaveTime.length > 0 && (mappings?.length ?? 0) > 0) {
        const mapping = mappings![0];
        onRequestImport({
          target: {
            id: mapping.id,
            name: mapping.externalProjectName || mapping.externalProjectKey,
            key: mapping.externalProjectKey,
          },
          initialIssueTypeIds: issueTypeIds,
          initialIssueTypeNames: issueTypeNames,
        });
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
          {labelMode
            ? t("requirementsConfig.labelsLabel")
            : t("requirementsConfig.issueTypesLabel")}
        </Label>
        <MultiAsyncCombobox<IssueType>
          value={selected}
          onValueChange={setSelected}
          fetchOptions={fetchIssueTypes}
          renderOption={(issueType) => <span>{issueType.name}</span>}
          getOptionValue={(issueType) => issueType.id}
          getOptionLabel={(issueType) => issueType.name}
          placeholder={
            labelMode
              ? t("requirementsConfig.labelsPlaceholder")
              : t("requirementsConfig.issueTypesPlaceholder")
          }
          ariaLabel={
            labelMode
              ? t("requirementsConfig.labelsAriaLabel")
              : t("requirementsConfig.issueTypesAriaLabel")
          }
          disabled={!enabled || isSaving}
        />
      </div>

      {hasChanges ? (
        <div className="space-y-1">
          <Label className="text-sm text-muted-foreground">
            {t("requirementsConfig.previewHeading")}
          </Label>
          {labelMode ? (
            <p className="text-sm">
              {t("requirementsConfig.labelPreviewNote")}
            </p>
          ) : (
            <>
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
            </>
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
