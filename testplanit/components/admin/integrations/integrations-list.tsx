"use client";

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
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Integration, ProjectIntegration } from "~/zenstack/models";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import {
  removeProjectIntegration,
  switchProjectIntegration,
} from "~/app/actions/project-integration";
import { IntegrationIcon } from "./integration-icon";

interface IntegrationsListProps {
  integrations: Integration[];
  projectId: number;
  currentIntegration?: ProjectIntegration & { integration: Integration };
}

export function IntegrationsList({
  integrations,
  projectId,
  currentIntegration,
}: IntegrationsListProps) {
  const t = useTranslations("projects.settings.integrations");
  const tAiModels = useTranslations("projects.settings.aiModels");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isAssigning, setIsAssigning] = useState<number | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const [integrationToAssign, setIntegrationToAssign] = useState<number | null>(
    null
  );

  // Conditional bullet in the Remove + Switch dialogs: shown only when an
  // inbound webhook actually exists for the project. Cheap query — same
  // shape the webhooks page uses, dedupes via React Query when both mount.
  const { data: inboundConfigs } = useClientQueries(schema).webhookConfig.useFindMany({
    where: { projectId, direction: "INBOUND" },
    select: { id: true },
  });
  const hasInboundWebhook = (inboundConfigs?.length ?? 0) > 0;

  const { data: linkedProjects } = useClientQueries(schema).integrationProject.useFindMany(
    {
      where: {
        projectIntegrationId: currentIntegration?.id ?? "",
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { externalProjectName: "asc" }],
    },
    {
      enabled: !!currentIntegration?.id,
    }
  );

  const handleAssignIntegrationClick = (integrationId: number) => {
    // If there's already an active integration, show warning dialog
    if (currentIntegration) {
      setIntegrationToAssign(integrationId);
      setShowSwitchDialog(true);
    } else {
      // No current integration, proceed directly
      void handleAssignIntegration(integrationId);
    }
  };

  const handleAssignIntegration = async (integrationId: number) => {
    setIsAssigning(integrationId);
    setShowSwitchDialog(false);

    try {
      // Server action wraps deactivate + upsert + (conditional) inbound
      // webhook hard-delete in a single transaction. Cascades when the
      // provider changes — locks the inbound adapter to the new provider.
      const result = await switchProjectIntegration({
        projectId,
        integrationId,
      });
      if (!result.success) {
        toast.error(result.error ?? t("integrationAssignError"));
        return;
      }
      // Server action bypasses ZenStack mutation hooks, so the React
      // Query cache (used by parent's useFindManyProjectIntegration +
      // local useClientQueries(schema).webhookConfig.useFindMany) doesn't auto-invalidate. Wide
      // invalidation under the `["zenstack"]` prefix refreshes all
      // related ZenStack-generated queries in one shot.
      await queryClient.invalidateQueries({ queryKey: ["zenstack"] });
      toast.success(t("integrationAssigned"));
      router.refresh();
    } catch (error) {
      console.error("Failed to assign integration:", error);
      toast.error(t("integrationAssignError"));
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
      // Server action wraps the ProjectIntegration delete + inbound
      // webhook hard-delete in a single transaction.
      const result = await removeProjectIntegration(currentIntegration.id);
      if (!result.success) {
        toast.error(result.error ?? t("integrationRemoveError"));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["zenstack"] });
      toast.success(t("integrationRemoved"));
      router.refresh();
    } catch (error) {
      console.error("Failed to remove integration:", error);
      toast.error(t("integrationRemoveError"));
    } finally {
      setIsAssigning(null);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {integrations.map((integration) => {
        const isActive = currentIntegration?.integrationId === integration.id;
        const isDimmed = !isActive && !!currentIntegration;

        return (
          <Card
            key={integration.id}
            className={`flex flex-col h-full ${
              isActive
                ? "border-primary ring-2 ring-primary/20"
                : isDimmed
                  ? "bg-muted-foreground/10"
                  : ""
            }`}
          >
            <CardHeader
              className={`flex flex-row items-center justify-between space-y-0 pb-2${isDimmed ? " opacity-70" : ""}`}
            >
              <CardTitle className="text-base font-medium">
                {integration.name}
              </CardTitle>
              {isActive && (
                <Badge variant="default" className="ml-auto">
                  {tCommon("fields.isActive")}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="grow space-y-3">
              <div
                className={`flex items-start gap-3${isDimmed ? " opacity-70" : ""}`}
              >
                <IntegrationIcon
                  provider={integration.provider}
                  platform={
                    typeof integration.settings === "object" &&
                    integration.settings !== null &&
                    "platform" in integration.settings
                      ? String(integration.settings.platform)
                      : undefined
                  }
                  className="h-10 w-10"
                />
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    {(typeof integration.settings === "object" &&
                    integration.settings !== null &&
                    "description" in integration.settings
                      ? String(integration.settings.description)
                      : null) ||
                      t(
                        `add.${integration.provider.toLowerCase()}.description` as any
                      )}
                  </p>
                </div>
              </div>
              {isActive &&
                integration.provider !== "SIMPLE_URL" &&
                linkedProjects &&
                linkedProjects.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("integration.linkedProjects")}
                    </p>
                    <ul className="space-y-1">
                      {linkedProjects.map((lp) => (
                        <li
                          key={lp.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Badge variant="outline" className="text-xs shrink-0">
                            {lp.externalProjectKey}
                          </Badge>
                          <span className="truncate">
                            {lp.externalProjectName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </CardContent>
            <CardFooter>
              <div className="flex gap-2 w-full">
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
                    onClick={() => handleAssignIntegrationClick(integration.id)}
                    disabled={isAssigning === integration.id}
                  >
                    {isAssigning === integration.id ? (
                      <Loader2 className=" h-4 w-4 animate-spin" />
                    ) : (
                      <Check className=" h-4 w-4" />
                    )}
                    {tCommon("actions.assign")}
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>
        );
      })}

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("integration.removeIntegration")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {t("integration.confirmRemove", {
                  name: currentIntegration?.integration.name || "",
                })}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">
                  {t("integration.removeWarningTitle")}
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t("integration.removeWarning1")}</li>
                  <li>{t("integration.removeWarning2")}</li>
                  <li>{t("integration.removeWarning3")}</li>
                  {hasInboundWebhook && (
                    <li>{t("integration.removeWarning4")}</li>
                  )}
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
              {t("integration.removeIntegration")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showSwitchDialog} onOpenChange={setShowSwitchDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("integration.switchIntegration")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {tAiModels("confirmSwitch", {
                  from: currentIntegration?.integration.name || "",
                  to:
                    integrations.find((i) => i.id === integrationToAssign)
                      ?.name || "",
                })}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium">
                  {t("integration.switchWarningTitle")}
                </p>
                <ul className="list-disc pl-5 space-y-1 text-destructive">
                  <li>{t("integration.switchWarning1")}</li>
                  <li>{t("integration.switchWarning2")}</li>
                  <li>{t("integration.switchWarning3")}</li>
                  {hasInboundWebhook && (
                    <li>{t("integration.switchWarning4")}</li>
                  )}
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
              className="bg-destructive text-destructive-foreground hover:bg-warning/90"
            >
              {t("integration.switchIntegration")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
