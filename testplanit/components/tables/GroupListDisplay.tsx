import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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

interface GroupListProps {
  groups: { groupId: number }[];
  usePopover?: boolean;
}

export const GroupListDisplay: React.FC<GroupListProps> = ({
  groups,
  usePopover = true,
}) => {
  const tGroups = useTranslations("admin.groups");
  const { data: allGroups } = useClientQueries(schema).groups.useFindMany({
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

  if (!usePopover) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {allGroups.map((group: Groups) => {
          const isScimManaged = group.scimDisplayName !== null;
          return (
            <div
              key={group.id}
              className="flex items-center gap-2 text-sm"
              title={isScimManaged ? tGroups("scimManagedTooltip") : undefined}
            >
              {isScimManaged ? (
                <UserRoundCog className="h-4 w-4 shrink-0" />
              ) : (
                <UsersRound className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">{group.name}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger>
        <Badge>
          <UsersRoundIcon className="w-4 h-4 me-1" />
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
                <UserRoundCog className="w-4 h-4 me-1" />
              ) : (
                <UsersRound className="w-4 h-4 me-1" />
              )}
              {group.name}
            </Badge>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};
