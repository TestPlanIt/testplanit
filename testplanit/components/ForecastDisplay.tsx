"use client";

import { DurationDisplay } from "@/components/DurationDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Bot, CloudSunRain } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React from "react";
import { type ClassValue } from "~/utils";
import { toHumanReadable } from "~/utils/duration";

interface ForecastDisplayProps {
  seconds: number | null | undefined;
  type?: "manual" | "automated" | "mixed";
  round?: boolean;
  className?: ClassValue;
}

export const ForecastDisplay: React.FC<ForecastDisplayProps> = ({
  seconds,
  type = "manual",
  className,
  round = true,
}) => {
  const tCommon = useTranslations("common");
  const locale = useLocale();

  if (seconds === null || seconds === undefined || seconds <= 0) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        className={`cursor-default flex items-center gap-1 min-w-0 ${className || ""}`}
      >
        {type === "manual" && (
          <CloudSunRain className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {type === "automated" && (
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {type === "mixed" && (
          <>
            <CloudSunRain className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate min-w-0">
          <DurationDisplay seconds={seconds} round={round} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex items-center gap-1">
          {tCommon("fields.forecast")}:{" "}
          {toHumanReadable(seconds, {
            isSeconds: true,
            locale,
            round,
          })}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
