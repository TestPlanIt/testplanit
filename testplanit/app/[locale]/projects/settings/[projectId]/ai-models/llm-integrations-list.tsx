"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  LlmIntegration,
  ProjectLlmIntegration,
  LlmProviderConfig,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Check,
  Loader2,
  AlertTriangle,
  DollarSign,
  Zap,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useCreateProjectLlmIntegration,
  useUpdateProjectLlmIntegration,
  useDeleteProjectLlmIntegration,
} from "~/lib/hooks";

type LlmIntegrationWithConfig = LlmIntegration & {
  llmProviderConfig: LlmProviderConfig | null;
};

type ProjectLlmIntegrationWithLlm = ProjectLlmIntegration & {
  llmIntegration: LlmIntegrationWithConfig;
};

interface LlmIntegrationsListProps {
  integrations: LlmIntegrationWithConfig[];
  projectId: number;
  currentIntegration?: ProjectLlmIntegrationWithLlm;
}

export function LlmIntegrationsList({
  integrations,
  projectId,
  currentIntegration,
}: LlmIntegrationsListProps) {
  const t = useTranslations("projects.settings.aiModels");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [isAssigning, setIsAssigning] = useState<number | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const [integrationToAssign, setIntegrationToAssign] = useState<number | null>(
    null
  );

  // ZenStack hooks
  const { mutateAsync: createProjectLlmIntegration } =
    useCreateProjectLlmIntegration();
  const { mutateAsync: updateProjectLlmIntegration } =
    useUpdateProjectLlmIntegration();
  const { mutateAsync: deleteProjectLlmIntegration } =
    useDeleteProjectLlmIntegration();

  const handleAssignIntegrationClick = (integrationId: number) => {
    // If there's already an active LLM integration, show warning dialog
    if (currentIntegration) {
      setIntegrationToAssign(integrationId);
      setShowSwitchDialog(true);
    } else {
      // No current integration, proceed directly
      handleAssignIntegration(integrationId);
    }
  };

  const handleAssignIntegration = async (llmIntegrationId: number) => {
    setIsAssigning(llmIntegrationId);
    setShowSwitchDialog(false);

    try {
      if (currentIntegration) {
        // Update existing integration
        await updateProjectLlmIntegration({
          where: { id: currentIntegration.id },
          data: {
            llmIntegrationId,
            isActive: true,
          },
        });
      } else {
        // Create new integration
        await createProjectLlmIntegration({
          data: {
            projectId,
            llmIntegrationId,
            isActive: true,
          },
        });
      }

      toast.success(t("modelAssigned"));
      // ZenStack will automatically invalidate hooks - no manual refresh needed
    } catch (error) {
      console.error("Failed to assign LLM integration:", error);
      toast.error(t("modelAssignError"));
    } finally {
      setIsAssigning(null);
      setIntegrationToAssign(null);
    }
  };

  const handleRemoveIntegration = async () => {
    if (!currentIntegration) return;

    setIsAssigning(-1); // Use -1 to indicate removal
    setShowRemoveDialog(false);

    try {
      await deleteProjectLlmIntegration({
        where: { id: currentIntegration.id },
      });

      toast.success(t("modelRemoved"));
      // ZenStack will automatically invalidate hooks - no manual refresh needed
    } catch (error) {
      console.error("Failed to remove LLM integration:", error);
      toast.error(t("modelRemoveError"));
    } finally {
      setIsAssigning(null);
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      // Temporarily disabled for testing
      // case "OPENAI":
      //   return <Brain className="h-5 w-5 text-green-600" />;
      // case "ANTHROPIC":
      //   return <Sparkles className="h-5 w-5 text-orange-600" />;
      // case "AZURE_OPENAI":
      //   return <Zap className="h-5 w-5 text-blue-600" />;
      case "GEMINI":
        return <Sparkles className="h-5 w-5 text-blue-500" />;
      case "OLLAMA":
        return <Sparkles className="h-5 w-5 text-purple-600" />;
      case "CUSTOM_LLM":
        return <Brain className="h-5 w-5 text-gray-600" />;
      default:
        return <Sparkles className="h-5 w-5 text-gray-600" />;
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      // Temporarily disabled for testing
      // case "OPENAI":
      //   return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      // case "ANTHROPIC":
      //   return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      // case "AZURE_OPENAI":
      //   return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "GEMINI":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "OLLAMA":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "CUSTOM_LLM":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  return (
    <TooltipProvider>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const isActive =
            currentIntegration?.llmIntegrationId === integration.id;
          const config = integration.llmProviderConfig;

          return (
            <Card
              key={integration.id}
              className={
                isActive ? "border-primary ring-2 ring-primary/20" : ""
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {getProviderIcon(integration.provider)}
                    <CardTitle className="text-base font-medium">
                      {integration.name}
                    </CardTitle>
                  </div>
                  {isActive && (
                    <Badge variant="default" className="ml-auto">
                      {tCommon("fields.isActive")}
                    </Badge>
                  )}
                </div>
                <Badge
                  variant="secondary"
                  className={`w-fit ${getProviderColor(integration.provider)}`}
                >
                  {integration.provider.replace("_", " ")}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {config && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {t("model")}:
                      </span>
                      <span className="font-medium">{config.defaultModel}</span>
                    </div>

                    {config.monthlyBudget &&
                      Number(config.monthlyBudget) > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            <DollarSign className="inline h-3 w-3" />{" "}
                            {t("budget")}:
                          </span>
                          <span className="font-medium">
                            {t("currency.dollar")}
                            {Number(config.monthlyBudget).toFixed(2)}
                            {t("currency.perMonth")}
                          </span>
                        </div>
                      )}

                    <div className="flex items-center gap-2">
                      {config.streamingEnabled && (
                        <Tooltip>
                          <TooltipTrigger type="button">
                            <Badge variant="outline" className="text-xs">
                              <Zap className="h-3 w-3 mr-1" />
                              {tGlobal("admin.llm.streaming")}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("streamingTooltip")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {config.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          {t("systemDefault")}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  {isActive ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowRemoveDialog(true)}
                      disabled={isAssigning === -1}
                    >
                      {isAssigning === -1 ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        tCommon("actions.remove")
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        handleAssignIntegrationClick(integration.id)
                      }
                      disabled={isAssigning === integration.id}
                    >
                      {isAssigning === integration.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4 mr-2" />
                      )}
                      {t("useForProject")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("removeModel")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {t("confirmRemove", {
                  name: currentIntegration?.llmIntegration.name || "",
                })}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">{t("removeWarningTitle")}</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t("removeWarning1")}</li>
                  <li>{t("removeWarning2")}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveIntegration}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("removeModel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showSwitchDialog} onOpenChange={setShowSwitchDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {t("switchModel")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {t("confirmSwitch", {
                  from: currentIntegration?.llmIntegration.name || "",
                  to:
                    integrations.find((i) => i.id === integrationToAssign)
                      ?.name || "",
                })}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">{t("switchWarningTitle")}</p>
                <ul className="list-disc pl-5 space-y-1 text-warning">
                  <li>{t("switchWarning1")}</li>
                  <li>{t("switchWarning2")}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                integrationToAssign &&
                handleAssignIntegration(integrationToAssign)
              }
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              {t("switchModel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
