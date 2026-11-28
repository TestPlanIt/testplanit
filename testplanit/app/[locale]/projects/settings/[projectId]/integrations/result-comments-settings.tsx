"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionTitle, Text } from "@/components/ui/typography";
import type { Integration, ProjectIntegration } from "~/zenstack/models";
import { Loader2, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { providerDisplayName } from "~/lib/integrations/providerDisplayName";
import {
  readResultCommentsConfig,
  supportsResultComments,
} from "~/lib/integrations/resultCommentsConfig";

interface ResultCommentsSettingsProps {
  projectIntegration: ProjectIntegration;
  integration: Integration;
}

/**
 * The project's switch for posting a completed run's results on the tracker
 * issues the run covers. Shown for connections that can post with no user
 * present.
 */
export function ResultCommentsSettings({
  projectIntegration,
  integration,
}: ResultCommentsSettingsProps) {
  const t = useTranslations("projects.settings.integrations.integration");
  const tGlobal = useTranslations();

  const { mutateAsync: updateProjectIntegration } =
    useClientQueries(schema).projectIntegration.useUpdate();

  const saved = readResultCommentsConfig(projectIntegration.config).enabled;
  // The pending choice, held until Save; null follows the saved value.
  const [choice, setChoice] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!supportsResultComments(integration)) {
    return null;
  }

  const enabled = choice ?? saved;
  const hasChanges = enabled !== saved;

  const handleSave = async () => {
    setIsSaving(true);
    const rawConfig = (projectIntegration.config as Record<string, any>) || {};
    try {
      await updateProjectIntegration({
        where: { id: projectIntegration.id },
        data: {
          config: {
            ...rawConfig,
            resultComments: { enabled },
          } as Record<string, any>,
        },
      });
      setChoice(null);
      toast.success(t("settingsSaved"));
    } catch (error) {
      console.error("Failed to save result comment settings:", error);
      toast.error(t("saveSettingsError"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="space-y-4 border-t pt-6"
      data-testid="result-comments-section"
    >
      <div>
        <SectionTitle>{t("resultComments.title")}</SectionTitle>
        <Text variant="subtitle">
          {t("resultComments.description", {
            provider: providerDisplayName(integration.provider),
          })}
        </Text>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="resultCommentsEnabled"
          checked={enabled}
          onCheckedChange={setChoice}
          disabled={isSaving}
        />
        <Label htmlFor="resultCommentsEnabled">
          {t("resultComments.enableLabel")}
        </Label>
      </div>

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
