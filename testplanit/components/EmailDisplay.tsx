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
      className={`text-pretty overflow-hidden ${fullWidth ? "" : "w-[250px]"}`}
    >
      {/* 2.5.8 Target Size: the link IS the tooltip trigger. A trigger button
          inside the link nested one target in another, obscuring the link. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={`mailto:${email}`}
            className="flex items-center truncate group"
            aria-label={`Email ${email}`}
          >
            <span className="flex items-center truncate gap-1">
              <span className="text-start block truncate">{email}</span>
            </span>
            <ExternalLink className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
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
