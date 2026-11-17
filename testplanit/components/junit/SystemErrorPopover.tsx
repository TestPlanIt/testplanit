import LoadingSpinner from "@/components/LoadingSpinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { parse } from "stacktrace-parser";
import { schema } from "~/zenstack/schema";

interface SystemErrorPopoverProps {
  /** The error text, when the caller already has it (also the trigger preview). */
  text?: string | null;
  /**
   * Lazy mode (`text` left undefined): the JUnitTestResult whose `systemErr`
   * to fetch when the popover opens. For callers that keep the unbounded
   * stack-trace text out of their own query payload — the run page's suite
   * query reloads on every live wake-up, so it ships a presence flag instead.
   */
  resultId?: number;
  /** Lazy mode: whether the result has any error text; nothing renders when false. */
  hasText?: boolean;
}

const SystemErrorPopover: React.FC<SystemErrorPopoverProps> = ({
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
    { where: { id: resultId ?? 0 }, select: { systemErr: true } },
    { enabled: isLazy && isOpen }
  );

  if (isLazy ? !hasText : !text) return null;

  const effectiveText = (isLazy ? lazyResult?.systemErr : text) ?? "";
  const lines = effectiveText.split("\n").filter((line) => line.trim() !== "");
  const message = lines[0] || "";
  const stack = parse(effectiveText);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div
          className="cursor-pointer hover:underline truncate w-full whitespace-nowrap min-w-0 block align-bottom font-mono"
          data-testid="system-error-trigger"
        >
          {isLazy ? t("actions.viewSystemError") : text}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[500px] max-h-[400px] overflow-y-auto focus:outline-none"
        onWheel={(e) => e.stopPropagation()}
      >
        {isLazy && lazyResult === undefined ? (
          <LoadingSpinner className="h-6" />
        ) : (
          <>
            <div className="font-semibold text-destructive-foreground bg-destructive rounded-md rounded-b-none mb-2 p-2 -mx-4 -mt-4">
              {message}
            </div>
            <pre className="whitespace-pre-wrap break-words text-sm text-destructive">
              {stack.length > 0
                ? stack
                    .map(
                      (frame: any) =>
                        `at ${frame.methodName} (${frame.file}:${frame.lineNumber}:${frame.column})`
                    )
                    .join("\n")
                : lines.slice(1).join("\n")}
            </pre>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default SystemErrorPopover;
