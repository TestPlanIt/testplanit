"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Clock, Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "~/utils";

interface TimeTrackerProps {
  /** Called with the tracker's own count. Unused when `value` is given. */
  onTimeUpdate?: (seconds: number) => void;
  /**
   * Seconds to show. When given, the tracker keeps no time of its own: it
   * draws `value` and `running` and reports what the user asks for through
   * `onRunningChange` and `onValueChange`.
   */
  value?: number;
  running?: boolean;
  onRunningChange?: (running: boolean) => void;
  /** The user typed a time, or reset it (0). */
  onValueChange?: (seconds: number) => void;
  /** "sm" is a one-line version for toolbars. */
  size?: "default" | "sm";
  className?: string;
}

export interface TimeTrackerRef {
  reset: () => void;
}

export const TimeTracker = React.forwardRef<TimeTrackerRef, TimeTrackerProps>(
  (
    {
      onTimeUpdate: onTimeUpdateProp,
      value,
      running,
      onRunningChange,
      onValueChange,
      size = "default",
      className,
    },
    ref
  ) => {
    const controlled = value !== undefined;
    const [ownRunning, setIsRunning] = useState(false);
    const [ownSeconds, setSeconds] = useState(0);
    const isRunning = controlled ? running === true : ownRunning;
    const seconds = controlled ? value : ownSeconds;
    const onTimeUpdate = useCallback(
      (total: number) => onTimeUpdateProp?.(total),
      [onTimeUpdateProp]
    );
    const [displayMinutes, setDisplayMinutes] = useState("00");
    const [displaySeconds, setDisplaySeconds] = useState("00");
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const isTimerClickRef = useRef(false);
    const tCommon = useTranslations("common");

    // Format time for the parent component with localized strings
    const updateTimeWithLocalization = useCallback(
      (totalSeconds: number) => {
        if (totalSeconds > 0) {
          const minutes = Math.floor(totalSeconds / 60);
          const remainingSeconds = totalSeconds % 60;
          let _timeString = "";

          if (minutes > 0) {
            _timeString += `${minutes} ${tCommon("time.minutes", { count: minutes })} `;
          }
          if (remainingSeconds > 0 || minutes === 0) {
            _timeString += `${remainingSeconds} ${tCommon("time.seconds", { count: remainingSeconds })}`;
          }

          onTimeUpdate(totalSeconds);
        } else {
          onTimeUpdate(0);
        }
      },
      [onTimeUpdate, tCommon]
    );

    // Reset function
    const resetTimer = useCallback(() => {
      if (controlled) {
        onValueChange?.(0);
        return;
      }
      setIsRunning(false);
      setSeconds(0);
      setDisplayMinutes("00");
      setDisplaySeconds("00");
      onTimeUpdate(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      startTimeRef.current = null;
    }, [controlled, onTimeUpdate, onValueChange]);

    // Expose reset function through ref
    React.useImperativeHandle(ref, () => ({
      reset: resetTimer,
    }));

    // Format the time display
    const formatTimeDisplay = (totalSeconds: number) => {
      const minutes = Math.floor(totalSeconds / 60);
      const remainingSeconds = totalSeconds % 60;
      return {
        minutes: minutes.toString().padStart(2, "0"),
        seconds: remainingSeconds.toString().padStart(2, "0"),
      };
    };

    // Update the timer
    useEffect(() => {
      if (controlled) return;
      if (isRunning) {
        // Only set the start time when the timer first starts or when seconds change
        if (startTimeRef.current === null) {
          startTimeRef.current = performance.now() - seconds * 1000;
        }

        timerRef.current = setInterval(() => {
          const currentTime = performance.now();
          const elapsedTime = Math.floor(
            (currentTime - startTimeRef.current!) / 1000
          );

          if (elapsedTime !== seconds) {
            setSeconds(elapsedTime);
            updateTimeWithLocalization(elapsedTime);
          }
        }, 500); // Update more frequently for better accuracy
      } else if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }, [
      controlled,
      isRunning,
      onTimeUpdate,
      seconds,
      updateTimeWithLocalization,
    ]);

    useEffect(() => {
      const { minutes, seconds: secs } = formatTimeDisplay(seconds);
      setDisplayMinutes(minutes);
      setDisplaySeconds(secs);
    }, [seconds]);

    // Toggle timer
    const toggleTimer = () => {
      if (controlled) {
        onRunningChange?.(!isRunning);
        return;
      }
      isTimerClickRef.current = true;
      if (!isRunning) {
        startTimeRef.current = performance.now() - seconds * 1000;
      }
      setIsRunning(!isRunning);
      // Reset the ref after a short delay
      setTimeout(() => {
        isTimerClickRef.current = false;
      }, 100);
    };

    // Handle manual minute change
    const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isRunning) return; // Don't allow changes while running
      setDisplayMinutes(e.target.value);
    };

    // Handle manual second change
    const handleSecondsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isRunning) return; // Don't allow changes while running
      setDisplaySeconds(e.target.value);
    };

    const commitTypedTime = (totalSeconds: number) => {
      if (controlled) {
        onValueChange?.(totalSeconds);
        return;
      }
      setSeconds(totalSeconds);
      updateTimeWithLocalization(totalSeconds);
    };

    // Handle blur events to format and update time
    const handleMinutesBlur = () => {
      const mins = parseInt(displayMinutes || "0", 10);
      const secs = parseInt(displaySeconds || "0", 10);

      // Handle invalid inputs (NaN)
      const validMins = isNaN(mins) ? 0 : mins;
      const validSecs = isNaN(secs) ? 0 : secs;

      const totalSeconds = validMins * 60 + validSecs;

      setDisplayMinutes(validMins.toString().padStart(2, "0"));
      commitTypedTime(totalSeconds);
    };

    const handleSecondsBlur = () => {
      const mins = parseInt(displayMinutes || "0", 10);
      const secs = parseInt(displaySeconds || "0", 10);

      // Handle invalid inputs (NaN)
      const validMins = isNaN(mins) ? 0 : mins;
      let validSecs = isNaN(secs) ? 0 : secs;

      if (validSecs > 59) validSecs = 59;

      const totalSeconds = validMins * 60 + validSecs;

      setDisplayMinutes(validMins.toString().padStart(2, "0"));
      setDisplaySeconds(validSecs.toString().padStart(2, "0"));
      commitTypedTime(totalSeconds);
    };

    // Handle clock icon click to reset timer when not running
    const handleClockClick = () => {
      if (
        !isRunning &&
        (seconds > 0 || displayMinutes !== "00" || displaySeconds !== "00")
      ) {
        resetTimer();
      }
    };

    const compact = size === "sm";
    const inputClass = compact
      ? "h-6 w-9 p-0.5 text-center text-xs"
      : "w-12 p-1 text-center";

    return (
      <div
        className={cn(
          "flex items-center justify-center overflow-auto rounded-md border-2 border-primary/30",
          compact ? "h-8 shrink-0 bg-background px-1.5" : "p-2",
          isRunning && "border-destructive",
          className
        )}
        data-testid="time-tracker"
        data-running={isRunning ? "true" : "false"}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Clock
              className={`me-1 h-4 w-4 shrink-0 ${
                isRunning
                  ? "animate-spin text-destructive"
                  : seconds > 0 ||
                      displayMinutes !== "00" ||
                      displaySeconds !== "00"
                    ? "cursor-pointer text-muted-foreground hover:text-primary"
                    : "text-muted-foreground"
              }`}
              onClick={handleClockClick}
            />
          </TooltipTrigger>
          <TooltipContent>
            {isRunning
              ? tCommon("fields.isActive")
              : seconds > 0 ||
                  displayMinutes !== "00" ||
                  displaySeconds !== "00"
                ? tCommon("actions.reset")
                : tCommon("fields.elapsed")}
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center">
          <Input
            type="text"
            value={displayMinutes}
            onChange={handleMinutesChange}
            onBlur={handleMinutesBlur}
            className={inputClass}
            disabled={isRunning}
            maxLength={controlled ? 4 : 2}
            aria-label={tCommon("time.minutes", { count: 2 })}
            data-testid="time-tracker-minutes"
          />
          <span className={compact ? "mx-0.5" : "mx-1"}>:</span>
          <Input
            type="text"
            value={displaySeconds}
            onChange={handleSecondsChange}
            onBlur={handleSecondsBlur}
            className={inputClass}
            disabled={isRunning}
            maxLength={2}
            aria-label={tCommon("time.seconds", { count: 2 })}
            data-testid="time-tracker-seconds"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={toggleTimer}
          className={compact ? "ms-1 h-6 px-1.5" : "ms-2"}
          data-testid="time-tracker-toggle"
          aria-label={
            isRunning ? tCommon("actions.pause") : tCommon("actions.start")
          }
        >
          {isRunning ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Pause className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>{tCommon("actions.pause")}</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Play className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>{tCommon("actions.start")}</TooltipContent>
            </Tooltip>
          )}
        </Button>
      </div>
    );
  }
);

TimeTracker.displayName = "TimeTracker";

export default TimeTracker;
