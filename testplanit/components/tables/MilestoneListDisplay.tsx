import React, { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  Milestones,
  MilestoneTypes,
  FieldIcon,
  ColorFamily,
  Color,
} from "@prisma/client";
import DynamicIcon from "../DynamicIcon";
import { IconName } from "~/types/globals";
import { useTheme } from "next-themes";
import { useFindManyColor } from "~/lib/hooks";
import {
  getStatus,
  getStatusStyle,
  createColorMap,
} from "~/utils/milestoneUtils";
import LoadingSpinner from "../LoadingSpinner";
import { Milestone } from "lucide-react";

type MilestoneTypesWithIcon = MilestoneTypes & {
  icon: FieldIcon | null;
};

export type MilestonesWithTypes = Milestones & {
  milestoneType: MilestoneTypesWithIcon;
};

interface MilestoneListProps {
  milestones: MilestonesWithTypes[];
}

interface ColorMap {
  [key: string]: {
    dark: string;
    light: string;
  };
}

export const MilestoneListDisplay: React.FC<MilestoneListProps> = ({
  milestones,
}) => {
  const { theme } = useTheme();
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const [colorMap, setColorMap] = useState<ColorMap | null>(null);

  useEffect(() => {
    if (colors) {
      const map = createColorMap(
        colors as (Color & { colorFamily: ColorFamily })[]
      );
      setColorMap(map);
    }
  }, [colors]);

  if (!milestones || milestones.length === 0) {
    return null;
  }

  if (isColorsLoading || !colorMap)
    return (
      <div>
        <LoadingSpinner />
      </div>
    );

  if (!milestones || milestones.length === 0) {
    milestones = [];
  }

  return (
    <Popover>
      <PopoverTrigger>
        <Badge>
          <Milestone className="w-4 h-4 mr-1" />
          {milestones.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="flex flex-wrap items-center min-w-[400px] max-w-[600px] overflow-auto max-h-[calc(100vh-400px)]">
        {milestones.map((milestone) => {
          const status = getStatus(milestone);
          const { badge } = getStatusStyle(status, theme || "light", colorMap);

          return (
            <div key={milestone.id}>
              <Badge
                style={{ backgroundColor: badge }}
                className="text-secondary-background border-2 border-secondary-foreground text-sm"
              >
                <div className="flex items-center space-x-1 whitespace-nowrap">
                  <div>
                    <DynamicIcon
                      className="w-5 h-5"
                      name={milestone.milestoneType.icon?.name as IconName}
                    />
                  </div>
                  <div>{milestone.name}</div>
                </div>
              </Badge>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};
