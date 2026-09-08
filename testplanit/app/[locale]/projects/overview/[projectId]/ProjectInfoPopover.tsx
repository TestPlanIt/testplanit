"use client";

import { DateFormatter } from "@/components/DateFormatter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Projects } from "~/zenstack/models";

interface ProjectInfoPopoverProps {
  project: Projects;
  dateFormat?: string;
  side?: "left" | "right" | "top" | "bottom";
}

/**
 * A help-popover-styled trigger that reveals this project's at-a-glance
 * metadata (id, status, key dates) as an aligned label/value grid. Mirrors
 * HelpPopover's affordance but renders dynamic project data — including live,
 * user-preference-aware DateFormatter values a static help string can't express.
 */
export function ProjectInfoPopover({
  project,
  dateFormat,
  side = "bottom",
}: ProjectInfoPopoverProps) {
  const t = useTranslations();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ms-2 inline-flex"
          aria-label={t("common.aria.help")}
        >
          <HelpCircle className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} className="w-auto">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t("common.fields.id")}</dt>
          <dd className="font-medium text-foreground text-end">{project.id}</dd>

          <dt className="text-muted-foreground">
            {t("common.actions.status")}
          </dt>
          <dd className="font-medium text-foreground text-end">
            {project.isCompleted
              ? t("common.fields.completed")
              : t("common.fields.isActive")}
          </dd>

          <dt className="text-muted-foreground">
            {t("common.fields.created")}
          </dt>
          <dd className="font-medium text-foreground text-end">
            <DateFormatter
              date={project.createdAt}
              formatString={dateFormat}
              tooltip={false}
            />
          </dd>

          {project.completedAt && (
            <>
              <dt className="text-muted-foreground">
                {t("common.fields.completedOn")}
              </dt>
              <dd className="font-medium text-foreground text-end">
                <DateFormatter
                  date={project.completedAt}
                  formatString={dateFormat}
                  tooltip={false}
                />
              </dd>
            </>
          )}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
