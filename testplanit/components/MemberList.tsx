import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import React from "react";

import { Avatar } from "@/components/Avatar";
import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";

interface MemberListProps {
  users: { userId: string; prependText?: string }[];
  className?: ClassValue;
  maxUsers?: number;
  /**
   * People already loaded by the caller, to draw the members from. A grid of
   * lists passes one directory instead of each list fetching its own users.
   */
  directory?: { id: string; name: string; image: string | null }[];
}

/** Width one avatar adds to the row: its 33px box less the 8px overlap. */
const AVATAR_STEP = 25;
/** Room kept for the "+N more..." button beside a capped list. */
const OVERFLOW_BUTTON_WIDTH = 96;

export const MemberList: React.FC<MemberListProps> = ({
  users,
  className,
  maxUsers,
  directory,
}) => {
  const { data: fetchedUsers } = useClientQueries(schema).user.useFindMany(
    {
      orderBy: { name: "asc" },
      where: {
        AND: [
          {
            id: {
              in: users.map((user) => user.userId),
            },
          },
          {
            isDeleted: false,
          },
        ],
      },
    },
    { enabled: !directory }
  );
  const allUsers = directory ?? fetchedUsers;

  // A capped list stays on one row: it shows as many avatars as fit beside the
  // overflow button and moves the rest behind it.
  const [rowWidth, setRowWidth] = React.useState<number | null>(null);
  const observer = React.useRef<ResizeObserver | null>(null);
  const measureRow = React.useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver(([entry]) =>
      setRowWidth(entry.contentRect.width)
    );
    observer.current.observe(node);
  }, []);

  // Create a lookup map for O(1) user access instead of O(n) find operations
  const userMap = React.useMemo(
    () => new Map(allUsers?.map((user) => [user.id, user]) || []),
    [allUsers]
  );

  if (!allUsers || allUsers.length === 0) {
    return null;
  }

  // Determine which users to display and which are overflow
  let limit = maxUsers;
  if (maxUsers && rowWidth) {
    const capped = Math.min(maxUsers, users.length);
    const fitsAll =
      capped * AVATAR_STEP +
        (users.length > capped ? OVERFLOW_BUTTON_WIDTH : 0) <=
      rowWidth;
    if (!fitsAll) {
      limit = Math.max(
        1,
        Math.min(
          capped,
          Math.floor((rowWidth - OVERFLOW_BUTTON_WIDTH) / AVATAR_STEP)
        )
      );
    }
  }
  const displayedUsers = limit ? users.slice(0, limit) : users;
  const overflowUsers = limit && users.length > limit ? users.slice(limit) : [];
  const overflowCount = overflowUsers.length;

  return (
    <div
      ref={maxUsers ? measureRow : undefined}
      className={cn(
        "flex items-center",
        maxUsers ? "flex-nowrap" : "flex-wrap",
        className
      )}
    >
      {displayedUsers.map((userEntry, index) => {
        const user = userMap.get(userEntry.userId);
        if (!user) return null;

        return (
          <Link
            key={`${user.id}-${userEntry.prependText}-${index}`}
            href={`/users/profile/${user.id}`}
            className="-mx-1 flex shrink-0 rounded-full border-4 border-white/80"
            data-testid={`member-profile-link-${user.id}`}
          >
            {/* Named from its content so the link reads "Profile of <name>";
                the avatar itself is hidden from assistive tech. */}
            <span className="sr-only">{`Profile of ${user.name}`}</span>
            <span aria-hidden="true" className="flex">
              <Avatar
                alt={user.name}
                prependText={userEntry.prependText}
                height={25}
                width={25}
                image={user.image!}
              />
            </span>
          </Link>
        );
      })}
      {overflowCount > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="ms-2 flex shrink-0 cursor-pointer items-center justify-center text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
            >
              {`+${overflowCount} more...`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="max-h-[300px] w-auto overflow-y-auto border-2 bg-background text-foreground">
            <div className="flex min-w-[200px] flex-col gap-2">
              {overflowUsers.map((userEntry, index) => {
                const user = userMap.get(userEntry.userId);
                if (!user) return null;
                return (
                  <div
                    key={`overflow-${user.id}-${index}`}
                    className="flex items-center gap-1"
                  >
                    {userEntry.prependText && (
                      <span className="text-muted-foreground">
                        {userEntry.prependText}:
                      </span>
                    )}
                    <UserNameCell userId={user.id} shrinkLink />
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
