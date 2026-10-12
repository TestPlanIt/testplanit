"use client";

import {
  issueTypesFromSaved,
  savedIssueTypes,
  useTrackerIssueTypes,
  useTrackerStatuses,
  type TrackerIssueType,
} from "@/components/integrations/useTrackerIssueTypes";
import { HelpPopover } from "@/components/ui/help-popover";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { Switch } from "@/components/ui/switch";
import { ValuesInput } from "@/components/ui/values-input";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import {
  readWebhookActionFilter,
  type WebhookActionFilter,
} from "~/lib/webhooks/actions/schemas";
import { readRequirementTypeConfig } from "~/lib/integrations/requirementTypeConfig";
import { schema } from "~/zenstack/schema";

export interface TrackerFilterDraft {
  statuses: string[];
  issueTypes: TrackerIssueType[];
  labels: string[];
  requirementsOnly: boolean;
}

export function trackerFilterDraftFrom(saved: unknown): TrackerFilterDraft {
  const filter = readWebhookActionFilter(saved);
  return {
    statuses: filter.statuses ?? [],
    issueTypes: issueTypesFromSaved(
      filter.issueTypeIds ?? [],
      filter.issueTypeNames
    ),
    labels: filter.labels ?? [],
    requirementsOnly: filter.requirementsOnly === true,
  };
}

export function trackerFilterFromDraft(
  draft: TrackerFilterDraft
): WebhookActionFilter {
  return {
    statuses: draft.statuses,
    ...savedIssueTypes(draft.issueTypes),
    labels: draft.labels,
    requirementsOnly: draft.requirementsOnly,
  };
}

interface Props {
  projectId: number;
  integration: { id: number; provider: string } | null;
  value: TrackerFilterDraft;
  onChange: (next: TrackerFilterDraft) => void;
}

/**
 * Which tracker issues a rule acts on: statuses (the tracker's own list,
 * the ones this project's issues already have, or typed), issue types from
 * the tracker, labels, and, when the project classifies requirements,
 * requirements only. Empty means any.
 */
export function WebhookActionTrackerFilter({
  projectId,
  integration,
  value,
  onChange,
}: Props) {
  const t = useTranslations("projects.settings.webhooks.actions");
  const tCommon = useTranslations("common");
  const tMatrix = useTranslations("projects.matrix");
  const tRequirements = useTranslations(
    "projects.settings.integrations.integration.requirementsConfig"
  );
  const tIssues = useTranslations("issues");

  const { data: knownStatuses } = useClientQueries(schema).issue.useFindMany({
    where: {
      projectId,
      isDeleted: false,
      externalStatus: { not: null },
      ...(integration ? { integrationId: integration.id } : {}),
    },
    distinct: ["externalStatus"],
    orderBy: { externalStatus: "asc" },
    select: { externalStatus: true },
    take: 200,
  });
  const { data: trackerStatuses } = useTrackerStatuses(projectId, integration);
  // The tracker's own statuses first, then any stored issue has that the
  // tracker didn't list (an older workflow, another tracker project).
  const statusNames = useMemo(() => {
    const byName = new Map<string, string>();
    for (const status of [
      ...(trackerStatuses ?? []),
      ...(knownStatuses ?? []).map((row) => row.externalStatus),
    ]) {
      if (status && !byName.has(status.toLowerCase())) {
        byName.set(status.toLowerCase(), status);
      }
    }
    return [...byName.values()];
  }, [trackerStatuses, knownStatuses]);

  // The typed text is offered too, so a status no stored issue has yet
  // can still be chosen.
  const fetchStatuses = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const search = query.trim();
      const matches = statusNames.filter((status) =>
        status.toLowerCase().includes(search.toLowerCase())
      );
      const all =
        search && !matches.some((s) => s.toLowerCase() === search.toLowerCase())
          ? [search, ...matches]
          : matches;
      const start = page * pageSize;
      return { results: all.slice(start, start + pageSize), total: all.length };
    },
    [statusNames]
  );

  const { capable, labelMode, fetchIssueTypes } = useTrackerIssueTypes(
    projectId,
    integration
  );

  // Issues are only classified as requirements when the project has
  // requirements on and its integration says which types are requirements;
  // otherwise "requirements only" would match nothing.
  const queries = useClientQueries(schema);
  const { data: project } = queries.projects.useFindUnique({
    where: { id: projectId },
    select: { requirementsEnabled: true },
  });
  const { data: projectIntegration } = queries.projectIntegration.useFindFirst(
    {
      where: {
        projectId,
        integrationId: integration?.id ?? -1,
        isActive: true,
      },
      select: { config: true },
    },
    { enabled: Boolean(integration) }
  );
  const requirementsAvailable =
    project?.requirementsEnabled === true &&
    readRequirementTypeConfig(projectIntegration?.config).enabled;

  const update = (next: Partial<TrackerFilterDraft>) =>
    onChange({ ...value, ...next });

  return (
    <div className="space-y-3" data-testid="webhook-action-tracker-filter">
      <div className="text-sm font-medium">{tCommon("ui.search.filters")}</div>
      <div className="space-y-1.5">
        <Label>{tCommon("labels.statuses")}</Label>
        <MultiAsyncCombobox<string>
          value={value.statuses}
          onValueChange={(statuses) => update({ statuses })}
          fetchOptions={fetchStatuses}
          renderOption={(status) => status}
          getOptionValue={(status) => status}
          getOptionLabel={(status) => status}
          placeholder={tMatrix("filterStatusPlaceholder")}
          ariaLabel={tCommon("labels.statuses")}
          hideSelectAll
        />
      </div>
      {capable && !labelMode && (
        <div className="space-y-1.5">
          <Label>{tRequirements("issueTypesLabel")}</Label>
          <MultiAsyncCombobox<TrackerIssueType>
            value={value.issueTypes}
            onValueChange={(issueTypes) => update({ issueTypes })}
            fetchOptions={fetchIssueTypes}
            renderOption={(type) => type.name}
            getOptionValue={(type) => type.id}
            getOptionLabel={(type) => type.name}
            placeholder={tRequirements("issueTypesPlaceholder")}
            ariaLabel={tRequirements("issueTypesLabel")}
            hideSelectAll
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="inline-flex items-center">
          {tRequirements("labelsLabel")}
          <HelpPopover helpKey="webhookAction.labels" />
        </Label>
        <ValuesInput
          values={value.labels}
          onChange={(labels) => update({ labels })}
          placeholder={tIssues("addLabel")}
          ariaLabel={tRequirements("labelsLabel")}
          testIdPrefix="webhook-action-labels"
        />
      </div>
      {(requirementsAvailable || value.requirementsOnly) && (
        <Label className="flex items-start gap-3">
          <Switch
            checked={value.requirementsOnly}
            onCheckedChange={(requirementsOnly: boolean) =>
              update({ requirementsOnly })
            }
            data-testid="webhook-action-requirements-only"
          />
          <span className="space-y-0.5">
            <span className="block font-medium">{t("requirementsOnly")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("requirementsOnlyHelp")}
            </span>
          </span>
        </Label>
      )}
    </div>
  );
}
