import React from "react";
import { Link } from "~/lib/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink } from "lucide-react";

interface EmailCellProps {
  email: string;
  fullWidth?: boolean;
}

export const EmailCell: React.FC<EmailCellProps> = ({ email, fullWidth }) => {
  return (
    <span
      className={`text-pretty overflow-hidden ${fullWidth ? "" : "w-[250px]"}`}
    >
      <Link
        href={`mailto:${email}`}
        className="flex items-center truncate group"
        aria-label={`Email ${email}`}
      >
        <span className="flex items-center truncate gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="text-left block truncate">
                {email}
                {/* Apply flex and items-center to this span */}
              </TooltipTrigger>
              <TooltipContent align="start">
                {/* eslint-disable-next-line react/jsx-no-literals */}
                <span>mailto:{email}</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </span>
        <ExternalLink className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </Link>
    </span>
  );
};
