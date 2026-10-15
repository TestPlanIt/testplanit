"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useDeploymentWatcher } from "~/hooks/useDeploymentWatcher";

/**
 * App-wide notice that the server was redeployed under this tab. Reloading is
 * left to the user, since it drops whatever is unsaved on the page.
 */
export function UpdateAvailableBanner() {
  const t = useTranslations();
  const { updateAvailable, dismiss } = useDeploymentWatcher();

  // An open dialog or sheet closes on any pointerdown outside it, which would
  // discard the very form the user is in the middle of.
  const isolatePointerDown = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const stop = (event: Event) => event.stopPropagation();
    node.addEventListener("pointerdown", stop);
    return () => node.removeEventListener("pointerdown", stop);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      ref={isolatePointerDown}
      role="status"
      data-testid="update-available-banner"
      className="pointer-events-auto fixed inset-x-0 top-0 z-[60] border-b border-primary/20 bg-background shadow-md"
    >
      <div className="flex flex-wrap items-center justify-center gap-2 bg-primary/10 px-4 py-2 text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-foreground me-4">
          {t("common.version.updateAvailable")}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
          data-testid="update-available-reload"
        >
          {t("common.actions.refresh")}
        </Button>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground transition-colors ms-1"
          aria-label={t("common.dismiss")}
          data-testid="update-available-dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
