import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SystemOutputPopoverProps {
  text: string;
}

const SystemOutputPopover: React.FC<SystemOutputPopoverProps> = ({ text }) => {
  if (!text) return null;

  const lines = text.split("\n");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="cursor-pointer hover:underline truncate w-full whitespace-nowrap min-w-0 block align-bottom font-mono">
          {text}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[700px] max-h-[500px] overflow-y-auto">
        <pre className="whitespace-pre-wrap break-words text-sm">
          {lines.map((line, idx) => {
            if (line.startsWith("COMMAND:")) {
              return (
                <span key={idx} className="text-primary font-semibold">
                  {line + "\n"}
                </span>
              );
            }
            if (line.startsWith("RESULT:")) {
              return (
                <span key={idx} className="text-muted-foreground font-semibold">
                  {line + "\n"}
                </span>
              );
            }
            return line + "\n";
          })}
        </pre>
      </PopoverContent>
    </Popover>
  );
};

export default SystemOutputPopover;
