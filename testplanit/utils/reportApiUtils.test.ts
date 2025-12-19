import { describe, it, expect, vi } from "vitest";

// Mock server-side dependencies before importing the module
vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/schemas/reportRequestSchema", () => ({
  reportRequestSchema: {
    safeParse: vi.fn(),
  },
}));

import { cartesianProduct } from "./reportApiUtils";

describe("reportApiUtils", () => {
  describe("cartesianProduct", () => {
    it("should return empty array for empty input", () => {
      const result = cartesianProduct([]);
      expect(result).toEqual([[]]);
    });

    it("should return single array wrapped for single input", () => {
      const result = cartesianProduct([["a", "b", "c"]]);
      expect(result).toEqual([["a"], ["b"], ["c"]]);
    });

    it("should compute cartesian product of two arrays", () => {
      const result = cartesianProduct([
        ["a", "b"],
        [1, 2],
      ]);
      expect(result).toEqual([
        ["a", 1],
        ["a", 2],
        ["b", 1],
        ["b", 2],
      ]);
    });

    it("should compute cartesian product of three arrays", () => {
      const result = cartesianProduct([
        ["a", "b"],
        [1, 2],
        ["x", "y"],
      ]);
      expect(result).toHaveLength(8); // 2 * 2 * 2
      expect(result).toContainEqual(["a", 1, "x"]);
      expect(result).toContainEqual(["a", 1, "y"]);
      expect(result).toContainEqual(["a", 2, "x"]);
      expect(result).toContainEqual(["a", 2, "y"]);
      expect(result).toContainEqual(["b", 1, "x"]);
      expect(result).toContainEqual(["b", 1, "y"]);
      expect(result).toContainEqual(["b", 2, "x"]);
      expect(result).toContainEqual(["b", 2, "y"]);
    });

    it("should handle arrays of different lengths", () => {
      const result = cartesianProduct([
        ["a"],
        [1, 2, 3],
        ["x", "y"],
      ]);
      expect(result).toHaveLength(6); // 1 * 3 * 2
    });

    it("should handle array with empty array", () => {
      const result = cartesianProduct([["a", "b"], []]);
      expect(result).toEqual([]);
    });

    it("should preserve object references", () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const result = cartesianProduct([[obj1], [obj2]]);
      expect(result[0][0]).toBe(obj1);
      expect(result[0][1]).toBe(obj2);
    });

    it("should handle mixed types", () => {
      const result = cartesianProduct([
        ["string", 123, null],
        [true, false],
      ]);
      expect(result).toHaveLength(6);
      expect(result).toContainEqual(["string", true]);
      expect(result).toContainEqual([123, false]);
      expect(result).toContainEqual([null, true]);
    });

    it("should handle single element arrays", () => {
      const result = cartesianProduct([["a"], ["b"], ["c"]]);
      expect(result).toEqual([["a", "b", "c"]]);
    });

    it("should handle large arrays", () => {
      const arr1 = Array.from({ length: 10 }, (_, i) => i);
      const arr2 = Array.from({ length: 5 }, (_, i) => `item${i}`);
      const result = cartesianProduct([arr1, arr2]);
      expect(result).toHaveLength(50); // 10 * 5
    });
  });
});
