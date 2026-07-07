import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { User } from "~/zenstack/models";
import { UserRoundIcon } from "lucide-react";
import React from "react";

interface UserListProps {
  users: { userId: string }[];
}

export const UserListDisplay: React.FC<UserListProps> = ({ users }) => {
  if (!users || users.length === 0) {
    users = [];
  }

  const { data: allUsers } = useClientQueries(schema).user.useFindMany({
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

  if (!allUsers || allUsers.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="cursor-pointer">
          <Badge>
            <UserRoundIcon className="w-4 h-4 me-1" />
            {allUsers.length}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="border-2 bg-background text-foreground max-h-[300px] overflow-y-auto w-auto"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2 min-w-[200px]">
          {allUsers.map((user: User) => (
            <UserNameCell key={user.id} userId={user.id} hideLink={true} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
