import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Groups } from "~/zenstack/models";
import { UserRoundCog, UsersRound, UsersRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { useFindManyGroups } from "~/lib/hooks";

interface GroupListProps {
  groups: { groupId: number }[];
}

export const GroupListDisplay: React.FC<GroupListProps> = ({ groups }) => {
  const tGroups = useTranslations("admin.groups");
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
        {allGroups.map((group: Groups) => {
          const isScimManaged = group.scimDisplayName !== null;
          return (
            <Badge
              key={group.id}
              className=" border p-1 m-1 text-primary-foreground bg-primary rounded-xl"
              title={isScimManaged ? tGroups("scimManagedTooltip") : undefined}
            >
              {isScimManaged ? (
                <UserRoundCog className="w-4 h-4 mr-1" />
              ) : (
                <UsersRound className="w-4 h-4 mr-1" />
              )}
              {group.name}
            </Badge>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};
