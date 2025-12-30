import React from "react";
import { Link } from "~/lib/navigation";
import { Avatar } from "@/components/Avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFindFirstUser } from "~/lib/hooks";
import { LinkIcon, Star } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { cn, type ClassValue } from "~/utils";

export interface UserNameCellProps {
  userId: string;
  hideLink?: boolean;
  shrinkLink?: boolean;
  className?: ClassValue;
}

export const UserNameCell: React.FC<UserNameCellProps> = ({
  userId,
  hideLink = false,
  shrinkLink = false,
  className,
}) => {
  const { data: user } = useFindFirstUser({
    where: {
      id: userId,
    },
    select: {
      name: true,
      image: true,
      isDeleted: true,
    },
  });
  const { data: session } = useSession();
  const t = useTranslations("users");
  const isCurrentUser = userId === session?.user.id;

  if (user?.isDeleted) {
    return (
      <div
        className="min-w-0"
        data-testid="user-name-cell"
        title="Deleted User"
      >
        <span className="text-muted-foreground italic">{t("deletedUser")}</span>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Content to display (avatar + name)
  const content = (
    <span className="flex items-center gap-1 min-w-0">
      <Avatar
        alt={user?.name}
        height={20}
        width={20}
        image={user?.image ?? ""}
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger type="button" className="text-left block truncate min-w-0">
            <div
              className={cn(
                "flex items-center truncate",
                isCurrentUser && "font-extrabold",
                className
              )}
            >
              {isCurrentUser && (
                <Star className="w-4 h-4 min-w-4 mr-1 fill-primary text-primary shrink-0" />
              )}
              <span className="truncate">{user?.name}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent align="start">
            <div className="flex items-center gap-1">
              <div>{user?.name}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );

  return (
    <div className="min-w-0" data-testid="user-name-cell">
      {hideLink ? (
        // Render without the Link wrapper
        <div className="flex items-center truncate min-w-0">{content}</div>
      ) : (
        // Render with the Link wrapper
        <Link
          href={`/users/profile/${userId}`}
          className="flex items-center truncate group min-w-0"
          aria-label={`Profile of ${user?.name}`}
        >
          {content}
          {!shrinkLink && (
            <LinkIcon className="w-4 h-4 shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </Link>
      )}
    </div>
  );
};
