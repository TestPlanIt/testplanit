import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink } from "lucide-react";
import React from "react";
import { Link } from "~/lib/navigation";

interface EmailCellProps {
  email: string;
  fullWidth?: boolean;
}

export const EmailCell: React.FC<EmailCellProps> = ({ email, fullWidth }) => {
  return (
    <span
      className={`overflow-hidden text-pretty ${fullWidth ? "" : "w-[250px]"}`}
    >
      {/* 2.5.8 Target Size: the link IS the tooltip trigger. A trigger button
          inside the link nested one target in another, obscuring the link. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={`mailto:${email}`}
            className="group flex items-center truncate"
            aria-label={`Email ${email}`}
          >
            <span className="flex items-center gap-1 truncate">
              <span className="block truncate text-start">{email}</span>
            </span>
            <ExternalLink className="ms-1 inline h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </TooltipTrigger>
        <TooltipContent align="start">
          {/* eslint-disable-next-line react/jsx-no-literals */}
          <span>mailto:{email}</span>
        </TooltipContent>
      </Tooltip>
    </span>
  );
};
