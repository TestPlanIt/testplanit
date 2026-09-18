"use client";

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
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, Loader2, PinOff, SearchCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { isStalePinCheckAbandoned, readStalePinReport } from "./stalePinReport";

export interface ImpactStalePinConnection {
  id: number;
  repositoryId: number;
  stalePinReport?: unknown;
  repository: { name: string };
}

interface ImpactStalePinButtonsProps {
  config: ImpactStalePinConnection;
  /** Pins the last check flagged that a cleanup would remove. */
  staleCount: number;
  /** Reloads the connection and its stale count after a request. */
  onChanged: () => Promise<unknown>;
}

/**
 * Check for Stale Pins / Remove Stale Pins for one Impact connection, as
 * shown on the settings page cards. The check runs in the repo-cache
 * worker; the page's polling follows its report, so the buttons only need
 * to send the requests.
 */
export function ImpactStalePinButtons({
  config,
  staleCount,
  onChanged,
}: ImpactStalePinButtonsProps) {
  const t = useTranslations("projects.settings.impact.stalePins");
  const tCommon = useTranslations("common");
  const tRepo = useTranslations("projects.settings.codeRepository");

  const [checkRequested, setCheckRequested] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = readStalePinReport(config.stalePinReport);
  const running =
    view.kind === "running" && !isStalePinCheckAbandoned(view.progress);

  const handleCheck = async () => {
    setCheckRequested(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/code-repositories/${config.repositoryId}/stale-pins/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectConfigId: config.id }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error ?? t("checkFailedToStart"));
        return;
      }
      toast.info(t("checkStarted"));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tRepo("networkError"));
    } finally {
      setCheckRequested(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/code-repositories/${config.repositoryId}/stale-pins/remove`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectConfigId: config.id }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error ?? t("removeFailed"));
        return;
      }
      toast.success(t("removed", { count: Number(data.removed ?? 0) }));
      setConfirmOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : tRepo("networkError"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={handleCheck}
              disabled={checkRequested || running}
              aria-label={t("check")}
              className={collapsibleActionClass()}
              data-testid={`impact-repo-stale-check-${config.id}`}
            >
              <ActionButtonContent
                icon={checkRequested || running ? Loader2 : SearchCheck}
                iconClassName={
                  checkRequested || running
                    ? "h-4 w-4 shrink-0 animate-spin"
                    : "h-4 w-4 shrink-0"
                }
                label={t("check")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("checkHint")}</TooltipContent>
        </Tooltip>
        {staleCount > 0 && !running && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmOpen(true)}
                disabled={removing}
                aria-label={t("remove")}
                className={collapsibleActionClass(
                  undefined,
                  "text-destructive"
                )}
                data-testid={`impact-repo-stale-remove-${config.id}`}
              >
                <ActionButtonContent
                  icon={removing ? Loader2 : PinOff}
                  iconClassName={
                    removing
                      ? "h-4 w-4 shrink-0 animate-spin"
                      : "h-4 w-4 shrink-0"
                  }
                  label={t("remove")}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("remove")}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {error && (
        <p
          className="text-xs text-destructive"
          data-testid={`impact-repo-stale-error-${config.id}`}
        >
          {error}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {t("remove")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild className="space-y-2">
              <div>
                <p>
                  {t("removeConfirm", {
                    count: staleCount,
                    name: config.repository.name,
                  })}
                </p>
                <p>{t("removeConfirmNote")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog open until the request settles.
                event.preventDefault();
                void handleRemove();
              }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`impact-repo-stale-remove-confirm-${config.id}`}
            >
              {removing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PinOff className="h-4 w-4" />
              )}
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
