"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Pause, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface TimeTrackerProps {
  onTimeUpdate: (seconds: number) => void;
}

export interface TimeTrackerRef {
  reset: () => void;
}

export const TimeTracker = React.forwardRef<TimeTrackerRef, TimeTrackerProps>(
  ({ onTimeUpdate }, ref) => {
    const [isRunning, setIsRunning] = useState(false);
    const [seconds, setSeconds] = useState(0);
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
          let timeString = "";

          if (minutes > 0) {
            timeString += `${minutes} ${tCommon("time.minutes", { count: minutes })} `;
          }
          if (remainingSeconds > 0 || minutes === 0) {
            timeString += `${remainingSeconds} ${tCommon("time.seconds", { count: remainingSeconds })}`;
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
      setIsRunning(false);
      setSeconds(0);
      setDisplayMinutes("00");
      setDisplaySeconds("00");
      onTimeUpdate(0);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      startTimeRef.current = null;
    }, [onTimeUpdate]);

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
    }, [isRunning, onTimeUpdate, seconds, updateTimeWithLocalization]);

    useEffect(() => {
      const { minutes, seconds: secs } = formatTimeDisplay(seconds);
      setDisplayMinutes(minutes);
      setDisplaySeconds(secs);
    }, [seconds]);

    // Toggle timer
    const toggleTimer = () => {
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

    // Handle blur events to format and update time
    const handleMinutesBlur = () => {
      const mins = parseInt(displayMinutes || "0", 10);
      const secs = parseInt(displaySeconds || "0", 10);

      // Handle invalid inputs (NaN)
      const validMins = isNaN(mins) ? 0 : mins;
      const validSecs = isNaN(secs) ? 0 : secs;

      const totalSeconds = validMins * 60 + validSecs;

      setDisplayMinutes(validMins.toString().padStart(2, "0"));
      setSeconds(totalSeconds);
      updateTimeWithLocalization(totalSeconds);
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
      setSeconds(totalSeconds);
      updateTimeWithLocalization(totalSeconds);
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

    return (
      <div
        className={`overflow-auto flex items-center justify-center p-2 border-2 border-primary/30 rounded-md ${isRunning ? "border-destructive" : ""}`}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Clock
                className={`h-4 w-4 shrink-0 mr-1 ${
                  isRunning
                    ? "text-destructive animate-spin"
                    : seconds > 0 ||
                        displayMinutes !== "00" ||
                        displaySeconds !== "00"
                      ? "text-muted-foreground cursor-pointer hover:text-primary"
                      : "text-muted-foreground"
                }`}
                onClick={handleClockClick}
              />
            </TooltipTrigger>
            <TooltipContent>
              {isRunning
                ? tCommon("status.active")
                : seconds > 0 ||
                    displayMinutes !== "00" ||
                    displaySeconds !== "00"
                  ? tCommon("actions.reset")
                  : tCommon("fields.elapsed")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center">
          <Input
            type="text"
            value={displayMinutes}
            onChange={handleMinutesChange}
            onBlur={handleMinutesBlur}
            className="w-12 text-center p-1"
            disabled={isRunning}
            maxLength={2}
          />
          <span className="mx-1">:</span>
          <Input
            type="text"
            value={displaySeconds}
            onChange={handleSecondsChange}
            onBlur={handleSecondsBlur}
            className="w-12 text-center p-1"
            disabled={isRunning}
            maxLength={2}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={toggleTimer}
          className="ml-2"
        >
          {isRunning ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Pause className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>{tCommon("actions.pause")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Play className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>{tCommon("actions.start")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </Button>
      </div>
    );
  }
);

TimeTracker.displayName = "TimeTracker";

export default TimeTracker;
