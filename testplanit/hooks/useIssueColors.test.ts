import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getIssuePriorityVariant, useIssueColors } from "./useIssueColors";

// --- Mocks ---

// Stable color data reference (vi.hoisted for use in vi.mock factory)
const { mockColorsData } = vi.hoisted(() => ({
  mockColorsData: {
    data: null as any[] | null,
    isLoading: false,
  },
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyColor: vi.fn(() => ({
    data: mockColorsData.data,
    isLoading: mockColorsData.isLoading,
  })),
}));

// Helper to build color families
function buildColorData() {
  const families = ["Red", "Green", "Blue", "Black", "Indigo", "Yellow"];
  const colors: any[] = [];
  let id = 1;
  let familyId = 1;

  families.forEach((familyName) => {
    for (let order = 0; order <= 6; order++) {
      colors.push({
        id: id++,
        value: `#${familyName.toLowerCase()}-${order}`,
        order,
        colorFamily: { id: familyId, name: familyName, order: familyId },
      });
    }
    familyId++;
  });

  return colors;
}

describe("useIssueColors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockColorsData.data = null;
    mockColorsData.isLoading = false;
  });

  it("should return isLoading state correctly", () => {
    mockColorsData.isLoading = true;

    const { result } = renderHook(() => useIssueColors());

    expect(result.current.isLoading).toBe(true);
  });

  it("should return null colors when data is not loaded", () => {
    mockColorsData.data = null;

    const { result } = renderHook(() => useIssueColors());

    expect(result.current.colors).toBeNull();
  });

  it("should organize colors into family map when data is loaded", () => {
    mockColorsData.data = buildColorData();

    const { result } = renderHook(() => useIssueColors());

    expect(result.current.colors).not.toBeNull();
    expect(result.current.colors?.["Red"]).toBeDefined();
    expect(result.current.colors?.["Green"]).toBeDefined();
    expect(result.current.colors?.["Blue"]).toBeDefined();
    expect(result.current.colors?.["Black"]).toBeDefined();
    expect(result.current.colors?.["Indigo"]).toBeDefined();
    expect(result.current.colors?.["Yellow"]).toBeDefined();
  });

  it("should sort colors within family by order", () => {
    mockColorsData.data = buildColorData();

    const { result } = renderHook(() => useIssueColors());

    const redFamily = result.current.colors?.["Red"];
    expect(redFamily?.colors).toBeDefined();
    for (let i = 1; i < (redFamily?.colors.length ?? 0); i++) {
      expect(redFamily!.colors[i].order).toBeGreaterThanOrEqual(redFamily!.colors[i - 1].order);
    }
  });

  it("should return default gray fallback when colors not loaded", () => {
    mockColorsData.data = null;

    const { result } = renderHook(() => useIssueColors());

    const style = result.current.getPriorityStyle("urgent");
    expect(style.backgroundColor).toBe("#C8C9CA");
    expect(style.color).toBe("#6C6D6E");
    expect(style.borderColor).toBe("#B1B2B3");
  });

  it("should return default gray fallback from getColor when colors not loaded", () => {
    mockColorsData.data = null;

    const { result } = renderHook(() => useIssueColors());

    expect(result.current.getColor("Red", 0)).toBe("#B1B2B3");
  });

  describe("getPriorityStyle", () => {
    beforeEach(() => {
      mockColorsData.data = buildColorData();
    });

    it("should return Red-based colors for urgent priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("urgent");
      expect(style.backgroundColor).toContain("red");
    });

    it("should return Red-based colors for 'highest' priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("highest");
      expect(style.backgroundColor).toContain("red");
    });

    it("should return Red-based colors for 'critical' priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("critical");
      expect(style.backgroundColor).toContain("red");
    });

    it("should return Red-based colors for 'high' priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("high");
      expect(style.backgroundColor).toContain("red");
    });

    it("should return Green-based colors for 'medium' priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("medium");
      expect(style.backgroundColor).toContain("green");
    });

    it("should return Blue-based colors for 'low' priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("low");
      expect(style.backgroundColor).toContain("blue");
    });

    it("should return Blue-based colors for 'lowest' priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("lowest");
      expect(style.backgroundColor).toContain("blue");
    });

    it("should handle null priority and return Black-based neutral colors", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle(null);
      expect(style.backgroundColor).toContain("black");
    });

    it("should handle undefined priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle(undefined);
      expect(style).toBeDefined();
      expect(style.backgroundColor).toBeDefined();
    });

    it("should be case-insensitive for priority values", () => {
      const { result } = renderHook(() => useIssueColors());

      const lower = result.current.getPriorityStyle("URGENT");
      const upper = result.current.getPriorityStyle("urgent");
      expect(lower).toEqual(upper);
    });

    it("should return neutral Black-based colors for unknown priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getPriorityStyle("unknown-priority");
      expect(style.backgroundColor).toContain("black");
    });
  });

  describe("getStatusStyle", () => {
    beforeEach(() => {
      mockColorsData.data = buildColorData();
    });

    it("should return Indigo-based colors for 'open' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("open");
      expect(style.backgroundColor).toContain("indigo");
    });

    it("should return Indigo-based colors for 'todo' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("todo");
      expect(style.backgroundColor).toContain("indigo");
    });

    it("should return Green-based colors for 'in progress' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("in progress");
      expect(style.backgroundColor).toContain("green");
    });

    it("should return Green-based colors for 'active' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("active");
      expect(style.backgroundColor).toContain("green");
    });

    it("should return Black-based colors for 'done' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("done");
      expect(style.backgroundColor).toContain("black");
    });

    it("should return Black-based colors for 'closed' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("closed");
      expect(style.backgroundColor).toContain("black");
    });

    it("should return Red-based colors for 'blocked' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("blocked");
      expect(style.backgroundColor).toContain("red");
    });

    it("should return Yellow-based colors for 'review' status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle("review");
      expect(style.backgroundColor).toContain("yellow");
    });

    it("should normalize status with underscores/multiple spaces", () => {
      const { result } = renderHook(() => useIssueColors());

      const withUnderscore = result.current.getStatusStyle("in_progress");
      const normal = result.current.getStatusStyle("in progress");
      expect(withUnderscore).toEqual(normal);
    });

    it("should handle null status", () => {
      const { result } = renderHook(() => useIssueColors());

      const style = result.current.getStatusStyle(null);
      expect(style).toBeDefined();
      expect(style.backgroundColor).toContain("black");
    });
  });

  describe("getPriorityDotColor", () => {
    beforeEach(() => {
      mockColorsData.data = buildColorData();
    });

    it("should return fallback gray when colors not loaded", () => {
      mockColorsData.data = null;

      const { result } = renderHook(() => useIssueColors());

      expect(result.current.getPriorityDotColor("urgent")).toBe("#B1B2B3");
    });

    it("should return Red shade for urgent priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getPriorityDotColor("urgent");
      expect(color).toContain("red");
    });

    it("should return Green shade for medium priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getPriorityDotColor("medium");
      expect(color).toContain("green");
    });

    it("should return Blue shade for low priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getPriorityDotColor("low");
      expect(color).toContain("blue");
    });

    it("should return Black shade for null priority", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getPriorityDotColor(null);
      expect(color).toContain("black");
    });
  });

  describe("getStatusDotColor", () => {
    beforeEach(() => {
      mockColorsData.data = buildColorData();
    });

    it("should return Indigo shade for open status", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getStatusDotColor("open");
      expect(color).toContain("indigo");
    });

    it("should return Green shade for in progress status", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getStatusDotColor("in progress");
      expect(color).toContain("green");
    });

    it("should return Red shade for blocked status", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getStatusDotColor("blocked");
      expect(color).toContain("red");
    });

    it("should return Yellow shade for review status", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getStatusDotColor("review");
      expect(color).toContain("yellow");
    });

    it("should return fallback for null status", () => {
      const { result } = renderHook(() => useIssueColors());

      const color = result.current.getStatusDotColor(null);
      expect(color).toContain("black");
    });
  });
});

describe("getIssuePriorityVariant (legacy)", () => {
  it("should return 'destructive' for urgent priority", () => {
    expect(getIssuePriorityVariant("urgent")).toBe("destructive");
  });

  it("should return 'destructive' for critical priority", () => {
    expect(getIssuePriorityVariant("critical")).toBe("destructive");
  });

  it("should return 'destructive' for highest priority", () => {
    expect(getIssuePriorityVariant("highest")).toBe("destructive");
  });

  it("should return 'destructive' for high priority", () => {
    expect(getIssuePriorityVariant("high")).toBe("destructive");
  });

  it("should return 'default' for medium priority", () => {
    expect(getIssuePriorityVariant("medium")).toBe("default");
  });

  it("should return 'secondary' for low priority", () => {
    expect(getIssuePriorityVariant("low")).toBe("secondary");
  });

  it("should return 'secondary' for lowest priority", () => {
    expect(getIssuePriorityVariant("lowest")).toBe("secondary");
  });

  it("should return 'secondary' for null priority", () => {
    expect(getIssuePriorityVariant(null)).toBe("secondary");
  });

  it("should return 'secondary' for undefined priority", () => {
    expect(getIssuePriorityVariant(undefined)).toBe("secondary");
  });

  it("should return 'default' for unknown priority", () => {
    expect(getIssuePriorityVariant("unknown")).toBe("default");
  });
});
