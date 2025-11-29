import React from "react";

import { Avatar } from "@/components/Avatar";
import { useFindManyUser } from "~/lib/hooks";
import { cn, type ClassValue } from "~/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserNameCell } from "@/components/tables/UserNameCell";

interface MemberListProps {
  users: { userId: string; prependText?: string }[];
  className?: ClassValue;
  maxUsers?: number;
}

export const MemberList: React.FC<MemberListProps> = ({
  users,
  className,
  maxUsers,
}) => {
  const { data: allUsers } = useFindManyUser({
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
  });

  // Create a lookup map for O(1) user access instead of O(n) find operations
  const userMap = React.useMemo(
    () => new Map(allUsers?.map((user) => [user.id, user]) || []),
    [allUsers]
  );

  if (!allUsers || allUsers.length === 0) {
    return null;
  }

  // Determine which users to display and which are overflow
  const displayedUsers = maxUsers ? users.slice(0, maxUsers) : users;
  const overflowUsers =
    maxUsers && users.length > maxUsers ? users.slice(maxUsers) : [];
  const overflowCount = overflowUsers.length;

  return (
    <div className={cn("flex flex-wrap items-center", className)}>
      {displayedUsers.map((userEntry, index) => {
        const user = userMap.get(userEntry.userId);
        if (!user) return null;

        return (
          <div
            key={`${user.id}-${userEntry.prependText}-${index}`}
            className="flex -mx-1 border-4 border-white/80 rounded-full"
          >
            <Avatar
              alt={user.name}
              prependText={userEntry.prependText}
              height={25}
              width={25}
              image={user.image!}
            />
          </div>
        );
      })}
      {overflowCount > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center justify-center ml-2 text-sm text-gray-600 hover:text-gray-800 cursor-pointer">
              {`+${overflowCount} more...`}
            </button>
          </PopoverTrigger>
          <PopoverContent className="border-2 bg-background text-foreground max-h-[300px] overflow-y-auto w-auto">
            <div className="flex flex-col gap-2 min-w-[200px]">
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
                    <UserNameCell userId={user.id} hideLink={true} />
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
