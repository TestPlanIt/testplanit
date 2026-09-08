import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock server-side dependencies before importing the module
vi.mock("@/lib/db", () => ({
  baseDb: {},
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/schemas/reportRequestSchema", () => ({
  reportRequestSchema: {
    safeParse: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { internalReportBypassToken } from "~/lib/internalReportBypass";
import {
  authorizeReportRequest,
  cartesianProduct,
  filterRowsByDimensionValues,
} from "./reportApiUtils";

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
      const result = cartesianProduct<string | number>([
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
      const result = cartesianProduct<string | number>([
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
      const result = cartesianProduct<string | number>([
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
      const result = cartesianProduct<string | number | boolean | null>([
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
      const result = cartesianProduct<number | string>([arr1, arr2]);
      expect(result).toHaveLength(50); // 10 * 5
    });
  });

  describe("filterRowsByDimensionValues", () => {
    const dimensionConfigs = [
      { id: "testCase", groupBy: "testRunCaseId" },
      { id: "status", groupBy: "statusId" },
      { id: "date", groupBy: "executedAt" },
    ] as any[];

    const rows = [
      { testRunCaseId: 11, statusId: 1, executedAt: "2026-07-01T10:00:00Z" },
      { testRunCaseId: 22, statusId: 2, executedAt: "2026-07-02T08:00:00Z" },
      { testRunCaseId: null, statusId: 1, executedAt: "2026-07-01T12:00:00Z" },
    ];

    it("returns rows unchanged without filters", () => {
      expect(filterRowsByDimensionValues(rows, dimensionConfigs)).toBe(rows);
      expect(filterRowsByDimensionValues(rows, dimensionConfigs, {})).toBe(
        rows
      );
    });

    it("keeps only rows whose group key is in the selected values", () => {
      const result = filterRowsByDimensionValues(rows, dimensionConfigs, {
        testCase: [11],
      });
      expect(result).toEqual([rows[0]]);
    });

    it("intersects filters across dimensions", () => {
      const result = filterRowsByDimensionValues(rows, dimensionConfigs, {
        status: [1],
        testCase: [11, 22],
      });
      expect(result).toEqual([rows[0]]);
    });

    it("compares string and number ids interchangeably", () => {
      const result = filterRowsByDimensionValues(rows, dimensionConfigs, {
        testCase: ["22"],
      });
      expect(result).toEqual([rows[1]]);
    });

    it("normalizes date group keys to UTC midnight before comparing", () => {
      const result = filterRowsByDimensionValues(rows, dimensionConfigs, {
        date: ["2026-07-01T00:00:00.000Z"],
      });
      expect(result).toEqual([rows[0], rows[2]]);
    });

    it("ignores unknown dimension ids", () => {
      const result = filterRowsByDimensionValues(rows, dimensionConfigs, {
        nonexistent: [1],
      });
      expect(result).toBe(rows);
    });

    it("treats a present-but-empty list as matching nothing", () => {
      // Happens when a selection's group-key translation comes back empty
      // (e.g. a repository case with no run instances in scope).
      const result = filterRowsByDimensionValues(rows, dimensionConfigs, {
        testCase: [],
      });
      expect(result).toEqual([]);
    });
  });

  describe("authorizeReportRequest", () => {
    const makeReq = (headers: Record<string, string> = {}) =>
      new NextRequest("http://localhost/api/report-builder/test-execution", {
        headers,
      });

    beforeEach(() => {
      vi.mocked(getServerSession).mockReset();
      vi.mocked(getEnhancedDb as any).mockReset();
    });

    it("accepts a valid internal bypass token without consulting the session", async () => {
      const result = await authorizeReportRequest(
        makeReq({ "x-shared-report-bypass": internalReportBypassToken() }),
        { requiresAdmin: true }
      );
      expect(result).toEqual({ ok: true, bypass: true });
      expect(getServerSession).not.toHaveBeenCalled();
    });

    it('rejects the forged legacy "true" header when unauthenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null as any);
      const result = await authorizeReportRequest(
        makeReq({ "x-shared-report-bypass": "true" }),
        { requiresAdmin: true }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    });

    it("returns 401 when there is no session or token", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null as any);
      const result = await authorizeReportRequest(makeReq(), {
        requiresAdmin: false,
        projectId: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    });

    it("requires ADMIN for admin-only surfaces", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "u1", access: "USER" },
      } as any);
      const result = await authorizeReportRequest(makeReq(), {
        requiresAdmin: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    });

    it("allows a project member through the membership gate", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "u1", access: "USER" },
      } as any);
      vi.mocked(getEnhancedDb as any).mockResolvedValue({
        projects: { findFirst: vi.fn().mockResolvedValue({ id: 5 }) },
      });
      const result = await authorizeReportRequest(makeReq(), {
        requiresAdmin: false,
        projectId: 5,
      });
      expect(result).toEqual({ ok: true, bypass: false });
    });

    it("returns 403 when the caller cannot read the project", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "u1", access: "USER" },
      } as any);
      vi.mocked(getEnhancedDb as any).mockResolvedValue({
        projects: { findFirst: vi.fn().mockResolvedValue(null) },
      });
      const result = await authorizeReportRequest(makeReq(), {
        requiresAdmin: false,
        projectId: 5,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    });

    it("skips the membership query for system ADMINs", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: "admin", access: "ADMIN" },
      } as any);
      const result = await authorizeReportRequest(makeReq(), {
        requiresAdmin: false,
        projectId: 5,
      });
      expect(result).toEqual({ ok: true, bypass: false });
      expect(getEnhancedDb).not.toHaveBeenCalled();
    });
  });
});
