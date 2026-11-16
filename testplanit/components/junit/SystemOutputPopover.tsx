import LoadingSpinner from "@/components/LoadingSpinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { schema } from "~/zenstack/schema";

interface SystemOutputPopoverProps {
  /** The output text, when the caller already has it (also the trigger preview). */
  text?: string | null;
  /**
   * Lazy mode (`text` left undefined): the JUnitTestResult whose `systemOut`
   * to fetch when the popover opens. For callers that keep the unbounded log
   * text out of their own query payload — the run page's suite query reloads
   * on every live wake-up, so it ships a presence flag instead of the text.
   */
  resultId?: number;
  /** Lazy mode: whether the result has any output; nothing renders when false. */
  hasText?: boolean;
}

const SystemOutputPopover: React.FC<SystemOutputPopoverProps> = ({
  text,
  resultId,
  hasText,
}) => {
  const t = useTranslations("common");
  const [isOpen, setIsOpen] = useState(false);
  const isLazy = text === undefined && resultId !== undefined;

  const { data: lazyResult } = useClientQueries(
    schema
  ).jUnitTestResult.useFindUnique(
    { where: { id: resultId ?? 0 }, select: { systemOut: true } },
    { enabled: isLazy && isOpen }
  );

  if (isLazy ? !hasText : !text) return null;

  const effectiveText = (isLazy ? lazyResult?.systemOut : text) ?? "";
  const lines = effectiveText.split("\n");
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="block w-full min-w-0 cursor-pointer truncate text-start align-bottom font-mono whitespace-nowrap hover:underline"
          data-testid="system-output-trigger"
        >
          {isLazy ? t("actions.viewSystemOutput") : text}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[500px] w-[700px] overflow-y-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        {isLazy && lazyResult === undefined ? (
          <LoadingSpinner className="h-6" />
        ) : (
          <pre className="text-sm wrap-break-word whitespace-pre-wrap">
            {lines.map((line, idx) => {
              if (line.startsWith("COMMAND:")) {
                return (
                  <span key={idx} className="font-semibold text-primary">
                    {line + "\n"}
                  </span>
                );
              }
              if (line.startsWith("RESULT:")) {
                return (
                  <span
                    key={idx}
                    className="font-semibold text-muted-foreground"
                  >
                    {line + "\n"}
                  </span>
                );
              }
              return line + "\n";
            })}
          </pre>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default SystemOutputPopover;
