"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LlmFeatureConfig, LlmIntegration, LlmProviderConfig, ProjectLlmIntegration } from "@prisma/client";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  useCreateLlmFeatureConfig,
  useDeleteLlmFeatureConfig,
  useFindManyLlmFeatureConfig,
  useUpdateLlmFeatureConfig,
} from "~/lib/hooks/llm-feature-config";
import { useFindManyPromptConfigPrompt } from "~/lib/hooks/prompt-config-prompt";
import { LLM_FEATURE_LABELS, LLM_FEATURES } from "~/lib/llm/constants";
import { getProviderColor, getProviderIcon } from "~/lib/llm/provider-styles";

type LlmIntegrationWithConfig = LlmIntegration & {
  llmProviderConfig: LlmProviderConfig | null;
};

type ProjectLlmIntegrationWithLlm = ProjectLlmIntegration & {
  llmIntegration: LlmIntegrationWithConfig;
};

interface FeatureOverridesProps {
  projectId: number;
  integrations: LlmIntegrationWithConfig[];
  projectDefaultIntegration?: ProjectLlmIntegrationWithLlm;
  promptConfigId: string | null;
}

type SourceType = "projectOverride" | "promptConfig" | "projectDefault" | "noLlmConfigured";

interface EffectiveResolution {
  integration: LlmIntegrationWithConfig | null;
  source: SourceType;
}

export function FeatureOverrides({
  projectId,
  integrations,
  projectDefaultIntegration,
  promptConfigId,
}: FeatureOverridesProps) {
  const t = useTranslations("projects.settings.aiModels.featureOverrides");
  const tCommon = useTranslations("common");

  const { data: featureConfigs } = useFindManyLlmFeatureConfig({
    where: { projectId },
    include: {
      llmIntegration: {
        include: { llmProviderConfig: true },
      },
    },
  });

  const { data: promptConfigPrompts } = useFindManyPromptConfigPrompt(
    {
      where: { promptConfigId: promptConfigId ?? undefined },
      include: {
        llmIntegration: {
          include: { llmProviderConfig: true },
        },
      },
    },
    { enabled: promptConfigId !== null }
  );

  const { mutateAsync: createFeatureConfig } = useCreateLlmFeatureConfig();
  const { mutateAsync: updateFeatureConfig } = useUpdateLlmFeatureConfig();
  const { mutateAsync: deleteFeatureConfig } = useDeleteLlmFeatureConfig();

  const getEffectiveResolution = (feature: string): EffectiveResolution => {
    const featureConfig = featureConfigs?.find((c) => c.feature === feature) as
      | (LlmFeatureConfig & { llmIntegration?: LlmIntegrationWithConfig | null })
      | undefined;

    if (featureConfig?.llmIntegrationId && featureConfig.llmIntegration) {
      return {
        integration: featureConfig.llmIntegration,
        source: "projectOverride",
      };
    }

    const promptPrompt = promptConfigPrompts?.find((p) => p.feature === feature) as
      | ({ llmIntegrationId?: number | null; llmIntegration?: LlmIntegrationWithConfig | null; feature: string })
      | undefined;

    if (promptPrompt?.llmIntegrationId && promptPrompt.llmIntegration) {
      return {
        integration: promptPrompt.llmIntegration,
        source: "promptConfig",
      };
    }

    if (projectDefaultIntegration?.llmIntegration) {
      return {
        integration: projectDefaultIntegration.llmIntegration,
        source: "projectDefault",
      };
    }

    return { integration: null, source: "noLlmConfigured" };
  };

  const handleOverrideChange = async (feature: string, integrationId: string) => {
    const existingConfig = featureConfigs?.find((c) => c.feature === feature);
    const selectedId = parseInt(integrationId);

    try {
      if (existingConfig) {
        await updateFeatureConfig({
          where: { id: existingConfig.id },
          data: { llmIntegrationId: selectedId },
        });
      } else {
        await createFeatureConfig({
          data: {
            projectId,
            feature,
            llmIntegrationId: selectedId,
            enabled: true,
          },
        });
      }
      toast.success(t("overrideSaved"));
    } catch (error) {
      console.error("Failed to save feature override:", error);
      toast.error(t("overrideError"));
    }
  };

  const handleClearOverride = async (feature: string) => {
    const existingConfig = featureConfigs?.find((c) => c.feature === feature);
    if (!existingConfig) return;

    try {
      await deleteFeatureConfig({ where: { id: existingConfig.id } });
      toast.success(t("overrideCleared"));
    } catch (error) {
      console.error("Failed to clear feature override:", error);
      toast.error(t("overrideError"));
    }
  };

  const getSourceBadge = (source: SourceType) => {
    switch (source) {
      case "projectOverride":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
            {t("projectOverride")}
          </Badge>
        );
      case "promptConfig":
        return (
          <Badge variant="secondary">
            {t("promptConfig")}
          </Badge>
        );
      case "projectDefault":
        return (
          <Badge variant="outline" className="text-muted-foreground">
            {tCommon("labels.access.projectDefault")}
          </Badge>
        );
      case "noLlmConfigured":
        return (
          <Badge variant="destructive">
            {t("noLlmConfigured")}
          </Badge>
        );
    }
  };

  const allFeatures = Object.values(LLM_FEATURES);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("feature")}</TableHead>
              <TableHead>{t("override")}</TableHead>
              <TableHead>{t("effectiveLlm")}</TableHead>
              <TableHead>{t("source")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allFeatures.map((feature) => {
              const featureConfig = featureConfigs?.find((c) => c.feature === feature);
              const currentOverrideId = (featureConfig as (LlmFeatureConfig & { llmIntegrationId?: number | null }) | undefined)?.llmIntegrationId;
              const { integration: effectiveIntegration, source } = getEffectiveResolution(feature);

              return (
                <TableRow key={feature}>
                  <TableCell className="font-medium">
                    {LLM_FEATURE_LABELS[feature]}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Select
                        value={currentOverrideId?.toString() ?? ""}
                        onValueChange={(val) => handleOverrideChange(feature, val)}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder={t("selectIntegration")} />
                        </SelectTrigger>
                        <SelectContent>
                          {integrations.map((integration) => (
                            <SelectItem
                              key={integration.id}
                              value={integration.id.toString()}
                            >
                              <div className="flex items-center gap-2">
                                {getProviderIcon(integration.provider)}
                                <span>{integration.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {featureConfig && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleClearOverride(feature)}
                          title={tCommon("actions.clear")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {effectiveIntegration ? (
                      <div className="flex items-center gap-2">
                        {getProviderIcon(effectiveIntegration.provider)}
                        <span>{effectiveIntegration.name}</span>
                        {effectiveIntegration.llmProviderConfig && (
                          <Badge
                            variant="secondary"
                            className={`text-xs ${getProviderColor(effectiveIntegration.provider)}`}
                          >
                            {effectiveIntegration.provider.replace("_", " ")}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {t("noLlmConfigured")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {getSourceBadge(source)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
