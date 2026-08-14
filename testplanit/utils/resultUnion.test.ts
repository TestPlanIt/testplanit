import { describe, expect, it, vi } from "vitest";
import {
  fetchEngagementExecutionRows,
  fetchJunitResultRows,
  junitResultWhere,
} from "./resultUnion";

describe("resultUnion", () => {
  const filters = {
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-09-30T23:59:59.999Z",
  };

  describe("junitResultWhere", () => {
    it("applies the date range to executedAt", () => {
      const where = junitResultWhere(9, true, filters);
      expect(where.executedAt).toEqual({
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      });
    });

    it("merges requireExecutedAt with the date range instead of dropping either", () => {
      const where = junitResultWhere(9, true, filters, {
        requireExecutedAt: true,
      });
      expect(where.executedAt).toEqual({
        not: null,
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      });
    });

    it("keeps the null exclusion when no date range is given", () => {
      const where = junitResultWhere(9, true, undefined, {
        requireExecutedAt: true,
      });
      expect(where.executedAt).toEqual({ not: null });
    });

    it("omits the executedAt condition entirely when unconstrained", () => {
      const where = junitResultWhere(9, true, undefined);
      expect(where).not.toHaveProperty("executedAt");
    });
  });

  describe("fetchJunitResultRows", () => {
    it("keeps the date range when grouping by execution date", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const db = { jUnitTestResult: { findMany } };

      await fetchJunitResultRows(db, 9, true, ["executedAt"], filters, {
        requireTime: true,
      });

      const where = findMany.mock.calls[0][0].where;
      expect(where.executedAt).toEqual({
        not: null,
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      });
    });
  });

  describe("fetchEngagementExecutionRows", () => {
    it("keeps the date range when grouping by execution date", async () => {
      const manualFindMany = vi.fn().mockResolvedValue([]);
      const junitFindMany = vi.fn().mockResolvedValue([]);
      const db = {
        testRunResults: { findMany: manualFindMany },
        jUnitTestResult: { findMany: junitFindMany },
      };

      await fetchEngagementExecutionRows(db, 9, true, ["executedAt"], filters);

      const junitWhere = junitFindMany.mock.calls[0][0].where;
      expect(junitWhere.executedAt).toEqual({
        not: null,
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      });

      const manualWhere = manualFindMany.mock.calls[0][0].where;
      expect(manualWhere.executedAt).toEqual({
        gte: new Date("2026-07-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      });
    });
  });
});
