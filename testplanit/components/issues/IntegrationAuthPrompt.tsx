"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

interface IntegrationAuthPromptProps {
  integrationId: number;
  integrationName: string;
  integrationType: string;
}

export function IntegrationAuthPrompt({
  integrationId,
  integrationName,
  integrationType,
}: IntegrationAuthPromptProps) {
  const t = useTranslations("components.issues.integration_auth_prompt");

  const handleConnect = () => {
    const authUrl = `/api/integrations/oauth/${integrationType.toLowerCase()}/auth?integrationId=${integrationId}`;
    window.open(authUrl, "_blank", "width=600,height=700");
  };

  return (
    <Alert>
      <AlertDescription className="space-y-3">
        <p>{t("description", { integrationName })}</p>
        <Button onClick={handleConnect} variant="outline" size="sm">
          <ExternalLink className="w-4 h-4 " />
          {t("connectButton")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
