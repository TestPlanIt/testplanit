import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Avatar } from "@/components/Avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LinkIcon, Star } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React from "react";
import { Link } from "~/lib/navigation";
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
  const { data: user } = useClientQueries(schema).user.useFindFirst({
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
  const tCommon = useTranslations("common");
  const isCurrentUser = userId === session?.user.id;

  if (user?.isDeleted) {
    return (
      <div
        className="min-w-0"
        data-testid="user-name-cell"
        title={tCommon("aria.deletedUser")}
      >
        <span className="text-muted-foreground italic">
          {tCommon("aria.deletedUser")}
        </span>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Content to display (avatar + name)
  const content = (
    <span className="flex min-w-0 items-center gap-1">
      {/* Hidden from assistive tech so the link reads "Profile of <name>"
          without the initials. */}
      <span className="shrink-0" aria-hidden="true">
        <Avatar
          alt={user?.name}
          height={20}
          width={20}
          image={user?.image ?? ""}
        />
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex min-w-0 items-center truncate text-start",
              isCurrentUser && "font-extrabold",
              className
            )}
          >
            {isCurrentUser && (
              <Star className="me-1 h-4 w-4 min-w-4 shrink-0 fill-primary text-primary" />
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
    </span>
  );

  return (
    <div className="min-w-0" data-testid="user-name-cell">
      {hideLink ? (
        // Render without the Link wrapper
        <div className="flex min-w-0 items-center truncate">{content}</div>
      ) : (
        // Render with the Link wrapper
        <Link
          href={`/users/profile/${userId}`}
          className="group flex min-w-0 items-center truncate"
          data-testid={`user-profile-link-${userId}`}
        >
          {/* Named from its content, not aria-label, so the visible name is
              part of the accessible name (WCAG 2.5.3 Label in Name). */}
          <span className="sr-only">{"Profile of "}</span>
          {content}
          {!shrinkLink && (
            <LinkIcon className="ms-1 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </Link>
      )}
    </div>
  );
};
