"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Integration } from "~/zenstack/models";
import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

interface AuthorizeIntegrationButtonProps {
  integration: Integration;
  /**
   * When true, render an invisible, non-interactive button that occupies the
   * exact same footprint as the real one, so the remaining action icons stay
   * aligned on rows where authorization doesn't apply.
   */
  placeholder?: boolean;
}

/**
 * Row action that starts the per-user OAuth (3LO) authorization for an
 * integration that is configured but not yet connected. It uses the generic
 * OAuth route, which only needs an integrationId (no project assignment); the
 * callback stores the user's token and flips the integration to ACTIVE.
 */
export function AuthorizeIntegrationButton({
  integration,
  placeholder = false,
}: AuthorizeIntegrationButtonProps) {
  const t = useTranslations("admin.integrations");

  const handleAuthorize = () => {
    const params = new URLSearchParams({
      integrationId: integration.id.toString(),
    });
    window.location.href = `/api/integrations/oauth/${integration.provider.toLowerCase()}/auth?${params.toString()}`;
  };

  // Reserve the slot with the same Button + icon (identical size) but hidden
  // and inert, so action icons line up across rows that don't show Authorize.
  if (placeholder) {
    return (
      <Button
        variant="ghost"
        className="px-2 py-1 h-auto invisible pointer-events-none"
        aria-hidden="true"
        tabIndex={-1}
      >
        <ShieldCheck className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          onClick={handleAuthorize}
          className="px-2 py-1 h-auto text-warning-foreground"
        >
          <ShieldCheck className="h-4 w-4" />
          <span className="sr-only">{t("authorize")}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t("authorizeHint")}</p>
      </TooltipContent>
    </Tooltip>
  );
}
