"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DefaultTemplateSource } from "~/lib/defaultTemplate";

/** Star marking a project's default template, with which setting chose it. */
export function DefaultTemplateBadge({
  source,
}: {
  source: DefaultTemplateSource;
}) {
  const t = useTranslations();
  return (
    <Tooltip>
      <TooltipTrigger className="ms-1" asChild>
        <Badge
          variant="secondary"
          data-testid={`default-template-badge-${source}`}
        >
          <Star className="h-3 w-3 fill-current" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {source === "project"
          ? t("common.labels.access.projectDefault")
          : t("projects.settings.aiModels.systemDefault")}
      </TooltipContent>
    </Tooltip>
  );
}
