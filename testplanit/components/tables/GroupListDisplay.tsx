import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyGroups } from "~/lib/hooks";
import { Groups } from "@prisma/client";
import { UsersRound, UsersRoundIcon } from "lucide-react";

interface GroupListProps {
  groups: { groupId: number }[];
}

export const GroupListDisplay: React.FC<GroupListProps> = ({ groups }) => {
  const { data: allGroups } = useFindManyGroups({
    orderBy: { name: "asc" },
    where: {
      AND: [
        {
          id: {
            in: groups.map((group) => group.groupId),
          },
        },
        {
          isDeleted: false,
        },
      ],
    },
  });

  if (!allGroups || allGroups.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger>
        <Badge>
          <UsersRoundIcon className="w-4 h-4 mr-1" />
          {allGroups.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent>
        {allGroups.map((group: Groups) => (
          <Badge
            key={group.id}
            className=" border p-1 m-1 text-primary-foreground bg-primary rounded-xl"
          >
            <UsersRound className="w-4 h-4 mr-1" />
            {group.name}
          </Badge>
        ))}
      </PopoverContent>
    </Popover>
  );
};
