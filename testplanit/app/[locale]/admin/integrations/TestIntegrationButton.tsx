"use client";

import { useTranslations } from "next-intl";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Integration } from "@prisma/client";

interface TestIntegrationButtonProps {
  integration: Integration;
  onTest: (integration: Integration) => void;
}

export function TestIntegrationButton({ integration, onTest }: TestIntegrationButtonProps) {
  const t = useTranslations("admin.integrations");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTest(integration)}
            className="h-8 w-8 p-0"
          >
            <Activity className="h-4 w-4" />
            <span className="sr-only">{t("testConnection")}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("testConnection")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
