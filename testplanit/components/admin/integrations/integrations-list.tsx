"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Integration, ProjectIntegration } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { useRouter } from "~/lib/navigation";
import { toast } from "sonner";
import { IntegrationIcon } from "./integration-icon";
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
  useDeleteProjectIntegration,
  useUpsertProjectIntegration,
  useUpdateManyProjectIntegration,
} from "~/lib/hooks";

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
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isAssigning, setIsAssigning] = useState<number | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  const [integrationToAssign, setIntegrationToAssign] = useState<number | null>(
    null
  );

  const { mutateAsync: upsertProjectIntegration } =
    useUpsertProjectIntegration();
  const { mutateAsync: updateManyProjectIntegration } =
    useUpdateManyProjectIntegration();

  const handleAssignIntegrationClick = (integrationId: number) => {
    // If there's already an active integration, show warning dialog
    if (currentIntegration) {
      setIntegrationToAssign(integrationId);
      setShowSwitchDialog(true);
    } else {
      // No current integration, proceed directly
      handleAssignIntegration(integrationId);
    }
  };

  const handleAssignIntegration = async (integrationId: number) => {
    setIsAssigning(integrationId);
    setShowSwitchDialog(false);

    try {
      // First, deactivate any existing active integrations
      await updateManyProjectIntegration({
        where: {
          projectId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      // Upsert the project integration (create or update)
      await upsertProjectIntegration({
        where: {
          projectId_integrationId: {
            projectId,
            integrationId,
          },
        },
        create: {
          projectId,
          integrationId,
          isActive: true,
          config: {},
        },
        update: {
          isActive: true,
          config: {},
        },
      });

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

  const { mutateAsync: deleteProjectIntegration } =
    useDeleteProjectIntegration();

  const handleRemoveIntegration = async () => {
    if (!currentIntegration) return;

    setIsAssigning(-1); // Use -1 to indicate removal
    setShowRemoveDialog(false);

    try {
      await deleteProjectIntegration({
        where: {
          id: currentIntegration.id,
        },
      });

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

        return (
          <Card
            key={integration.id}
            className={`flex flex-col h-full ${isActive ? "border-primary" : ""}`}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-medium">
                {integration.name}
              </CardTitle>
              {isActive && (
                <Badge variant="default" className="ml-auto">
                  {t("active")}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="grow">
              <div className="flex items-start gap-3">
                <IntegrationIcon
                  provider={integration.provider}
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
                      t("remove")
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
                    {t("assign")}
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
                {t("integration.confirmSwitch", {
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
