import { parseISO, isBefore, isAfter } from "date-fns";
import {
  Milestones,
  Color,
  ColorFamily,
  FieldIcon,
  MilestoneTypes,
} from "@prisma/client";

type MilestoneTypesWithIcon = MilestoneTypes & {
  icon: FieldIcon | null;
};

export type MilestonesWithTypes = Milestones & {
  milestoneType: MilestoneTypesWithIcon;
  children: MilestonesWithTypes[];
};

export interface ColorMap {
  [key: string]: {
    dark: string;
    light: string;
  };
}

interface ColorWithFamily extends Color {
  colorFamily: ColorFamily;
}

// These status keys should match the translation keys
export const STATUS_KEYS = {
  STARTED: "started",
  UNSCHEDULED: "unscheduled",
  PAST_DUE: "pastDue",
  UPCOMING: "upcoming",
  DELAYED: "delayed",
  COMPLETED: "completed",
};

export const createColorMap = (colors: ColorWithFamily[]): ColorMap => {
  const colorGroups = colors.reduce<{ [key: string]: ColorWithFamily[] }>(
    (groups, color) => {
      const groupName = color.colorFamily.name;
      groups[groupName] = groups[groupName] || [];
      groups[groupName].push(color);
      groups[groupName].sort((a, b) => a.order - b.order);
      return groups;
    },
    {}
  );

  return {
    [STATUS_KEYS.STARTED]: {
      dark: colorGroups["Green"][2].value,
      light: colorGroups["Green"][5].value,
    },
    [STATUS_KEYS.UNSCHEDULED]: {
      dark: colorGroups["Black"][2].value,
      light: colorGroups["Black"][5].value,
    },
    [STATUS_KEYS.PAST_DUE]: {
      dark: colorGroups["Red"][2].value,
      light: colorGroups["Red"][5].value,
    },
    [STATUS_KEYS.UPCOMING]: {
      dark: colorGroups["Blue"][2].value,
      light: colorGroups["Blue"][5].value,
    },
    [STATUS_KEYS.DELAYED]: {
      dark: colorGroups["Orange"][2].value,
      light: colorGroups["Orange"][5].value,
    },
    [STATUS_KEYS.COMPLETED]: {
      dark: colorGroups["Black"][2].value,
      light: colorGroups["Black"][5].value,
    },
  };
};

const hexToRgba = (hex: string, alpha: number) => {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return `rgba(${r},${g},${b},${alpha})`;
};

export const getStatusStyle = (
  status: string,
  theme: string,
  colors: ColorMap
) => {
  const color = colors[status];
  if (theme === "dark") {
    return {
      bg: hexToRgba(color.dark, 0.5),
      border: color.dark,
      badge: color.dark,
    };
  } else {
    return {
      bg: hexToRgba(color.light, 0.5),
      border: color.light,
      badge: color.light,
    };
  }
};

export const getCondition = (milestone: Milestones): string => {
  const now = new Date();
  const startDate = milestone.startedAt
    ? parseISO(milestone.startedAt.toISOString())
    : null;
  const endDate = milestone.completedAt
    ? parseISO(milestone.completedAt.toISOString())
    : null;

  if (milestone.isStarted) {
    if (endDate && isBefore(endDate, now)) {
      return "pastDueStarted";
    }
    return "started";
  }

  // Check for past due with both dates first
  if (
    !milestone.isStarted &&
    startDate &&
    endDate &&
    isBefore(startDate, now) &&
    isBefore(endDate, now)
  ) {
    return "pastDueBothDates";
  }

  // Check for past due with only end date (no start date)
  if (!milestone.isStarted && !startDate && endDate && isBefore(endDate, now)) {
    return "pastDueNoStartDate";
  }

  // Check for delayed (past start date, potentially future end date)
  if (!milestone.isStarted && startDate && isBefore(startDate, now)) {
    return "delayed";
  }

  if (!startDate && !endDate) {
    return "unscheduled";
  }

  // Keep upcoming checks
  if (!milestone.isStarted && startDate && isAfter(startDate, now)) {
    return "upcoming";
  }
  if (!milestone.isStarted && !startDate && endDate && isAfter(endDate, now)) {
    return "upcomingNoStartDate";
  }

  return "unknown";
};

export const getStatus = (milestone: Milestones): string => {
  if (milestone.isCompleted) {
    return STATUS_KEYS.COMPLETED;
  }

  const condition = getCondition(milestone);

  switch (condition) {
    case "started":
      return STATUS_KEYS.STARTED;
    case "unscheduled":
      return STATUS_KEYS.UNSCHEDULED;
    case "delayed":
      return STATUS_KEYS.DELAYED;
    case "upcoming":
      return STATUS_KEYS.UPCOMING;
    case "pastDueNoStartDate":
    case "pastDueStarted":
    case "pastDueBothDates":
      return STATUS_KEYS.PAST_DUE;
    case "upcomingNoStartDate":
      return STATUS_KEYS.UPCOMING;
    default:
      return "";
  }
};

export const sortMilestones = (
  milestones: MilestonesWithTypes[]
): MilestonesWithTypes[] => {
  return milestones?.sort((a, b) => {
    // If both are completed, sort by completedAt date
    if (a.isCompleted && b.isCompleted) {
      return (
        parseISO(b.completedAt!.toISOString()).getTime() -
        parseISO(a.completedAt!.toISOString()).getTime()
      );
    }

    // If one is completed and the other is not, completed milestones come last
    if (a.isCompleted) return 1;
    if (b.isCompleted) return -1;

    const aStartDate = a.startedAt ? parseISO(a.startedAt.toISOString()) : null;
    const bStartDate = b.startedAt ? parseISO(b.startedAt.toISOString()) : null;

    const aEndDate = a.completedAt
      ? parseISO(a.completedAt.toISOString())
      : null;
    const bEndDate = b.completedAt
      ? parseISO(b.completedAt.toISOString())
      : null;

    // Started milestones in order of start date
    if (a.isStarted && b.isStarted) {
      return aStartDate && bStartDate
        ? aStartDate.getTime() - bStartDate.getTime()
        : 0;
    }

    // Milestones without start and end dates
    if (!aStartDate && !aEndDate && !bStartDate && !bEndDate) {
      return 0; // Both unscheduled, order doesn't matter
    }
    if (!aStartDate && !aEndDate) {
      return -1; // a is unscheduled, b has dates -> a comes BEFORE b
    }
    if (!bStartDate && !bEndDate) {
      return 1; // b is unscheduled, a has dates -> b comes AFTER a (so a comes first)
    }

    // Milestones with past start dates
    if (
      aStartDate &&
      isBefore(aStartDate, new Date()) &&
      bStartDate &&
      isBefore(bStartDate, new Date())
    ) {
      return aStartDate.getTime() - bStartDate.getTime();
    }
    if (aStartDate && isBefore(aStartDate, new Date())) {
      return -1;
    }
    if (bStartDate && isBefore(bStartDate, new Date())) {
      return 1;
    }

    // Milestones with future start dates
    if (
      aStartDate &&
      isAfter(aStartDate, new Date()) &&
      bStartDate &&
      isAfter(bStartDate, new Date())
    ) {
      return aStartDate.getTime() - bStartDate.getTime();
    }
    if (aStartDate && isAfter(aStartDate, new Date())) {
      return -1;
    }
    if (bStartDate && isAfter(bStartDate, new Date())) {
      return 1;
    }

    // Milestones with end dates, not started
    if (!a.isStarted && aEndDate && bEndDate) {
      return aEndDate.getTime() - bEndDate.getTime();
    }
    if (!a.isStarted && aEndDate) {
      return -1;
    }
    if (!b.isStarted && bEndDate) {
      return 1;
    }

    return 0;
  });
};
