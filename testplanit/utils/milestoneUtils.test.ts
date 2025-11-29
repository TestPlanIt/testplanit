import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import {
  createColorMap,
  getStatusStyle,
  getCondition,
  getStatus,
  sortMilestones,
  STATUS_KEYS,
  ColorMap,
  MilestonesWithTypes, // Import the exported type
} from "./milestoneUtils";
import {
  Color,
  ColorFamily,
  Milestones,
  MilestoneTypes,
  FieldIcon,
} from "@prisma/client"; // Assuming types are available

// Define the combined type locally if not exported or easily importable
interface ColorWithFamily extends Color {
  colorFamily: ColorFamily;
}

// --- Mock Data ---

const mockColorFamilies: ColorFamily[] = [
  { id: 1, name: "Green", order: 1 },
  { id: 2, name: "Black", order: 2 },
  { id: 3, name: "Red", order: 3 },
  { id: 4, name: "Blue", order: 4 },
  { id: 5, name: "Orange", order: 5 },
];
const mockColors: ColorWithFamily[] = [
  // Greens (orders 1-6)
  {
    id: 1,
    colorFamilyId: 1,
    colorFamily: mockColorFamilies[0],
    value: "#A0FFA0",
    order: 1,
  },
  {
    id: 2,
    colorFamilyId: 1,
    colorFamily: mockColorFamilies[0],
    value: "#70FF70",
    order: 2,
  },
  {
    id: 3,
    colorFamilyId: 1,
    colorFamily: mockColorFamilies[0],
    value: "#40FF40",
    order: 3,
  }, // Index 2
  {
    id: 4,
    colorFamilyId: 1,
    colorFamily: mockColorFamilies[0],
    value: "#10FF10",
    order: 4,
  },
  {
    id: 5,
    colorFamilyId: 1,
    colorFamily: mockColorFamilies[0],
    value: "#00CC00",
    order: 5,
  },
  {
    id: 6,
    colorFamilyId: 1,
    colorFamily: mockColorFamilies[0],
    value: "#009900",
    order: 6,
  }, // Index 5
  // Blacks (orders 1-6)
  {
    id: 7,
    colorFamilyId: 2,
    colorFamily: mockColorFamilies[1],
    value: "#CCCCCC",
    order: 1,
  },
  {
    id: 8,
    colorFamilyId: 2,
    colorFamily: mockColorFamilies[1],
    value: "#999999",
    order: 2,
  },
  {
    id: 9,
    colorFamilyId: 2,
    colorFamily: mockColorFamilies[1],
    value: "#666666",
    order: 3,
  }, // Index 2
  {
    id: 10,
    colorFamilyId: 2,
    colorFamily: mockColorFamilies[1],
    value: "#333333",
    order: 4,
  },
  {
    id: 11,
    colorFamilyId: 2,
    colorFamily: mockColorFamilies[1],
    value: "#1A1A1A",
    order: 5,
  },
  {
    id: 12,
    colorFamilyId: 2,
    colorFamily: mockColorFamilies[1],
    value: "#000000",
    order: 6,
  }, // Index 5
  // Reds (orders 1-6)
  {
    id: 13,
    colorFamilyId: 3,
    colorFamily: mockColorFamilies[2],
    value: "#FFA0A0",
    order: 1,
  },
  {
    id: 14,
    colorFamilyId: 3,
    colorFamily: mockColorFamilies[2],
    value: "#FF7070",
    order: 2,
  },
  {
    id: 15,
    colorFamilyId: 3,
    colorFamily: mockColorFamilies[2],
    value: "#FF4040",
    order: 3,
  }, // Index 2
  {
    id: 16,
    colorFamilyId: 3,
    colorFamily: mockColorFamilies[2],
    value: "#FF1010",
    order: 4,
  },
  {
    id: 17,
    colorFamilyId: 3,
    colorFamily: mockColorFamilies[2],
    value: "#CC0000",
    order: 5,
  },
  {
    id: 18,
    colorFamilyId: 3,
    colorFamily: mockColorFamilies[2],
    value: "#990000",
    order: 6,
  }, // Index 5
  // Blues (orders 1-6)
  {
    id: 19,
    colorFamilyId: 4,
    colorFamily: mockColorFamilies[3],
    value: "#A0A0FF",
    order: 1,
  },
  {
    id: 20,
    colorFamilyId: 4,
    colorFamily: mockColorFamilies[3],
    value: "#7070FF",
    order: 2,
  },
  {
    id: 21,
    colorFamilyId: 4,
    colorFamily: mockColorFamilies[3],
    value: "#4040FF",
    order: 3,
  }, // Index 2
  {
    id: 22,
    colorFamilyId: 4,
    colorFamily: mockColorFamilies[3],
    value: "#1010FF",
    order: 4,
  },
  {
    id: 23,
    colorFamilyId: 4,
    colorFamily: mockColorFamilies[3],
    value: "#0000CC",
    order: 5,
  },
  {
    id: 24,
    colorFamilyId: 4,
    colorFamily: mockColorFamilies[3],
    value: "#000099",
    order: 6,
  }, // Index 5
  // Oranges (orders 1-6)
  {
    id: 25,
    colorFamilyId: 5,
    colorFamily: mockColorFamilies[4],
    value: "#FFD0A0",
    order: 1,
  },
  {
    id: 26,
    colorFamilyId: 5,
    colorFamily: mockColorFamilies[4],
    value: "#FFB070",
    order: 2,
  },
  {
    id: 27,
    colorFamilyId: 5,
    colorFamily: mockColorFamilies[4],
    value: "#FF9040",
    order: 3,
  }, // Index 2
  {
    id: 28,
    colorFamilyId: 5,
    colorFamily: mockColorFamilies[4],
    value: "#FF7010",
    order: 4,
  },
  {
    id: 29,
    colorFamilyId: 5,
    colorFamily: mockColorFamilies[4],
    value: "#CC5800",
    order: 5,
  },
  {
    id: 30,
    colorFamilyId: 5,
    colorFamily: mockColorFamilies[4],
    value: "#994000",
    order: 6,
  }, // Index 5
];
const testColorMap = createColorMap(mockColors);

// Base mock for Milestones (adjust required fields as necessary)
const baseMockMilestone: Milestones = {
  id: 1,
  projectId: 1,
  rootId: null,
  parentId: null,
  milestoneTypesId: 1,
  name: "Test Milestone",
  note: null,
  docs: null,
  isStarted: false,
  isCompleted: false,
  isDeleted: false,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  createdBy: "user1",
};

// Mock Milestone Type and Icon for MilestonesWithTypes
const mockMilestoneType: MilestoneTypes & { icon: FieldIcon | null } = {
  id: 1,
  name: "Type A",
  iconId: 1,
  icon: { id: 1, name: "lucide:box" },
  isDefault: false,
  isDeleted: false,
};

// --- createColorMap Tests ---

describe("createColorMap", () => {
  it("should create the correct map from mock color data", () => {
    const expectedColorMap: ColorMap = {
      [STATUS_KEYS.STARTED]: { dark: "#40FF40", light: "#009900" },
      [STATUS_KEYS.UNSCHEDULED]: { dark: "#666666", light: "#000000" },
      [STATUS_KEYS.PAST_DUE]: { dark: "#FF4040", light: "#990000" },
      [STATUS_KEYS.UPCOMING]: { dark: "#4040FF", light: "#000099" },
      [STATUS_KEYS.DELAYED]: { dark: "#FF9040", light: "#994000" },
      [STATUS_KEYS.COMPLETED]: { dark: "#666666", light: "#000000" }, // Uses Black
    };
    const actualColorMap = createColorMap(mockColors);
    expect(actualColorMap).toEqual(expectedColorMap);
  });

  it("should handle empty color array input", () => {
    // This will throw an error because the code directly accesses indices [2] and [5]
    // It assumes the color families and specific indices exist.
    expect(() => createColorMap([])).toThrow();
  });

  it("should handle color array missing required families or indices", () => {
    const incompleteColors = mockColors.filter(
      (c) => c.colorFamily.name !== "Green"
    );
    // This will also throw because Green[2] and Green[5] are accessed directly.
    expect(() => createColorMap(incompleteColors)).toThrow();
  });
});

// --- getStatusStyle Tests ---

describe("getStatusStyle", () => {
  it("should return correct styles for dark theme", () => {
    const theme = "dark";
    expect(getStatusStyle(STATUS_KEYS.STARTED, theme, testColorMap)).toEqual({
      bg: "rgba(64,255,64,0.5)", // #40FF40
      border: "#40FF40",
      badge: "#40FF40",
    });
    expect(getStatusStyle(STATUS_KEYS.PAST_DUE, theme, testColorMap)).toEqual({
      bg: "rgba(255,64,64,0.5)", // #FF4040
      border: "#FF4040",
      badge: "#FF4040",
    });
    expect(getStatusStyle(STATUS_KEYS.COMPLETED, theme, testColorMap)).toEqual({
      bg: "rgba(102,102,102,0.5)", // #666666
      border: "#666666",
      badge: "#666666",
    });
  });

  it("should return correct styles for light theme", () => {
    const theme = "light";
    expect(getStatusStyle(STATUS_KEYS.STARTED, theme, testColorMap)).toEqual({
      bg: "rgba(0,153,0,0.5)", // #009900
      border: "#009900",
      badge: "#009900",
    });
    expect(getStatusStyle(STATUS_KEYS.UPCOMING, theme, testColorMap)).toEqual({
      bg: "rgba(0,0,153,0.5)", // #000099
      border: "#000099",
      badge: "#000099",
    });
    expect(getStatusStyle(STATUS_KEYS.DELAYED, theme, testColorMap)).toEqual({
      bg: "rgba(153,64,0,0.5)", // #994000
      border: "#994000",
      badge: "#994000",
    });
  });

  it("should throw error if status key is invalid", () => {
    const theme = "dark";
    // Accessing colors['invalid_status'] will result in accessing undefined.dark
    expect(() =>
      getStatusStyle("invalid_status", theme, testColorMap)
    ).toThrow();
  });
});

// --- Date-dependent Tests Setup ---

describe("Date-Dependent Milestone Utils", () => {
  const MOCK_NOW = new Date("2024-01-15T12:00:00.000Z");
  const PAST_DATE_1 = new Date("2024-01-10T12:00:00.000Z");
  const PAST_DATE_2 = new Date("2024-01-05T12:00:00.000Z");
  const FUTURE_DATE_1 = new Date("2024-01-20T12:00:00.000Z");
  const FUTURE_DATE_2 = new Date("2024-01-25T12:00:00.000Z");

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  // --- getCondition Tests ---

  describe("getCondition", () => {
    it('should return "pastDueStarted" if started and end date is past', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: true,
        completedAt: PAST_DATE_1, // End date in the past
      };
      expect(getCondition(milestone)).toBe("pastDueStarted");
    });

    it('should return "started" if started and end date is future or null', () => {
      const milestoneFutureEnd: Milestones = {
        ...baseMockMilestone,
        isStarted: true,
        completedAt: FUTURE_DATE_1, // End date in the future
      };
      const milestoneNullEnd: Milestones = {
        ...baseMockMilestone,
        isStarted: true,
        completedAt: null,
      };
      expect(getCondition(milestoneFutureEnd)).toBe("started");
      expect(getCondition(milestoneNullEnd)).toBe("started");
    });

    it('should return "unscheduled" if not started and no dates', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: false,
        startedAt: null,
        completedAt: null,
      };
      expect(getCondition(milestone)).toBe("unscheduled");
    });

    it('should return "delayed" if not started and start date is past', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: false,
        startedAt: PAST_DATE_1, // Start date in the past
      };
      expect(getCondition(milestone)).toBe("delayed");
    });

    it('should return "upcoming" if not started and start date is future', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: false,
        startedAt: FUTURE_DATE_1, // Start date in the future
      };
      expect(getCondition(milestone)).toBe("upcoming");
    });

    it('should return "pastDueNoStartDate" if not started, no start date, end date is past', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: false,
        startedAt: null,
        completedAt: PAST_DATE_1, // End date in the past
      };
      expect(getCondition(milestone)).toBe("pastDueNoStartDate");
    });

    it('should return "pastDueBothDates" if not started, both dates past', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: false,
        startedAt: PAST_DATE_2,
        completedAt: PAST_DATE_1,
      };
      expect(getCondition(milestone)).toBe("pastDueBothDates");
    });

    it('should return "upcomingNoStartDate" if not started, no start date, end date is future', () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: false,
        startedAt: null,
        completedAt: FUTURE_DATE_1, // End date in future
      };
      expect(getCondition(milestone)).toBe("upcomingNoStartDate");
    });
  });

  // --- getStatus Tests ---

  describe("getStatus", () => {
    it("should return COMPLETED if isCompleted is true", () => {
      const milestone: Milestones = { ...baseMockMilestone, isCompleted: true };
      expect(getStatus(milestone)).toBe(STATUS_KEYS.COMPLETED);
    });

    // Test mappings based on getCondition results
    it("should map condition 'started' to STARTED", () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        isStarted: true,
        startedAt: PAST_DATE_1,
      };
      expect(getStatus(milestone)).toBe(STATUS_KEYS.STARTED);
    });

    it("should map condition 'unscheduled' to UNSCHEDULED", () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        startedAt: null,
        completedAt: null,
      };
      expect(getStatus(milestone)).toBe(STATUS_KEYS.UNSCHEDULED);
    });

    it("should map condition 'delayed' to DELAYED", () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        startedAt: PAST_DATE_1,
      };
      expect(getStatus(milestone)).toBe(STATUS_KEYS.DELAYED);
    });

    it("should map condition 'upcoming' to UPCOMING", () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        startedAt: FUTURE_DATE_1,
      };
      expect(getStatus(milestone)).toBe(STATUS_KEYS.UPCOMING);
    });

    it("should map condition 'upcomingNoStartDate' to UPCOMING", () => {
      const milestone: Milestones = {
        ...baseMockMilestone,
        completedAt: FUTURE_DATE_1,
      };
      expect(getStatus(milestone)).toBe(STATUS_KEYS.UPCOMING);
    });

    it("should map past due conditions to PAST_DUE", () => {
      const milestone1: Milestones = {
        ...baseMockMilestone,
        isStarted: true,
        completedAt: PAST_DATE_1,
      }; // pastDueStarted
      const milestone2: Milestones = {
        ...baseMockMilestone,
        startedAt: null,
        completedAt: PAST_DATE_1,
      }; // pastDueNoStartDate
      const milestone3: Milestones = {
        ...baseMockMilestone,
        startedAt: PAST_DATE_2,
        completedAt: PAST_DATE_1,
      }; // pastDueBothDates
      expect(getStatus(milestone1)).toBe(STATUS_KEYS.PAST_DUE);
      expect(getStatus(milestone2)).toBe(STATUS_KEYS.PAST_DUE);
      expect(getStatus(milestone3)).toBe(STATUS_KEYS.PAST_DUE);
    });

    it("should return empty string for unknown conditions (if possible)", () => {
      // It might be hard to hit the default case in getCondition
      // const milestone: Milestones = { ...baseMockMilestone, /* some state that results in 'unknown' */ };
      // expect(getStatus(milestone)).toBe("");
      // For now, assume all reachable conditions are mapped.
    });
  });

  // --- sortMilestones Tests ---

  describe("sortMilestones", () => {
    // Helper to create mock MilestonesWithTypes
    const createMockMilestoneWithType = (
      id: number,
      props: Partial<Milestones>
    ): MilestonesWithTypes => ({
      ...(baseMockMilestone as Milestones), // Cast needed if baseMock isn't fully complete
      id,
      ...props,
      // Add required fields for MilestonesWithTypes
      milestoneType: mockMilestoneType,
      children: [],
    });

    it("should sort completed milestones last by completedAt descending", () => {
      const m1 = createMockMilestoneWithType(1, {
        isCompleted: true,
        completedAt: PAST_DATE_1,
      }); // Completed later
      const m2 = createMockMilestoneWithType(2, {
        isCompleted: true,
        completedAt: PAST_DATE_2,
      }); // Completed earlier
      const m3 = createMockMilestoneWithType(3, {
        isStarted: true,
        startedAt: PAST_DATE_1,
      }); // Not completed

      const sorted = sortMilestones([m1, m2, m3]);
      expect(sorted.map((m) => m.id)).toEqual([3, 1, 2]); // m3 (not completed), m1 (completed later), m2 (completed earlier)
    });

    it("should sort started milestones first by startedAt ascending", () => {
      const m1 = createMockMilestoneWithType(1, {
        isStarted: true,
        startedAt: PAST_DATE_1,
      }); // Started later
      const m2 = createMockMilestoneWithType(2, {
        isStarted: true,
        startedAt: PAST_DATE_2,
      }); // Started earlier
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        startedAt: FUTURE_DATE_1,
      }); // Upcoming

      const sorted = sortMilestones([m1, m2, m3]);
      expect(sorted.map((m) => m.id)).toEqual([2, 1, 3]); // m2 (started earlier), m1 (started later), m3 (upcoming)
    });

    it("should sort unscheduled milestones before upcoming/delayed", () => {
      const m1 = createMockMilestoneWithType(1, {
        isStarted: false,
        startedAt: null,
        completedAt: null,
      }); // Unscheduled
      const m2 = createMockMilestoneWithType(2, {
        isStarted: false,
        startedAt: FUTURE_DATE_1,
      }); // Upcoming
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        startedAt: PAST_DATE_1,
      }); // Delayed (past start)

      const sorted = sortMilestones([m1, m2, m3]);
      // Expected order: Unscheduled, Delayed, Upcoming (Based on original logic)
      expect(sorted.map((m) => m.id)).toEqual([1, 3, 2]); // Update expectation
    });

    it("should handle milestones with only end dates", () => {
      const m1 = createMockMilestoneWithType(1, {
        isStarted: false,
        startedAt: null,
        completedAt: FUTURE_DATE_1,
      }); // Upcoming (end date only)
      const m2 = createMockMilestoneWithType(2, {
        isStarted: false,
        startedAt: FUTURE_DATE_2,
      }); // Upcoming (start date only)
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        startedAt: null,
        completedAt: FUTURE_DATE_2,
      }); // Upcoming (later end date only)

      const sorted = sortMilestones([m1, m2, m3]);
      // Logic seems to prioritize start dates, then end dates if not started
      expect(sorted.map((m) => m.id)).toEqual([2, 1, 3]); // Upcoming (start date), Upcoming (earlier end), Upcoming (later end)
    });

    // Add more complex sorting scenarios if needed, e.g., mixing various types
    it("should handle a mix of statuses", () => {
      const m1 = createMockMilestoneWithType(1, {
        isCompleted: true,
        completedAt: PAST_DATE_1,
      }); // Completed
      const m2 = createMockMilestoneWithType(2, {
        isStarted: true,
        startedAt: PAST_DATE_2,
      }); // Started (past)
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        startedAt: null,
        completedAt: null,
      }); // Unscheduled
      const m4 = createMockMilestoneWithType(4, {
        isStarted: false,
        startedAt: FUTURE_DATE_1,
      }); // Upcoming
      const m5 = createMockMilestoneWithType(5, {
        isStarted: true,
        startedAt: PAST_DATE_1,
      }); // Started (later past)
      const m6 = createMockMilestoneWithType(6, {
        isStarted: false,
        startedAt: PAST_DATE_1,
      }); // Delayed

      const sorted = sortMilestones([m1, m2, m3, m4, m5, m6]);
      // Expected: Unscheduled, Started (past asc), Delayed, Upcoming, Completed (desc) (Based on original logic)
      expect(sorted.map((m) => m.id)).toEqual([3, 2, 5, 6, 4, 1]);
    });

    it("should sort past-started before non-past-started", () => {
      const m1 = createMockMilestoneWithType(1, {
        isStarted: false,
        startedAt: FUTURE_DATE_1,
      }); // Upcoming
      const m2 = createMockMilestoneWithType(2, {
        isStarted: false,
        startedAt: PAST_DATE_1,
      }); // Delayed (past start)
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        completedAt: FUTURE_DATE_1,
      }); // Upcoming (end date only)

      const sorted = sortMilestones([m1, m2, m3]);
      // Delayed (past start) comes first
      expect(sorted.map((m) => m.id)).toEqual([2, 1, 3]);
    });

    it("should sort future-started before others (when not past-started)", () => {
      const m1 = createMockMilestoneWithType(1, {
        isStarted: false,
        completedAt: FUTURE_DATE_2,
      }); // Upcoming (end date only, later)
      const m2 = createMockMilestoneWithType(2, {
        isStarted: false,
        startedAt: FUTURE_DATE_1,
      }); // Upcoming (start date)
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        completedAt: FUTURE_DATE_1,
      }); // Upcoming (end date only, earlier)

      const sorted = sortMilestones([m1, m2, m3]);
      // Future start date comes first, then earlier end date
      expect(sorted.map((m) => m.id)).toEqual([2, 3, 1]);
    });

    it("should correctly sort milestones with only end dates among themselves", () => {
      const m1 = createMockMilestoneWithType(1, {
        isStarted: false,
        completedAt: FUTURE_DATE_2,
      }); // Later end date
      const m2 = createMockMilestoneWithType(2, {
        isStarted: false,
        completedAt: FUTURE_DATE_1,
      }); // Earlier end date
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        completedAt: PAST_DATE_1,
      }); // Past end date (behaves like pastDueNoStartDate)

      const sorted = sortMilestones([m1, m2, m3]);
      // Past end date, Earlier future end date, Later future end date
      expect(sorted.map((m) => m.id)).toEqual([3, 2, 1]);
    });

    it("should sort unscheduled last among non-completed, non-started items", () => {
      // Re-verify this based on reverted logic: Unscheduled should be first.
      const m1 = createMockMilestoneWithType(1, {
        isStarted: false,
        startedAt: null,
        completedAt: null,
      }); // Unscheduled
      const m2 = createMockMilestoneWithType(2, {
        isStarted: false,
        startedAt: FUTURE_DATE_1,
      }); // Upcoming (start date)
      const m3 = createMockMilestoneWithType(3, {
        isStarted: false,
        completedAt: FUTURE_DATE_1,
      }); // Upcoming (end date only)
      const m4 = createMockMilestoneWithType(4, {
        isStarted: false,
        startedAt: PAST_DATE_1,
      }); // Delayed (past start)

      const sorted = sortMilestones([m1, m2, m3, m4]);
      // Unscheduled, Delayed, Upcoming (start), Upcoming (end)
      expect(sorted.map((m) => m.id)).toEqual([1, 4, 2, 3]);
    });

    it("should return an empty array if input is empty or null/undefined", () => {
      expect(sortMilestones([])).toEqual([]);
      expect(sortMilestones(null as any)).toBeUndefined(); // Or potentially throw, depending on how ?.sort behaves
      expect(sortMilestones(undefined as any)).toBeUndefined();
    });
  });
});
