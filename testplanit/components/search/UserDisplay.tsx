import { Avatar } from "@/components/Avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Star } from "lucide-react";
import { useSession } from "next-auth/react";
import React from "react";
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
    <span className={`flex w-full min-w-0 items-center gap-1 ${className}`}>
      {prefix && (
        <span className="shrink-0 text-muted-foreground">{prefix}:</span>
      )}

      <Avatar
        alt={userName}
        height={avatarSize}
        width={avatarSize}
        image={userImage ?? ""}
      />
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="min-w-0 flex-1 overflow-hidden text-start"
        >
          <span
            className={`flex items-center gap-1 ${isCurrentUser ? "font-semibold" : ""} ${size === "large" ? "text-base" : ""}`}
          >
            {isCurrentUser && (
              <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
            )}
            <span className="block truncate">{userName}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div>{userName}</div>
        </TooltipContent>
      </Tooltip>
    </span>
  );

  return content;
};
