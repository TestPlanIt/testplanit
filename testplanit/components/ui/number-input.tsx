"use client";

import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

interface NumberInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange" | "type"
> {
  value: number | undefined | null;
  onChange: (value: number | undefined) => void;
}

/**
 * A number field for react-hook-form that keeps the text exactly as typed
 * ("0.", "-", an emptied field) and reports the parsed number only when
 * the text is one. A controlled `<input type="number">` fed the parsed
 * value snaps "0." back to "0" on every keystroke, which made decimals and
 * retyping a value a fight.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ value, onChange, onBlur, ...rest }, ref) {
    const [text, setText] = useState(value == null ? "" : String(value));
    const [focused, setFocused] = useState(false);

    // Adopt outside changes (a reset, a metric switch) unless the user is
    // mid-edit in this very field.
    useEffect(() => {
      if (focused) return;
      const next = value == null ? "" : String(value);
      setText((current) =>
        Number(current) === value && current !== "" ? current : next
      );
    }, [value, focused]);

    return (
      <Input
        {...rest}
        ref={ref}
        type="number"
        value={text}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          if (raw.trim() === "") {
            onChange(undefined);
            return;
          }
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? parsed : undefined);
        }}
      />
    );
  }
);
