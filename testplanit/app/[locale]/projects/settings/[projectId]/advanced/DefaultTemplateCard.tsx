"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DefaultTemplateBadge } from "@/components/DefaultTemplateBadge";
import { TemplateNameDisplay } from "@/components/TemplateNameDisplay";
import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WarningAlert } from "@/components/ui/warning-alert";
import { SettingLabel } from "./SettingRow";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

const SYSTEM_DEFAULT = "system";

/**
 * Picks the template new test cases and sessions in the project start with.
 * Rendered as a row of the Advanced page's General section (no card of its
 * own). Saved as soon as it changes. A default that has since been disabled,
 * deleted or unassigned stays selected and is flagged, so re-enabling it
 * restores it.
 */
export function DefaultTemplateCard({
  projectId,
  defaultTemplateId,
  disabled,
}: {
  projectId: number;
  defaultTemplateId: number | null | undefined;
  disabled: boolean;
}) {
  const t = useTranslations();
  const updateProject = useClientQueries(schema).projects.useUpdate();

  // The project's usable templates, plus its configured default even when it
  // no longer is (keep-current convention).
  const { data: templates } = useClientQueries(schema).templates.useFindMany(
    {
      where: {
        OR: [
          {
            isDeleted: false,
            isEnabled: true,
            projects: { some: { projectId } },
          },
          ...(defaultTemplateId != null ? [{ id: defaultTemplateId }] : []),
        ],
      },
      select: {
        id: true,
        templateName: true,
        isDefault: true,
        isEnabled: true,
        isDeleted: true,
        projects: { where: { projectId }, select: { projectId: true } },
      },
      orderBy: { templateName: "asc" },
    },
    // Saving a new default changes the query; keep the options meanwhile.
    {
      enabled: defaultTemplateId !== undefined,
      placeholderData: keepPreviousData,
    }
  );

  const isUsable = (template: NonNullable<typeof templates>[number]) =>
    template.isEnabled && !template.isDeleted && template.projects.length > 0;
  const configuredDefault =
    defaultTemplateId != null
      ? templates?.find((template) => template.id === defaultTemplateId)
      : undefined;
  const unavailableDefault =
    configuredDefault && !isUsable(configuredDefault)
      ? configuredDefault
      : undefined;

  const handleChange = async (value: string) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: {
          defaultTemplateId: value === SYSTEM_DEFAULT ? null : Number(value),
        },
      });
      toast.success(t("common.messages.projectUpdated"));
    } catch {
      toast.error(t("common.messages.projectUpdateError"));
    }
  };

  return (
    <div data-testid="default-template-card" className="space-y-2">
      <SettingLabel
        htmlFor="default-template-select"
        label={t("projects.settings.quickScript.exportTemplates.defaultLabel")}
        description={t(
          "projects.settings.advanced.defaultTemplate.description"
        )}
      />
      <Select
        value={
          defaultTemplateId != null ? String(defaultTemplateId) : SYSTEM_DEFAULT
        }
        onValueChange={handleChange}
        disabled={disabled || updateProject.isPending || !templates}
      >
        <SelectTrigger
          id="default-template-select"
          className="w-80 max-w-full"
          data-testid="default-template-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SYSTEM_DEFAULT}>
            {t("projects.settings.aiModels.useSystemDefault")}
          </SelectItem>
          {(templates ?? []).map((template) => (
            <SelectItem
              key={template.id}
              value={String(template.id)}
              disabled={!isUsable(template)}
            >
              <span className="flex items-center gap-1">
                <TemplateNameDisplay name={template.templateName} size="sm" />
                {template.isDefault && <DefaultTemplateBadge source="system" />}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {unavailableDefault && (
        <WarningAlert data-testid="default-template-unavailable-warning">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>
            {t("projects.settings.advanced.defaultTemplate.unavailableTitle")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "projects.settings.advanced.defaultTemplate.unavailableDescription",
              { name: unavailableDefault.templateName }
            )}
          </AlertDescription>
        </WarningAlert>
      )}
    </div>
  );
}
