import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { parse } from "stacktrace-parser";
import { Separator } from "@/components/ui/separator";
interface SystemErrorPopoverProps {
  text: string;
}

const SystemErrorPopover: React.FC<SystemErrorPopoverProps> = ({ text }) => {
  if (!text) return null;

  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const message = lines[0] || "";
  const stack = parse(text);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="cursor-pointer hover:underline truncate w-full whitespace-nowrap min-w-0 block align-bottom font-mono">
          {text}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[500px] max-h-[400px] overflow-y-auto focus:outline-none">
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
      </PopoverContent>
    </Popover>
  );
};

export default SystemErrorPopover;
