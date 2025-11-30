import { describe, it, expect } from "vitest";
import { determineIssueDifferences, cn } from "./determineIssueDifferences";

describe("determineIssueDifferences", () => {
  describe("basic functionality", () => {
    it("should find added issues", () => {
      const current = [
        { id: 1, name: "Issue 1" },
        { id: 2, name: "Issue 2" },
      ];
      const previous = [{ id: 1, name: "Issue 1" }];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([{ id: 2, name: "Issue 2" }]);
      expect(result.removedIssues).toEqual([]);
      expect(result.commonIssues).toEqual([{ id: 1, name: "Issue 1" }]);
    });

    it("should find removed issues", () => {
      const current = [{ id: 1, name: "Issue 1" }];
      const previous = [
        { id: 1, name: "Issue 1" },
        { id: 2, name: "Issue 2" },
      ];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([]);
      expect(result.removedIssues).toEqual([{ id: 2, name: "Issue 2" }]);
      expect(result.commonIssues).toEqual([{ id: 1, name: "Issue 1" }]);
    });

    it("should find common issues", () => {
      const current = [
        { id: 1, name: "Issue 1" },
        { id: 2, name: "Issue 2" },
      ];
      const previous = [
        { id: 1, name: "Issue 1" },
        { id: 2, name: "Issue 2" },
      ];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([]);
      expect(result.removedIssues).toEqual([]);
      expect(result.commonIssues).toEqual([
        { id: 1, name: "Issue 1" },
        { id: 2, name: "Issue 2" },
      ]);
    });

    it("should handle all scenarios at once", () => {
      const current = [
        { id: 1, name: "Issue 1" },
        { id: 3, name: "Issue 3" },
      ];
      const previous = [
        { id: 1, name: "Issue 1" },
        { id: 2, name: "Issue 2" },
      ];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([{ id: 3, name: "Issue 3" }]);
      expect(result.removedIssues).toEqual([{ id: 2, name: "Issue 2" }]);
      expect(result.commonIssues).toEqual([{ id: 1, name: "Issue 1" }]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty current array", () => {
      const current: { id: number; name: string }[] = [];
      const previous = [{ id: 1, name: "Issue 1" }];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([]);
      expect(result.removedIssues).toEqual([{ id: 1, name: "Issue 1" }]);
      expect(result.commonIssues).toEqual([]);
    });

    it("should handle empty previous array", () => {
      const current = [{ id: 1, name: "Issue 1" }];
      const previous: { id: number; name: string }[] = [];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([{ id: 1, name: "Issue 1" }]);
      expect(result.removedIssues).toEqual([]);
      expect(result.commonIssues).toEqual([]);
    });

    it("should handle both empty arrays", () => {
      const result = determineIssueDifferences([], []);

      expect(result.addedIssues).toEqual([]);
      expect(result.removedIssues).toEqual([]);
      expect(result.commonIssues).toEqual([]);
    });

    it("should handle null/undefined as empty arrays", () => {
      const result = determineIssueDifferences(
        null as unknown as any[],
        undefined as unknown as any[]
      );

      expect(result.addedIssues).toEqual([]);
      expect(result.removedIssues).toEqual([]);
      expect(result.commonIssues).toEqual([]);
    });

    it("should handle issues with externalId", () => {
      const current = [{ id: 1, name: "Issue 1", externalId: "EXT-1" }];
      const previous = [{ id: 1, name: "Issue 1", externalId: null }];

      const result = determineIssueDifferences(current, previous);

      // ID is the same, so it's a common issue
      expect(result.commonIssues).toEqual([
        { id: 1, name: "Issue 1", externalId: "EXT-1" },
      ]);
    });

    it("should compare by ID only, not by name", () => {
      const current = [{ id: 1, name: "Updated Issue Name" }];
      const previous = [{ id: 1, name: "Original Issue Name" }];

      const result = determineIssueDifferences(current, previous);

      expect(result.addedIssues).toEqual([]);
      expect(result.removedIssues).toEqual([]);
      expect(result.commonIssues).toEqual([
        { id: 1, name: "Updated Issue Name" },
      ]);
    });
  });
});

describe("cn (className utility)", () => {
  it("should merge simple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    expect(cn("base", true && "active")).toBe("base active");
    expect(cn("base", false && "active")).toBe("base");
  });

  it("should merge tailwind classes correctly", () => {
    // twMerge should handle conflicting tailwind classes
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("should handle undefined and null values", () => {
    expect(cn("foo", undefined, "bar", null)).toBe("foo bar");
  });

  it("should handle arrays of classes", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("should handle objects with boolean values", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });
});
