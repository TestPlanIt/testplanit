import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useFindManyMilestoneTypes } from "~/lib/hooks";
import { MilestoneTypes, FieldIcon } from "@prisma/client";
import DynamicIcon from "../DynamicIcon";
import { IconName } from "~/types/globals";
import { Milestone } from "lucide-react";

interface MilestoneTypeListProps {
  milestoneTypes: { milestoneTypeId: number }[];
}

export interface ExtendedMilestoneTypes extends MilestoneTypes {
  icon?: FieldIcon | null;
}

export const MilestoneTypeListDisplay: React.FC<MilestoneTypeListProps> = ({
  milestoneTypes,
}) => {
  if (!milestoneTypes || milestoneTypes.length === 0) {
    milestoneTypes = [];
  }

  const { data: allMilestoneTypes } = useFindManyMilestoneTypes({
    orderBy: { name: "asc" },
    where: {
      AND: [
        {
          id: {
            in: milestoneTypes.map(
              (milestoneType) => milestoneType.milestoneTypeId
            ),
          },
        },
        {
          isDeleted: false,
        },
      ],
    },
    include: { icon: true },
  });

  if (!allMilestoneTypes || allMilestoneTypes.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger>
        <Badge>
          <Milestone className="w-4 h-4 mr-1" />
          {allMilestoneTypes.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="flex w-fit items-center">
        {allMilestoneTypes.map((milestoneType: ExtendedMilestoneTypes) => (
          <div key={milestoneType.id}>
            <Badge>
              <div className="flex items-center space-x-1">
                <div>
                  <DynamicIcon
                    className="w-5 h-5"
                    name={milestoneType.icon?.name as IconName}
                  />
                </div>
                <div>{milestoneType.name}</div>
              </div>
            </Badge>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};
