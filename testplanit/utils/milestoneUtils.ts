import type {
  Color,
  ColorFamily,
  FieldIcon,
  Milestones,
  MilestoneTypes,
} from "~/zenstack/models";
import { isCalendarDayAfter, isCalendarDayBefore } from "~/utils/calendarDate";

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
  const startDate = milestone.startedAt ? new Date(milestone.startedAt) : null;
  const endDate = milestone.completedAt
    ? new Date(milestone.completedAt)
    : null;

  // Milestone dates are calendar dates, so these compare whole days against
  // the reader's own day rather than instants against this moment. Comparing
  // instants made a milestone due Aug 13 go past due at 7:00 PM on Aug 12 for
  // a reader in GMT-5, because the stored value is Aug 13 at UTC midnight.
  //
  // The two ends round in opposite directions, which keeps the day a milestone
  // is due from counting as late: a start date has arrived once the reader
  // reaches that day, while a due date is only past once that day is over.
  const startArrived = !!startDate && !isCalendarDayAfter(startDate, now);
  const endPastDue = !!endDate && isCalendarDayBefore(endDate, now);

  if (milestone.isStarted) {
    return endPastDue ? "pastDueStarted" : "started";
  }

  // Check for past due with both dates first
  if (startArrived && endPastDue) {
    return "pastDueBothDates";
  }

  // Check for past due with only end date (no start date)
  if (!startDate && endPastDue) {
    return "pastDueNoStartDate";
  }

  // Check for delayed (start day reached, potentially future end date)
  if (startArrived) {
    return "delayed";
  }

  if (!startDate && !endDate) {
    return "unscheduled";
  }

  // Keep upcoming checks
  if (startDate) {
    return "upcoming";
  }
  return "upcomingNoStartDate";
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

// Urgency tiers: past due, started (soonest deadline), delayed, upcoming,
// unscheduled, completed
const getSortRank = (milestone: Milestones): number => {
  if (milestone.isCompleted) return 5;
  switch (getStatus(milestone)) {
    case STATUS_KEYS.PAST_DUE:
      return 0;
    case STATUS_KEYS.STARTED:
      return 1;
    case STATUS_KEYS.DELAYED:
      return 2;
    case STATUS_KEYS.UPCOMING:
      return 3;
    default:
      return 4;
  }
};

export const sortMilestones = (
  milestones: MilestonesWithTypes[]
): MilestonesWithTypes[] => {
  return milestones?.sort((a, b) => {
    const rankA = getSortRank(a);
    const rankB = getSortRank(b);
    if (rankA !== rankB) return rankA - rankB;

    const aStart = a.startedAt ? a.startedAt.getTime() : null;
    const bStart = b.startedAt ? b.startedAt.getTime() : null;
    const aEnd = a.completedAt ? a.completedAt.getTime() : null;
    const bEnd = b.completedAt ? b.completedAt.getTime() : null;

    switch (rankA) {
      // Completed: most recently completed first
      case 5:
        return (bEnd ?? 0) - (aEnd ?? 0);
      // Past due and started: earliest end date first, no end date last,
      // then by start date
      case 0:
      case 1:
        if (aEnd !== null && bEnd !== null && aEnd !== bEnd) {
          return aEnd - bEnd;
        }
        if (aEnd !== null && bEnd === null) return -1;
        if (aEnd === null && bEnd !== null) return 1;
        return aStart !== null && bStart !== null ? aStart - bStart : 0;
      // Delayed and upcoming: soonest scheduled date first
      case 2:
      case 3: {
        const aDate = aStart ?? aEnd;
        const bDate = bStart ?? bEnd;
        return aDate !== null && bDate !== null ? aDate - bDate : 0;
      }
      // Unscheduled: keep incoming order
      default:
        return 0;
    }
  });
};

/**
 * Same ranking as sortMilestones, applied at every nesting level of an
 * already-built tree. The flat milestone lists sort once and then filter by
 * parent at each level, so their children come out ranked; a tree has to be
 * walked to get the same order. Sorts in place, like sortMilestones.
 */
export const sortMilestoneTree = (
  milestones: MilestonesWithTypes[]
): MilestonesWithTypes[] => {
  const sorted = sortMilestones(milestones);
  sorted?.forEach((milestone) => {
    if (milestone.children?.length) {
      sortMilestoneTree(milestone.children);
    }
  });
  return sorted;
};
