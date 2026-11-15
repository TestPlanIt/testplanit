"use client";

import { TimeTracker } from "@/components/TimeTracker";
import { Input } from "@/components/ui/input";
import parseDuration from "parse-duration";
import React, { useState } from "react";
import { useExecutionTimer } from "~/hooks/useExecutionTimer";

interface TrackedElapsedFieldProps {
  /** The execution timer this field shows and edits. */
  timerKey: string;
  /** Turns the timer's seconds into the text shown in the input. */
  formatSeconds: (seconds: number) => string;
  /** Receives what the user typed, for the form to validate. */
  onTextChange: (text: string) => void;
  placeholder?: string;
  inputProps?: Omit<
    React.ComponentProps<typeof Input>,
    "value" | "onChange" | "placeholder"
  >;
}

/**
 * The Elapsed Time field of a result, driven by the case's execution timer.
 *
 * The clock redraws here once a second without touching the form, so the rest
 * of the dialog does not re-render with it. Typing a duration stops the clock
 * and puts the typed time on it; the timer, not the form, is what gets saved.
 */
export function TrackedElapsedField({
  timerKey,
  formatSeconds,
  onTextChange,
  placeholder,
  inputProps,
}: TrackedElapsedFieldProps) {
  const timer = useExecutionTimer(timerKey);
  // What the user is typing, until it parses as a duration and is committed.
  const [draft, setDraft] = useState<string | null>(null);

  const clearDraft = () => {
    setDraft(null);
    onTextChange("");
  };

  return (
    <div className="flex items-end space-x-2">
      <div className="time-tracker">
        <TimeTracker
          value={timer.seconds}
          running={timer.running}
          onRunningChange={(run) => {
            clearDraft();
            if (run) timer.resume();
            else timer.pause();
          }}
          onValueChange={(seconds) => {
            clearDraft();
            timer.set(seconds);
          }}
        />
      </div>
      <Input
        {...inputProps}
        data-testid="elapsed-input"
        value={draft ?? formatSeconds(timer.seconds)}
        placeholder={placeholder}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          onTextChange(text);
          if (text.trim() === "") {
            timer.set(0);
            return;
          }
          const milliseconds = parseDuration(text);
          if (milliseconds !== null && milliseconds >= 0) {
            timer.set(Math.round(milliseconds / 1000));
          } else {
            timer.pause();
          }
        }}
        onBlur={(event) => {
          inputProps?.onBlur?.(event);
          if (draft === null) return;
          const milliseconds = draft.trim() ? parseDuration(draft) : 0;
          // Leave text that is not a duration in place for the form's error.
          if (milliseconds !== null) clearDraft();
        }}
      />
    </div>
  );
}
