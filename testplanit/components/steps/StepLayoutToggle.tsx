"use client";

import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Columns2, Rows2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { useStepLayout } from "~/hooks/useStepLayout";
import { cn } from "~/utils";

/**
 * Class names shared by every component that renders a step beside its
 * expected result. The pair only splits into two columns once the element
 * carrying `container` is at least the `@2xl` container width (42rem), so a
 * narrow docked panel or a laptop window stays stacked whatever the user chose.
 * Tailwind needs each class literally in source, so these are strings, not
 * templates.
 */
export const stepLayoutClasses = {
  container: "@container",
  pair: (sideBySide: boolean) =>
    sideBySide ? "grid grid-cols-1 @2xl:grid-cols-2" : "flex flex-col",
  // Each corner is set on its own so the two blocks read as one box: joined
  // top to bottom when stacked, start to end once side by side.
  stepBlock: (sideBySide: boolean) =>
    sideBySide
      ? "rounded-b-none @2xl:rounded-ss-lg @2xl:rounded-es-lg @2xl:rounded-se-none @2xl:rounded-ee-none"
      : "rounded-b-none",
  expectedBlock: (sideBySide: boolean) =>
    sideBySide
      ? "rounded-t-none @2xl:rounded-se-lg @2xl:rounded-ee-lg @2xl:rounded-ss-none @2xl:rounded-es-none"
      : "rounded-t-none",
  /** Something that only makes sense in the stacked rendering. */
  stackedOnly: (sideBySide: boolean) => (sideBySide ? "@2xl:hidden" : ""),
};

/**
 * Flips the user's step layout between stacked and side by side and saves the
 * choice. Hidden where the container is too narrow for two columns, since the
 * layout there is stacked regardless.
 */
export const StepLayoutToggle: React.FC<{ className?: string }> = ({
  className,
}) => {
  const t = useTranslations("repository.steps.layout");
  const { isSideBySide, toggleLayout } = useStepLayout();
  const Icon = isSideBySide ? Columns2 : Rows2;
  const current = isSideBySide ? t("sideBySide") : t("stacked");

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={isSideBySide}
            onPressedChange={() => void toggleLayout()}
            aria-label={t("label")}
            className={cn("hidden @2xl:inline-flex h-7 px-1.5", className)}
            data-testid="step-layout-toggle"
          >
            <Icon className="h-4 w-4" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          {t("label")}: {current}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
