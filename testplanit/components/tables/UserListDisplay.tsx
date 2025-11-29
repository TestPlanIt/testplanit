import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyUser } from "~/lib/hooks";
import { User } from "@prisma/client";
import { UserRoundIcon } from "lucide-react";
import { UserNameCell } from "@/components/tables/UserNameCell";

interface UserListProps {
  users: { userId: string }[];
}

export const UserListDisplay: React.FC<UserListProps> = ({ users }) => {
  if (!users || users.length === 0) {
    users = [];
  }

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

  if (!allUsers || allUsers.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="cursor-pointer">
          <Badge>
            <UserRoundIcon className="w-4 h-4 mr-1" />
            {allUsers.length}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="border-2 bg-background text-foreground max-h-[300px] overflow-y-auto w-auto">
        <div className="flex flex-col gap-2 min-w-[200px]">
          {allUsers.map((user: User) => (
            <UserNameCell key={user.id} userId={user.id} hideLink={true} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
