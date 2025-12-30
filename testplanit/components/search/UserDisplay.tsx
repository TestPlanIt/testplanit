import React from "react";
import { Avatar } from "@/components/Avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Star } from "lucide-react";
import { useSession } from "next-auth/react";
import { type ClassValue } from "~/utils";

export interface UserDisplayProps {
  userId?: string;
  userName?: string;
  userImage?: string | null;
  prefix?: string; // e.g., "Created by", "Assigned to"
  className?: ClassValue;
  size?: "small" | "large";
}

export const UserDisplay: React.FC<UserDisplayProps> = ({
  userId,
  userName,
  userImage,
  prefix,
  className = "",
  size = "small",
}) => {
  const { data: session } = useSession();

  if (!userName) {
    return null;
  }

  const isCurrentUser = userId && userId === session?.user.id;
  const avatarSize = size === "large" ? 20 : 16;

  const content = (
    <span className={`flex items-center gap-1 min-w-0 w-full ${className}`}>
      {prefix && (
        <span className="text-muted-foreground shrink-0">{prefix}:</span>
      )}

      <Avatar
        alt={userName}
        height={avatarSize}
        width={avatarSize}
        image={userImage ?? ""}
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger type="button" className="text-left min-w-0 flex-1 overflow-hidden">
            <span
              className={`flex items-center gap-1 ${isCurrentUser ? "font-semibold" : ""} ${size === "large" ? "text-base" : ""}`}
            >
              {isCurrentUser && (
                <Star className="w-3 h-3 shrink-0 fill-primary text-primary" />
              )}
              <span className="truncate block">{userName}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <div>{userName}</div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );

  return content;
};
