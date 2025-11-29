"use client";

import React, { useEffect, useState } from "react";
import { useFindManySessionResults } from "~/lib/hooks";
import { toHumanReadable } from "~/utils/duration";
import { useTranslations, useLocale } from "next-intl";
import { Clock, Timer, ClockAlert, AlarmClockPlus } from "lucide-react";
import { cn, type ClassValue } from "~/utils";

interface ElapsedTimeProps {
  sessionId: number;
  className?: ClassValue;
  estimate?: number | null;
  textSize?: "xs" | "sm" | "md";
}

export function ElapsedTime({
  sessionId,
  className = "",
  estimate,
  textSize = "xs",
}: ElapsedTimeProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [totalElapsedSeconds, setTotalElapsedSeconds] = useState<number | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all session results for the given sessionId
  const { data: sessionResults, isLoading: isLoadingResults } =
    useFindManySessionResults({
      where: {
        sessionId: sessionId,
        isDeleted: false,
      },
      select: {
        elapsed: true,
      },
    });

  // Calculate the total elapsed time when session results are loaded
  useEffect(() => {
    if (sessionResults) {
      // Sum up all elapsed times (in seconds)
      const totalSeconds = sessionResults.reduce((total, result) => {
        // Only add if elapsed is not null
        return total + (result.elapsed || 0);
      }, 0);

      setTotalElapsedSeconds(totalSeconds > 0 ? totalSeconds : null);
      setIsLoading(false);
    }
  }, [sessionResults]);

  if (isLoading || isLoadingResults) {
    return (
      <div
        className={`flex items-center gap-1 text-sm text-muted-foreground ${className}`}
      >
        <Clock className="w-4 h-4 shrink-0" />
        {t("common.loading")}
      </div>
    );
  }

  if (totalElapsedSeconds === null) {
    return (
      <div
        className={cn(
          "flex items-center gap-1 text-muted-foreground",
          {
            "text-xs": textSize === "xs",
            "text-sm": textSize === "sm",
            "text-md": textSize === "md",
          },
          className
        )}
      >
        <Clock className="w-4 h-4 shrink-0" />
        {t("sessions.placeholders.noElapsedTime")}
      </div>
    );
  }

  // Convert seconds to milliseconds for toHumanReadable
  const humanReadableTime = toHumanReadable(totalElapsedSeconds, {
    isSeconds: true,
    locale,
  });

  // Calculate remaining time if estimate is provided
  const remainingSeconds = estimate ? estimate - totalElapsedSeconds : null;
  const isOvertime = remainingSeconds !== null && remainingSeconds < 0;
  const remainingTime = remainingSeconds
    ? toHumanReadable(Math.abs(remainingSeconds), {
        isSeconds: true,
        locale,
      })
    : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 text-muted-foreground",
        {
          "text-xs": textSize === "xs",
          "text-sm": textSize === "sm",
          "text-md": textSize === "md",
        },
        className
      )}
    >
      <div className="flex items-center gap-1">
        <Timer className="w-4 h-4 shrink-0" />
        <span>
          {t("sessions.labels.totalElapsed")}: {humanReadableTime}
        </span>
      </div>
      {estimate && (
        <div
          className={`flex items-center gap-1 ${isOvertime ? "text-destructive" : "text-muted-foreground"}`}
        >
          {isOvertime ? (
            <ClockAlert className="w-4 h-4 shrink-0" />
          ) : (
            <AlarmClockPlus className="w-4 h-4 shrink-0" />
          )}
          <span>
            {isOvertime
              ? t("sessions.labels.overtime", { time: remainingTime ?? "" })
              : t("sessions.labels.remaining", { time: remainingTime ?? "" })}
          </span>
        </div>
      )}
    </div>
  );
}

export default ElapsedTime;
