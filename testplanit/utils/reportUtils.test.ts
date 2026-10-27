import type { DbClient } from "~/lib/zenstack";
import { describe, expect, it, vi } from "vitest";
import { queryEngagementUserIds } from "~/lib/engagementUserIdsQuery";
import {
  buildDateFilter,
  createIssueTrackingDimensionRegistry,
  createIssueTrackingMetricRegistry,
  createRepositoryStatsDimensionRegistry,
  createRepositoryStatsMetricRegistry,
  createTestExecutionDimensionRegistry,
  createTestExecutionMetricRegistry,
  createUserEngagementDimensionRegistry,
  createUserEngagementMetricRegistry,
  dimensionToDraggableField,
  draggableFieldToDimension,
  getReportSummary,
  getSortValue,
  getSourceDisplayInfo,
  getUserIdFromRow,
} from "./reportUtils";

vi.mock("~/lib/projectIssueIdsQuery", () => ({
  queryProjectRelevantIssueIds: vi.fn().mockResolvedValue([11, 12, 13]),
}));

vi.mock("~/lib/engagementUserIdsQuery", () => ({
  queryEngagementUserIds: vi.fn(),
}));

describe("reportUtils", () => {
  describe("getReportSummary", () => {
    it("should return null for empty dimensions", () => {
      const result = getReportSummary([], [{ label: "Count" }]);
      expect(result).toBeNull();
    });

    it("should return null for empty metrics", () => {
      const result = getReportSummary([{ label: "Status" }], []);
      expect(result).toBeNull();
    });

    it("should return null for both empty", () => {
      const result = getReportSummary([], []);
      expect(result).toBeNull();
    });

    it("should generate summary for single dimension and metric", () => {
      const dimensions = [{ label: "Status" }];
      const metrics = [{ label: "Test Count" }];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe("Test Count grouped by Status");
    });

    it("should generate summary for multiple dimensions", () => {
      const dimensions = [{ label: "Status" }, { label: "User" }];
      const metrics = [{ label: "Count" }];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe("Count grouped by Status and User");
    });

    it("should generate summary for multiple metrics", () => {
      const dimensions = [{ label: "Status" }];
      const metrics = [{ label: "Count" }, { label: "Pass Rate" }];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe("Count and Pass Rate grouped by Status");
    });

    it("should generate summary for multiple dimensions and metrics", () => {
      const dimensions = [
        { label: "Status" },
        { label: "User" },
        { label: "Date" },
      ];
      const metrics = [
        { label: "Count" },
        { label: "Pass Rate" },
        { label: "Duration" },
      ];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe(
        "Count, Pass Rate and Duration grouped by Status, User and Date"
      );
    });

    it("should use translation function when provided", () => {
      const mockT = (key: string) => {
        const translations: Record<string, string> = {
          "common.and": "y",
          "common.groupedBy": "agrupado por",
        };
        return translations[key] || key;
      };

      const dimensions = [{ label: "Estado" }, { label: "Usuario" }];
      const metrics = [{ label: "Cantidad" }];
      const result = getReportSummary(dimensions, metrics, mockT);
      expect(result).toBe("Cantidad agrupado por Estado y Usuario");
    });
  });

  describe("getUserIdFromRow", () => {
    it("should return userId from original object", () => {
      const row = { original: { userId: "user-123" } };
      expect(getUserIdFromRow(row)).toBe("user-123");
    });

    it("should return UserId with capital U", () => {
      const row = { original: { UserId: "user-456" } };
      expect(getUserIdFromRow(row)).toBe("user-456");
    });

    it("should return id as fallback", () => {
      const row = { original: { id: "user-789" } };
      expect(getUserIdFromRow(row)).toBe("user-789");
    });

    it("should return user.id from nested object", () => {
      const row = { original: { user: { id: "nested-user-id" } } };
      expect(getUserIdFromRow(row)).toBe("nested-user-id");
    });

    it("should return user string directly", () => {
      const row = { original: { user: "string-user-id" } };
      expect(getUserIdFromRow(row)).toBe("string-user-id");
    });

    it("should return User.id with capital U", () => {
      const row = { original: { User: { id: "capital-user-id" } } };
      expect(getUserIdFromRow(row)).toBe("capital-user-id");
    });

    it("should return name as last fallback", () => {
      const row = { original: { name: "John Doe" } };
      expect(getUserIdFromRow(row)).toBe("John Doe");
    });

    it("should return Name with capital N", () => {
      const row = { original: { Name: "Jane Doe" } };
      expect(getUserIdFromRow(row)).toBe("Jane Doe");
    });

    it("should return undefined for empty row", () => {
      const row = { original: {} };
      expect(getUserIdFromRow(row)).toBeUndefined();
    });

    it("should handle null row", () => {
      expect(getUserIdFromRow(null)).toBeUndefined();
    });
  });

  describe("dimensionToDraggableField", () => {
    it("should convert dimension to draggable field", () => {
      const dim = { value: "status", label: "Status" };
      const result = dimensionToDraggableField(dim);
      expect(result).toEqual({
        id: "status",
        label: "Status",
        apiLabel: undefined,
      });
    });

    it("should include apiLabel when present", () => {
      const dim = { value: "user", label: "User", apiLabel: "userId" };
      const result = dimensionToDraggableField(dim);
      expect(result).toEqual({
        id: "user",
        label: "User",
        apiLabel: "userId",
      });
    });

    it("should convert numeric value to string", () => {
      const dim = { value: 123, label: "Test" };
      const result = dimensionToDraggableField(dim);
      expect(result.id).toBe("123");
    });
  });

  describe("draggableFieldToDimension", () => {
    it("should convert draggable field to dimension", () => {
      const field = { id: "status", label: "Status" };
      const result = draggableFieldToDimension(field);
      expect(result).toEqual({
        value: "status",
        label: "Status",
        apiLabel: undefined,
      });
    });

    it("should include apiLabel when present", () => {
      const field = { id: "user", label: "User", apiLabel: "userId" };
      const result = draggableFieldToDimension(field);
      expect(result).toEqual({
        value: "user",
        label: "User",
        apiLabel: "userId",
      });
    });

    it("should convert numeric id to string", () => {
      const field = { id: 456, label: "Test" };
      const result = draggableFieldToDimension(field);
      expect(result.value).toBe("456");
    });
  });

  describe("getSortValue", () => {
    it("should return primitive value directly", () => {
      const row = { count: 42 };
      expect(getSortValue(row, "count")).toBe(42);
    });

    it("should extract name from object", () => {
      const row = { status: { name: "Passed", id: 1 } };
      expect(getSortValue(row, "status")).toBe("passed");
    });

    it("should extract id from object when no name", () => {
      const row = { item: { id: 123 } };
      expect(getSortValue(row, "item")).toBe(123);
    });

    it("should convert object to string as fallback", () => {
      const row = { data: { foo: "bar" } };
      // The function converts to lowercase, so [object Object] becomes [object object]
      expect(getSortValue(row, "data")).toBe("[object object]");
    });

    it("should convert date columns to timestamp", () => {
      const row = { createdAt: "2024-01-15T10:30:00Z" };
      const result = getSortValue(row, "createdAt");
      expect(typeof result).toBe("number");
      expect(result).toBe(new Date("2024-01-15T10:30:00Z").getTime());
    });

    it("should handle date column names with 'date' (lowercase)", () => {
      // The function checks column.includes("date") - lowercase only
      const row = { enddate: "2024-06-01" };
      const result = getSortValue(row, "enddate");
      expect(typeof result).toBe("number");
    });

    it("should return lowercase string for text values", () => {
      const row = { name: "Test Case" };
      expect(getSortValue(row, "name")).toBe("test case");
    });

    it("should handle null values", () => {
      const row = { value: null };
      expect(getSortValue(row, "value")).toBe("");
    });

    it("should handle undefined values", () => {
      const row = { other: "test" };
      expect(getSortValue(row, "missing")).toBe("");
    });
  });

  describe("getSourceDisplayInfo", () => {
    it("should return correct info for MANUAL", () => {
      const result = getSourceDisplayInfo("MANUAL");
      expect(result).toEqual({ icon: "user", color: "#3b82f6" });
    });

    it("should return correct info for API", () => {
      const result = getSourceDisplayInfo("API");
      expect(result).toEqual({ icon: "globe", color: "#10b981" });
    });

    it("should return correct info for IMPORT", () => {
      const result = getSourceDisplayInfo("IMPORT");
      expect(result).toEqual({ icon: "upload", color: "#f59e0b" });
    });

    it("should return correct info for JUNIT", () => {
      const result = getSourceDisplayInfo("JUNIT");
      expect(result).toEqual({ icon: "beaker", color: "#8b5cf6" });
    });

    it("should return default info for unknown source", () => {
      const result = getSourceDisplayInfo("UNKNOWN");
      expect(result).toEqual({ icon: "help-circle", color: "#6b7280" });
    });
  });

  describe("buildDateFilter", () => {
    it("should return empty object when no filters", () => {
      const result = buildDateFilter();
      expect(result).toEqual({});
    });

    it("should return empty object when filters are undefined", () => {
      const result = buildDateFilter(undefined);
      expect(result).toEqual({});
    });

    it("should build filter with only startDate", () => {
      const result = buildDateFilter({ startDate: "2024-01-15" });
      expect(result).toHaveProperty("executedAt");
      expect(result.executedAt).toHaveProperty("gte");
      const gteDate = result.executedAt.gte as Date;
      expect(gteDate.getUTCHours()).toBe(0);
      expect(gteDate.getUTCMinutes()).toBe(0);
    });

    it("should build filter with only endDate", () => {
      const result = buildDateFilter({ endDate: "2024-01-20" });
      expect(result).toHaveProperty("executedAt");
      expect(result.executedAt).toHaveProperty("lt");
      // End date should be next day at midnight
      const ltDate = result.executedAt.lt as Date;
      expect(ltDate.getUTCHours()).toBe(0);
    });

    it("should build filter with both startDate and endDate", () => {
      const result = buildDateFilter({
        startDate: "2024-01-15",
        endDate: "2024-01-20",
      });
      expect(result.executedAt).toHaveProperty("gte");
      expect(result.executedAt).toHaveProperty("lt");
    });

    it("should use custom date field", () => {
      const result = buildDateFilter({ startDate: "2024-01-15" }, "createdAt");
      expect(result).toHaveProperty("createdAt");
      expect(result.createdAt).toHaveProperty("gte");
    });

    it("should set end date to next day for inclusive range", () => {
      const result = buildDateFilter({ endDate: "2024-01-20" });
      const ltDate = result.executedAt.lt as Date;
      // Should be Jan 21, not Jan 20
      expect(ltDate.getUTCDate()).toBe(21);
    });
  });

  // The elapsed metrics read durations from BOTH sources: manual results
  // (TestRunResults.elapsed) and automated results (JUnitTestResult.time).
  describe("hand-rolled date reducers honor the date grouping", () => {
    it("user engagement createdCaseCount buckets creation dates by period", async () => {
      const db = {
        repositoryCases: {
          findMany: vi.fn().mockResolvedValue([
            {
              createdAt: "2026-05-04T09:00:00.000Z",
              creatorId: "u1",
              projectId: 370,
            },
            {
              createdAt: "2026-05-28T23:30:00.000Z",
              creatorId: "u1",
              projectId: 370,
            },
            {
              createdAt: "2026-06-01T01:00:00.000Z",
              creatorId: "u2",
              projectId: 370,
            },
          ]),
        },
      };
      const registry = createUserEngagementMetricRegistry(true);

      const monthly = await registry.createdCaseCount.aggregate(
        db as unknown as DbClient,
        370,
        ["executedAt"],
        { dateGrouping: "monthly" }
      );
      expect(monthly).toEqual([
        { executedAt: "2026-05-01T00:00:00.000Z", createdCaseCount: 2 },
        { executedAt: "2026-06-01T00:00:00.000Z", createdCaseCount: 1 },
      ]);

      // Absent grouping keeps the UTC day, as before the option existed.
      const daily = await registry.createdCaseCount.aggregate(
        db as unknown as DbClient,
        370,
        ["executedAt"],
        {}
      );
      expect(daily.map((r: any) => r.executedAt)).toEqual([
        "2026-05-04T00:00:00.000Z",
        "2026-05-28T00:00:00.000Z",
        "2026-06-01T00:00:00.000Z",
      ]);
    });

    it("issue tracking issueCount buckets creation dates by period", async () => {
      const db = {
        issue: {
          findMany: vi.fn().mockResolvedValue([
            { id: 11, createdAt: "2026-02-10T09:00:00.000Z", priority: "High" },
            { id: 12, createdAt: "2026-03-30T23:30:00.000Z", priority: "Low" },
            { id: 13, createdAt: "2026-04-01T01:00:00.000Z", priority: "Low" },
          ]),
        },
      };
      const registry = createIssueTrackingMetricRegistry(true);

      const quarterly = await registry.issueCount.aggregate(
        db as unknown as DbClient,
        5,
        ["createdAt"],
        { dateGrouping: "quarterly" }
      );
      expect(quarterly).toEqual([
        { createdAt: "2026-01-01T00:00:00.000Z", issueCount: 2 },
        { createdAt: "2026-04-01T00:00:00.000Z", issueCount: 1 },
      ]);
    });
  });

  describe("elapsed metrics combine manual and JUnit durations", () => {
    const DAY1 = new Date("2026-07-01T10:00:00.000Z");
    const DAY2 = new Date("2026-07-02T10:00:00.000Z");

    function makeDb({
      manualRows = [] as any[],
      junitRows = [] as any[],
      manualSum = 0,
      manualCount = 0,
      junitSum = 0,
      junitCount = 0,
    } = {}) {
      const mock = {
        testRunResults: {
          findMany: vi.fn().mockResolvedValue(manualRows),
          aggregate: vi
            .fn()
            .mockResolvedValue({ _sum: { elapsed: manualSum } }),
          count: vi.fn().mockResolvedValue(manualCount),
        },
        jUnitTestResult: {
          findMany: vi.fn().mockResolvedValue(junitRows),
          aggregate: vi.fn().mockResolvedValue({ _sum: { time: junitSum } }),
          count: vi.fn().mockResolvedValue(junitCount),
        },
      };
      return mock as unknown as DbClient & typeof mock;
    }

    function manualRow(
      elapsed: number,
      executedAt: Date,
      { testRunCaseId = 11, repositoryCaseId = 7 } = {}
    ) {
      return {
        executedAt,
        executedById: "user-1",
        statusId: 1,
        elapsed,
        testRunId: 100,
        testRunCaseId,
        testRunCase: { repositoryCaseId },
        testRun: { projectId: 370, configId: null, milestoneId: null },
      };
    }

    function junitRow(
      time: number,
      executedAt: Date,
      { testRunId = 200, repositoryCaseId = 42 } = {}
    ) {
      return {
        executedAt,
        createdById: "user-2",
        statusId: 2,
        time,
        repositoryCaseId,
        testSuite: {
          testRunId,
          testRun: { projectId: 370, configId: null, milestoneId: null },
        },
      };
    }

    const registry = createTestExecutionMetricRegistry(true);

    it("avgElapsedTime averages both sources together per day", async () => {
      const db = makeDb({
        manualRows: [manualRow(10, DAY1), manualRow(20, DAY1)],
        junitRows: [junitRow(60, DAY1), junitRow(30, DAY2)],
      });

      const rows = await registry.avgElapsedTime.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );

      const day1 = rows.find(
        (r: any) => new Date(r.executedAt).getUTCDate() === 1
      );
      const day2 = rows.find(
        (r: any) => new Date(r.executedAt).getUTCDate() === 2
      );
      expect(day1?.avgElapsedTime).toBe(30); // (10 + 20 + 60) / 3
      expect(day2?.avgElapsedTime).toBe(30); // 30 / 1
    });

    it("avgElapsedTime groups both sources by repository case, including run-less JUnit results", async () => {
      const db = makeDb({
        manualRows: [manualRow(10, DAY1, { repositoryCaseId: 7 })],
        junitRows: [
          // Same repository case across two different runs -> one group
          junitRow(50, DAY1, { testRunId: 200, repositoryCaseId: 42 }),
          junitRow(70, DAY1, { testRunId: 201, repositoryCaseId: 42 }),
          // A case never added to any run's case list (no TestRunCases row)
          junitRow(30, DAY1, { testRunId: 202, repositoryCaseId: 108205 }),
        ],
      });

      const rows = await registry.avgElapsedTime.aggregate(
        db,
        370,
        ["repositoryCaseId"],
        {}
      );

      const manualCase = rows.find((r: any) => r.repositoryCaseId === 7);
      const junitCase = rows.find((r: any) => r.repositoryCaseId === 42);
      const runlessCase = rows.find((r: any) => r.repositoryCaseId === 108205);
      expect(manualCase?.avgElapsedTime).toBe(10);
      expect(junitCase?.avgElapsedTime).toBe(60); // (50 + 70) / 2
      expect(runlessCase?.avgElapsedTime).toBe(30);
    });

    it("avgElapsedTime combines both sources in the no-dimension totals path", async () => {
      const db = makeDb({
        manualSum: 100,
        manualCount: 2,
        junitSum: 200,
        junitCount: 3,
      });

      const rows = await registry.avgElapsedTime.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ avgElapsedTime: 60 }]); // 300 / 5
    });

    it("totalElapsedTime sums both sources together per day", async () => {
      const db = makeDb({
        manualRows: [manualRow(10, DAY1)],
        junitRows: [junitRow(60, DAY1), junitRow(30, DAY2)],
      });

      const rows = await registry.totalElapsedTime.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );

      const day1 = rows.find(
        (r: any) => new Date(r.executedAt).getUTCDate() === 1
      );
      const day2 = rows.find(
        (r: any) => new Date(r.executedAt).getUTCDate() === 2
      );
      expect(day1?.totalElapsedTime).toBe(70);
      expect(day2?.totalElapsedTime).toBe(30);
    });

    it("totalElapsedTime combines both sources in the no-dimension totals path", async () => {
      const db = makeDb({ manualSum: 100, junitSum: 200 });

      const rows = await registry.totalElapsedTime.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ totalElapsedTime: 300 }]);
    });
  });

  // Counting metrics operate on the same union: a result is a result
  // regardless of source, and untested placeholders never count.
  describe("counting metrics combine manual and JUnit results", () => {
    const DAY1 = new Date("2026-07-01T10:00:00.000Z");

    function makeCountDb({
      manualRows = [] as any[],
      junitRows = [] as any[],
      manualCount = 0,
      junitCount = 0,
      runs = [] as any[],
      runCount = 0,
    } = {}) {
      const mock = {
        testRunResults: {
          findMany: vi.fn().mockResolvedValue(manualRows),
          count: vi.fn().mockResolvedValue(manualCount),
        },
        jUnitTestResult: {
          findMany: vi.fn().mockResolvedValue(junitRows),
          count: vi.fn().mockResolvedValue(junitCount),
        },
        testRuns: {
          findMany: vi.fn().mockResolvedValue(runs),
          count: vi.fn().mockResolvedValue(runCount),
        },
      };
      return mock as unknown as DbClient & typeof mock;
    }

    const registry = createTestExecutionMetricRegistry(true);

    it("testResults sums both sources in the totals path", async () => {
      const db = makeCountDb({ manualCount: 7, junitCount: 137 });

      const rows = await registry.testResults.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ testResults: 144 }]);
    });

    it("testResults groups both sources by day", async () => {
      const db = makeCountDb({
        manualRows: [
          {
            executedAt: DAY1,
            executedById: "u1",
            statusId: 2,
            testRunId: 100,
            testRunCaseId: 11,
            testRun: { projectId: 370, configId: null, milestoneId: null },
          },
        ],
        junitRows: [
          {
            executedAt: DAY1,
            createdById: "ci",
            statusId: 2,
            time: 3,
            repositoryCaseId: 42,
            testSuite: {
              testRunId: 200,
              testRun: { projectId: 370, configId: null, milestoneId: null },
            },
          },
        ],
      });

      const rows: any[] = await registry.testResults.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].testResults).toBe(2);
    });

    it("passRate blends isSuccess across sources and is null when empty", async () => {
      const db = makeCountDb({
        manualRows: [
          {
            executedAt: DAY1,
            executedById: "u1",
            statusId: 3,
            status: { isSuccess: false },
            testRunId: 100,
            testRunCaseId: 11,
            testRun: { projectId: 370, configId: null, milestoneId: null },
          },
        ],
        junitRows: [
          {
            executedAt: DAY1,
            createdById: "ci",
            statusId: 2,
            status: { isSuccess: true },
            time: 3,
            repositoryCaseId: 42,
            testSuite: {
              testRunId: 200,
              testRun: { projectId: 370, configId: null, milestoneId: null },
            },
          },
        ],
      });

      const rows: any[] = await registry.passRate.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );
      expect(rows[0].passRate).toBe(50);

      const emptyDb = makeCountDb();
      const totals = await registry.passRate.aggregate(emptyDb, 370, [], {});
      expect(totals).toEqual([{ passRate: null }]);
    });

    it("testRunCount counts every run in the totals path and groups by creation day", async () => {
      const db = makeCountDb({
        runCount: 5,
        runs: [
          {
            id: 1,
            createdAt: DAY1,
            createdById: "creator-1",
            projectId: 370,
            configId: null,
            milestoneId: null,
          },
          {
            id: 2,
            createdAt: DAY1,
            createdById: "creator-1",
            projectId: 370,
            configId: null,
            milestoneId: null,
          },
        ],
      });

      const totals = await registry.testRunCount.aggregate(db, 370, [], {});
      expect(totals).toEqual([{ testRunCount: 5 }]);

      const byDay: any[] = await registry.testRunCount.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );
      expect(byDay).toHaveLength(1);
      expect(byDay[0].testRunCount).toBe(2);

      const byCreator: any[] = await registry.testRunCount.aggregate(
        db,
        370,
        ["executedById"],
        {}
      );
      expect(byCreator[0].executedById).toBe("creator-1");
      expect(byCreator[0].testRunCount).toBe(2);
    });

    it("testRunCount derives status groupings from both result sources", async () => {
      const db = makeCountDb({
        manualRows: [
          {
            executedAt: DAY1,
            executedById: "u1",
            statusId: 3,
            testRunId: 100,
            testRun: { projectId: 370, configId: null, milestoneId: null },
          },
        ],
        junitRows: [
          {
            executedAt: DAY1,
            createdById: "ci",
            statusId: 3,
            time: 3,
            repositoryCaseId: 42,
            testSuite: {
              testRunId: 200,
              testRun: { projectId: 370, configId: null, milestoneId: null },
            },
          },
        ],
      });

      const rows: any[] = await registry.testRunCount.aggregate(
        db,
        370,
        ["statusId"],
        {}
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].statusId).toBe(3);
      expect(rows[0].testRunCount).toBe(2); // two distinct runs
    });

    it("testCaseCount counts distinct repository cases across sources", async () => {
      const db = makeCountDb({
        manualRows: [
          {
            executedAt: DAY1,
            executedById: "u1",
            statusId: 2,
            testRunId: 100,
            testRunCase: { repositoryCaseId: 42 },
            testRun: { projectId: 370, configId: null, milestoneId: null },
          },
        ],
        junitRows: [
          // Same case via automation plus a run-less automated case
          {
            executedAt: DAY1,
            createdById: "ci",
            statusId: 2,
            time: 3,
            repositoryCaseId: 42,
            testSuite: {
              testRunId: 200,
              testRun: { projectId: 370, configId: null, milestoneId: null },
            },
          },
          {
            executedAt: DAY1,
            createdById: "ci",
            statusId: 2,
            time: 3,
            repositoryCaseId: 108205,
            testSuite: {
              testRunId: 201,
              testRun: { projectId: 370, configId: null, milestoneId: null },
            },
          },
        ],
      });

      const rows: any[] = await registry.testCaseCount.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].testCaseCount).toBe(2); // cases 42 and 108205
    });
  });

  describe("user-engagement user/role/group dimensions", () => {
    function dimensionDb() {
      const mock = {
        projectAssignment: {
          findMany: vi.fn().mockResolvedValue([{ userId: "member" }]),
        },
        userProjectPermission: {
          findMany: vi.fn().mockResolvedValue([{ userId: "granted" }]),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([]),
          count: vi.fn().mockResolvedValue(0),
        },
        roles: { findMany: vi.fn().mockResolvedValue([]) },
        groups: { findMany: vi.fn().mockResolvedValue([]) },
      };
      return mock as unknown as DbClient & typeof mock;
    }

    const whereOf = (fn: any) => fn.mock.calls[0][0].where;

    it("scopes activity to the project and adds project members to the user list", async () => {
      vi.mocked(queryEngagementUserIds).mockResolvedValue(["active", "member"]);
      const db = dimensionDb();

      await createUserEngagementDimensionRegistry(true).user.getValues(db, 370);

      expect(queryEngagementUserIds).toHaveBeenCalledWith(db, 370);
      expect(whereOf(db.user.findMany)).toEqual({
        isDeleted: false,
        id: { in: ["active", "member", "granted"] },
      });
    });

    it("ignores the project and membership tables in cross-project mode", async () => {
      vi.mocked(queryEngagementUserIds).mockResolvedValue(["active"]);
      const db = dimensionDb();

      await createUserEngagementDimensionRegistry(false).user.getValues(
        db,
        370
      );

      expect(queryEngagementUserIds).toHaveBeenCalledWith(db, undefined);
      expect(db.projectAssignment.findMany).not.toHaveBeenCalled();
      expect(db.userProjectPermission.findMany).not.toHaveBeenCalled();
      expect(whereOf(db.user.findMany).id).toEqual({ in: ["active"] });
    });

    it("searches and pages the user filter picker in the database", async () => {
      vi.mocked(queryEngagementUserIds).mockResolvedValue(["active"]);
      const db = dimensionDb();
      db.user.findMany.mockResolvedValue([
        { id: "active", name: "Ada", email: "ada@example.com" },
      ]);
      db.user.count.mockResolvedValue(41);

      const lookup = await createUserEngagementDimensionRegistry(
        true
      ).user.filterValues(db, 370, { search: "ad", skip: 25, take: 25 });

      expect(lookup).toEqual({
        results: [{ id: "active", name: "Ada", email: "ada@example.com" }],
        total: 41,
      });
      const args = db.user.findMany.mock.calls[0][0];
      expect(args.skip).toBe(25);
      expect(args.take).toBe(25);
      expect(args.where).toEqual({
        isDeleted: false,
        id: { in: ["active", "member", "granted"] },
        OR: [
          { name: { contains: "ad", mode: "insensitive" } },
          { email: { contains: "ad", mode: "insensitive" } },
        ],
      });
      expect(whereOf(db.user.count)).toEqual(args.where);
    });

    it("restores picker labels only for requested ids in scope", async () => {
      vi.mocked(queryEngagementUserIds).mockResolvedValue(["active"]);
      const db = dimensionDb();

      await createUserEngagementDimensionRegistry(true).user.filterValues(
        db,
        370,
        { ids: ["member", "stranger"], skip: 0, take: 25 }
      );

      expect(whereOf(db.user.findMany).id).toEqual({ in: ["member"] });
    });

    it("limits roles and groups to engaged users, without project members", async () => {
      vi.mocked(queryEngagementUserIds).mockResolvedValue(["active"]);
      const db = dimensionDb();
      const registry = createUserEngagementDimensionRegistry(true);

      await registry.role.getValues(db, 370);
      await registry.group.getValues(db, 370);

      expect(whereOf(db.roles.findMany).users).toEqual({
        some: { isDeleted: false, id: { in: ["active"] } },
      });
      expect(whereOf(db.groups.findMany).assignedUsers).toEqual({
        some: { user: { isDeleted: false, id: { in: ["active"] } } },
      });
      expect(db.projectAssignment.findMany).not.toHaveBeenCalled();
    });
  });

  // The user-engagement registry counts the same manual ∪ automated result
  // union as the test-execution registry, attributing automated results to
  // the submitting user, and treats durations as seconds end to end.
  describe("user-engagement metrics read the manual+automated union", () => {
    const JAN1 = new Date("2026-01-01T10:00:00.000Z");

    function engagementDb({
      manualRows = [] as any[],
      junitRows = [] as any[],
      sessionRows = [] as any[],
      caseRows = [] as any[],
      manualCount = 0,
      junitCount = 0,
      manualAgg = {} as Record<string, any>,
      junitAgg = {} as Record<string, any>,
      sessionAgg = {} as Record<string, any>,
      caseAgg = {} as Record<string, any>,
    } = {}) {
      const mock = {
        testRunResults: {
          findMany: vi.fn().mockResolvedValue(manualRows),
          count: vi.fn().mockResolvedValue(manualCount),
          aggregate: vi.fn().mockResolvedValue(manualAgg),
        },
        jUnitTestResult: {
          findMany: vi.fn().mockResolvedValue(junitRows),
          count: vi.fn().mockResolvedValue(junitCount),
          aggregate: vi.fn().mockResolvedValue(junitAgg),
        },
        sessionResults: {
          findMany: vi.fn().mockResolvedValue(sessionRows),
          count: vi.fn().mockResolvedValue(0),
          aggregate: vi.fn().mockResolvedValue(sessionAgg),
        },
        repositoryCases: {
          findMany: vi.fn().mockResolvedValue(caseRows),
          aggregate: vi.fn().mockResolvedValue(caseAgg),
        },
      };
      return mock as unknown as DbClient & typeof mock;
    }

    function manualExecution({
      userId = "manual-user",
      roleId = 5 as number | null,
      groups = [] as Array<{ groupId: number }>,
      elapsed = null as number | null,
      executedAt = JAN1,
    } = {}) {
      return {
        executedAt,
        executedById: userId,
        elapsed,
        executedBy: { roleId, groups },
        testRun: { projectId: 370 },
      };
    }

    function junitExecution({
      userId = "ci-bot",
      roleId = 9 as number | null,
      groups = [] as Array<{ groupId: number }>,
      time = null as number | null,
      executedAt = JAN1 as Date | null,
      createdAt = JAN1,
    } = {}) {
      return {
        executedAt,
        createdAt,
        createdById: userId,
        time,
        createdBy: { roleId, groups },
        testSuite: { testRun: { projectId: 370 } },
      };
    }

    const registry = createUserEngagementMetricRegistry(true);

    it("executionCount totals both sources in the no-dimension path", async () => {
      const db = engagementDb({ manualCount: 7410, junitCount: 137473 });

      const rows = await registry.executionCount.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ executionCount: 144883 }]);
    });

    it("executionCount attributes automated results to the submitting user", async () => {
      const db = engagementDb({
        manualRows: [manualExecution(), manualExecution()],
        junitRows: [junitExecution(), junitExecution(), junitExecution()],
      });

      const rows = await registry.executionCount.aggregate(
        db,
        370,
        ["userId"],
        {}
      );

      const manual = rows.find((r: any) => r.userId === "manual-user");
      const ci = rows.find((r: any) => r.userId === "ci-bot");
      expect(manual?.executionCount).toBe(2);
      expect(ci?.executionCount).toBe(3);
    });

    it("executionCount fans out to each of the executor's groups and skips group-less users", async () => {
      const db = engagementDb({
        manualRows: [
          manualExecution({ groups: [{ groupId: 1 }, { groupId: 2 }] }),
        ],
        junitRows: [junitExecution({ groups: [] })],
      });

      const rows = await registry.executionCount.aggregate(
        db,
        370,
        ["groupId"],
        {}
      );

      expect(rows).toHaveLength(2);
      expect(rows.find((r: any) => r.groupId === 1)?.executionCount).toBe(1);
      expect(rows.find((r: any) => r.groupId === 2)?.executionCount).toBe(1);
    });

    it("averageElapsed blends both sources in seconds — no /1000 scaling", async () => {
      const db = engagementDb({
        manualAgg: { _sum: { elapsed: 100 }, _count: { elapsed: 2 } },
        junitAgg: { _sum: { time: 200 }, _count: { time: 3 } },
      });

      const rows = await registry.averageElapsed.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ averageElapsed: 60 }]); // 300 s / 5
    });

    it("averageElapsed returns null when nothing has a duration", async () => {
      const db = engagementDb({
        manualAgg: { _sum: { elapsed: null }, _count: { elapsed: 0 } },
        junitAgg: { _sum: { time: null }, _count: { time: 0 } },
      });

      const rows = await registry.averageElapsed.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ averageElapsed: null }]);
    });

    it("averageElapsed supports the group dimension", async () => {
      const db = engagementDb({
        manualRows: [
          manualExecution({ elapsed: 10, groups: [{ groupId: 7 }] }),
        ],
        junitRows: [junitExecution({ time: 30, groups: [{ groupId: 7 }] })],
      });

      const rows = await registry.averageElapsed.aggregate(
        db,
        370,
        ["groupId"],
        {}
      );

      expect(rows).toEqual([{ groupId: 7, averageElapsed: 20 }]);
    });

    it("lastActiveDate takes the max across executions, sessions, and case creation", async () => {
      const db = engagementDb({
        manualAgg: { _max: { executedAt: new Date("2026-01-01T00:00:00Z") } },
        junitAgg: {
          _max: {
            executedAt: new Date("2026-02-01T00:00:00Z"),
            createdAt: new Date("2026-01-20T00:00:00Z"),
          },
        },
        sessionAgg: { _max: { createdAt: new Date("2026-03-01T00:00:00Z") } },
        caseAgg: { _max: { createdAt: new Date("2026-01-15T00:00:00Z") } },
      });

      const rows = await registry.lastActiveDate.aggregate(db, 370, [], {});

      expect(rows).toEqual([
        { lastActiveDate: new Date("2026-03-01T00:00:00Z") },
      ]);
    });

    it("lastActiveDate grouped by user includes session and case-creation activity", async () => {
      const db = engagementDb({
        manualRows: [
          manualExecution({
            userId: "user-1",
            executedAt: new Date("2026-01-01T00:00:00Z"),
          }),
        ],
        sessionRows: [
          {
            createdAt: new Date("2026-02-01T00:00:00Z"),
            createdById: "user-2",
            createdBy: { roleId: null, groups: [] },
            session: { projectId: 370 },
          },
        ],
        caseRows: [
          {
            createdAt: new Date("2026-03-01T00:00:00Z"),
            creatorId: "user-1",
            creator: { roleId: null, groups: [] },
            projectId: 370,
          },
        ],
      });

      const rows = await registry.lastActiveDate.aggregate(
        db,
        370,
        ["userId"],
        {}
      );

      const user1 = rows.find((r: any) => r.userId === "user-1");
      const user2 = rows.find((r: any) => r.userId === "user-2");
      expect(user1?.lastActiveDate).toEqual(new Date("2026-03-01T00:00:00Z"));
      expect(user2?.lastActiveDate).toEqual(new Date("2026-02-01T00:00:00Z"));
    });

    it("sessionResultCount excludes deleted session results", async () => {
      const db = engagementDb();

      await registry.sessionResultCount.aggregate(db, 370, [], {});

      expect(db.sessionResults.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false }),
        })
      );
    });
  });

  // Issue-tracking's project population = direct-FK issues PLUS issues
  // linked through the project's cases, runs, and sessions (Q12).
  describe("issue-tracking population uses project-relevant linkage", () => {
    it("issueCount counts linked issues, not only direct-FK ones", async () => {
      const dbMock = {
        issue: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 11 }, { id: 12 }, { id: 13 }]),
        },
      };
      const db = dbMock as unknown as DbClient & typeof dbMock;

      const registry = createIssueTrackingMetricRegistry(true);
      const rows = await registry.issueCount.aggregate(db, 370, [], {});

      expect(rows).toEqual([{ issueCount: 3 }]);
      expect(db.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: [11, 12, 13] },
            isDeleted: false,
          }),
        })
      );
    });

    it("findProjectIssues scopes to defect rows by default", async () => {
      const dbMock = {
        issue: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 11 }, { id: 12 }, { id: 13 }]),
        },
      };
      const db = dbMock as unknown as DbClient & typeof dbMock;

      const registry = createIssueTrackingMetricRegistry(true);
      await registry.issueCount.aggregate(db, 370, [], {});

      expect(db.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: [11, 12, 13] },
            isDeleted: false,
            isRequirement: false,
          }),
        })
      );
    });

    it("a caller-supplied where merges on top of the defect-scope default", async () => {
      const dbMock = {
        issue: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const db = dbMock as unknown as DbClient & typeof dbMock;

      const registry = createIssueTrackingDimensionRegistry(true);
      await registry.issueStatus.getValues(db, 370);

      expect(db.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: [11, 12, 13] },
            isDeleted: false,
            isRequirement: false,
            status: { not: null },
          }),
        })
      );
    });

    it("cross-project issue-type dimension excludes requirement rows in both queries", async () => {
      const dbMock = {
        issue: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const db = dbMock as unknown as DbClient & typeof dbMock;

      const registry = createIssueTrackingDimensionRegistry(false);
      await registry.issueType.getValues(db, undefined);

      expect(db.issue.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: false,
            isRequirement: false,
          }),
        })
      );
      expect(db.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: false,
            isRequirement: false,
          }),
        })
      );
    });

    it("cross-project issueCount metric counts only defect rows", async () => {
      const dbMock = {
        issue: {
          count: vi.fn().mockResolvedValue(5),
        },
      };
      const db = dbMock as unknown as DbClient & typeof dbMock;

      const registry = createIssueTrackingMetricRegistry(false);
      const rows = await registry.issueCount.aggregate(db, undefined, [], {});

      expect(rows).toEqual([{ issueCount: 5 }]);
      expect(db.issue.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: false,
            isRequirement: false,
          }),
        })
      );
    });

    it("cross-project groupBy dimension aggregates only defect rows", async () => {
      const dbMock = {
        issue: {
          groupBy: vi
            .fn()
            .mockResolvedValue([{ status: "Open", _count: { _all: 2 } }]),
        },
      };
      const db = dbMock as unknown as DbClient & typeof dbMock;

      const registry = createIssueTrackingMetricRegistry(false);
      await registry.issueCount.aggregate(db, undefined, ["status"], {});

      expect(db.issue.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ["status"],
          where: expect.objectContaining({
            isDeleted: false,
            isRequirement: false,
          }),
        })
      );
    });
  });

  describe("impact dimensions and metrics", () => {
    const DAY1 = new Date("2026-09-01T10:00:00.000Z");
    const DAY2 = new Date("2026-09-02T10:00:00.000Z");
    const status = (isFailure: boolean, isCompleted = true) => ({
      status: { isFailure, isCompleted },
    });
    const analyses = [
      {
        id: 1,
        createdAt: DAY1,
        createdById: "u1",
        projectId: 370,
        configId: 9,
        trigger: "pull_request",
        testRunId: 100,
        pinnedCaseCount: 2,
        affectedCaseCount: 3,
        testRun: {
          configId: null,
          milestoneId: null,
          testCases: [status(true), status(false), { status: null }],
        },
      },
      {
        id: 2,
        createdAt: DAY1,
        createdById: "u1",
        projectId: 370,
        configId: 9,
        trigger: null,
        testRunId: null,
        pinnedCaseCount: 1,
        affectedCaseCount: 0,
        testRun: null,
      },
      {
        id: 3,
        createdAt: DAY2,
        createdById: "u2",
        projectId: 370,
        configId: 10,
        trigger: "push",
        testRunId: 101,
        pinnedCaseCount: 0,
        affectedCaseCount: 4,
        testRun: {
          configId: null,
          milestoneId: null,
          testCases: [status(false), status(false)],
        },
      },
    ];
    const dbMock = {
      impactAnalysis: { findMany: vi.fn().mockResolvedValue(analyses) },
      projectCodeRepositoryConfig: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9,
            branch: "main",
            repository: { name: "acme/app", isDeleted: false },
          },
          {
            id: 10,
            branch: null,
            repository: { name: "acme/svc", isDeleted: false },
          },
          {
            id: 11,
            branch: null,
            repository: { name: "gone", isDeleted: true },
          },
        ]),
      },
    };
    const db = dbMock as unknown as DbClient & typeof dbMock;
    const dims = createTestExecutionDimensionRegistry(true) as any;
    const metrics = createTestExecutionMetricRegistry(true) as any;

    it("offers the three triggers and the live repository connections as dimension values", async () => {
      const triggers = await dims.trigger.getValues(db, 370);
      expect(triggers.map((v: any) => v.id)).toEqual([
        "manual",
        "pull_request",
        "push",
      ]);
      expect(triggers[1].impactTrigger).toBe("pull_request");
      const repos = await dims.codeRepository.getValues(db, 370);
      expect(repos).toEqual([
        { id: 9, name: "acme/app (main)" },
        { id: 10, name: "acme/svc" },
      ]);
      expect(
        db.projectCodeRepositoryConfig.findMany.mock.calls[0][0].where
      ).toMatchObject({
        projectId: 370,
        purpose: "IMPACT",
      });
    });

    it("counts analyses and selected cases by trigger, date, and repository", async () => {
      const totals = await metrics.impactAnalysisCount.aggregate(
        db,
        370,
        [],
        {}
      );
      expect(totals).toEqual([{ impactAnalysisCount: 3 }]);
      const where = db.impactAnalysis.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ isDeleted: false, projectId: 370 });

      const byTrigger: any[] = await metrics.impactAnalysisCount.aggregate(
        db,
        370,
        ["impactTrigger"],
        {}
      );
      expect(
        Object.fromEntries(
          byTrigger.map((r) => [r.impactTrigger, r.impactAnalysisCount])
        )
      ).toEqual({
        pull_request: 1,
        manual: 1,
        push: 1,
      });

      const byDay: any[] = await metrics.affectedCasesSelected.aggregate(
        db,
        370,
        ["executedAt"],
        {}
      );
      expect(byDay.map((r) => r.affectedCasesSelected)).toEqual([6, 4]);

      const byRepo: any[] = await metrics.affectedCasesSelected.aggregate(
        db,
        370,
        ["impactConfigId"],
        {}
      );
      expect(
        Object.fromEntries(
          byRepo.map((r) => [r.impactConfigId, r.affectedCasesSelected])
        )
      ).toEqual({
        9: 6,
        10: 4,
      });
    });

    it("measures selection precision from executed selected cases and stays null with nothing executed", async () => {
      const totals = await metrics.selectionPrecision.aggregate(
        db,
        370,
        [],
        {}
      );
      // 4 executed selected cases across the two runs, 1 failed.
      expect(totals).toEqual([{ selectionPrecision: 25 }]);

      const byTrigger: any[] = await metrics.selectionPrecision.aggregate(
        db,
        370,
        ["impactTrigger"],
        {}
      );
      expect(
        Object.fromEntries(
          byTrigger.map((r) => [r.impactTrigger, r.selectionPrecision])
        )
      ).toEqual({
        pull_request: 50,
        push: 0,
        manual: null,
      });
      expect(
        db.impactAnalysis.findMany.mock.calls.at(-1)![0].select.testRun.select
          .testCases
      ).toBeDefined();
    });
  });

  // The Result Source dimension splits the manual ∪ automated union by the
  // table each execution came from.
  describe("result source dimension", () => {
    const DAY1 = new Date("2026-07-01T10:00:00.000Z");

    function makeDb({
      manualRows = [] as any[],
      junitRows = [] as any[],
    } = {}) {
      const mock = {
        testRunResults: {
          findMany: vi.fn().mockResolvedValue(manualRows),
        },
        jUnitTestResult: {
          findMany: vi.fn().mockResolvedValue(junitRows),
        },
      };
      return mock as unknown as DbClient & typeof mock;
    }

    const manualRow = {
      executedAt: DAY1,
      executedById: "u1",
      statusId: 2,
      testRunId: 100,
      testRunCaseId: 11,
      testRun: { projectId: 370, configId: null, milestoneId: null },
    };
    const junitRow = {
      executedAt: DAY1,
      createdById: "ci",
      statusId: 2,
      time: 3,
      repositoryCaseId: 42,
      testSuite: {
        testRunId: 200,
        testRun: { projectId: 370, configId: null, milestoneId: null },
      },
    };

    it("offers Manual and Automated as its values", async () => {
      const dim = createTestExecutionDimensionRegistry(true)
        .resultSource as any;
      const values = await dim.getValues();
      expect(values.map((v: any) => v.id)).toEqual(["MANUAL", "AUTOMATED"]);
      // The lookup map keys non-Id dimensions by their groupBy property.
      expect(values.map((v: any) => v.resultSource)).toEqual([
        "MANUAL",
        "AUTOMATED",
      ]);
    });

    it("testResults splits the union by source", async () => {
      const db = makeDb({
        manualRows: [manualRow, { ...manualRow, testRunCaseId: 12 }],
        junitRows: [junitRow],
      });

      const rows: any[] = await createTestExecutionMetricRegistry(
        true
      ).testResults.aggregate(db, 370, ["resultSource"], {});

      expect(
        Object.fromEntries(rows.map((r) => [r.resultSource, r.testResults]))
      ).toEqual({ MANUAL: 2, AUTOMATED: 1 });
    });

    it("composes with the date dimension", async () => {
      const db = makeDb({ manualRows: [manualRow], junitRows: [junitRow] });

      const rows: any[] = await createTestExecutionMetricRegistry(
        true
      ).testResults.aggregate(db, 370, ["executedAt", "resultSource"], {});

      expect(rows).toHaveLength(2);
      rows.forEach((r) => expect(r.testResults).toBe(1));
    });
  });

  // The Root Cause dimension groups automated results by their failure
  // signature's effective classification.
  describe("root cause dimension", () => {
    it("lists live classifications with signatures in scope", async () => {
      const findMany = vi.fn().mockResolvedValue([
        { id: 5, name: "Env flake", color: { value: "#f00" } },
        { id: 7, name: "Product bug", color: null },
      ]);
      const db = { failureClassification: { findMany } } as unknown as DbClient;

      const dim = createTestExecutionDimensionRegistry(true).rootCause as any;
      const values = await dim.getValues(db, 370);

      const where = findMany.mock.calls[0][0].where;
      expect(where.isDeleted).toBe(false);
      expect(where.signatures.some.projectId).toBe(370);
      expect(dim.display(values[0])).toEqual({
        name: "Env flake",
        id: 5,
        color: "#f00",
      });
      expect(dim.display(values[1]).color).toBeNull();
    });

    it("groups the union by effective classification, with None for the rest", async () => {
      const manualRow = {
        executedAt: new Date("2026-07-01T10:00:00.000Z"),
        executedById: "u1",
        statusId: 2,
        testRunId: 100,
        testRunCaseId: 11,
        testRun: { projectId: 370, configId: null, milestoneId: null },
      };
      const junitRow = (classificationId: number | null, signature = true) => ({
        executedAt: new Date("2026-07-01T10:00:00.000Z"),
        createdById: "ci",
        statusId: 3,
        time: 3,
        repositoryCaseId: 42,
        failureSignature: signature ? { classificationId } : null,
        testSuite: {
          testRunId: 200,
          testRun: { projectId: 370, configId: null, milestoneId: null },
        },
      });
      const db = {
        testRunResults: { findMany: vi.fn().mockResolvedValue([manualRow]) },
        jUnitTestResult: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              junitRow(5),
              junitRow(5),
              junitRow(null),
              junitRow(null, false),
            ]),
        },
      } as unknown as DbClient;

      const rows: any[] = await createTestExecutionMetricRegistry(
        true
      ).testResults.aggregate(db, 370, ["rootCauseId"], {});

      expect(
        Object.fromEntries(
          rows.map((r) => [String(r.rootCauseId), r.testResults])
        )
      ).toEqual({ "5": 2, null: 3 });
    });
  });

  // The Issue dimension fans a row out per linked issue, like tag.
  describe("issue dimension", () => {
    it("groups execution rows by the executed case's linked issues", async () => {
      const manualRow = {
        executedAt: new Date("2026-07-01T10:00:00.000Z"),
        executedById: "u1",
        statusId: 2,
        testRunId: 100,
        testRunCaseId: 11,
        testRun: { projectId: 370, configId: null, milestoneId: null },
        testRunCase: {
          repositoryCaseId: 7,
          repositoryCase: { caseIssues: [{ issueId: 31 }, { issueId: 32 }] },
        },
      };
      const unlinkedRow = {
        ...manualRow,
        testRunCaseId: 12,
        testRunCase: {
          repositoryCaseId: 8,
          repositoryCase: { caseIssues: [] },
        },
      };
      const db = {
        testRunResults: {
          findMany: vi.fn().mockResolvedValue([manualRow, unlinkedRow]),
        },
        jUnitTestResult: { findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as DbClient;

      const rows: any[] = await createTestExecutionMetricRegistry(
        true
      ).testResults.aggregate(db, 370, ["issueId"], {});

      expect(
        Object.fromEntries(rows.map((r) => [String(r.issueId), r.testResults]))
      ).toEqual({ "31": 1, "32": 1, null: 1 });
    });

    it("groups repository cases by their linked issues", async () => {
      const db = {
        repositoryCases: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 1,
              projectId: 370,
              createdAt: new Date("2026-07-01T10:00:00.000Z"),
              caseIssues: [{ issueId: 31 }],
            },
            {
              id: 2,
              projectId: 370,
              createdAt: new Date("2026-07-02T10:00:00.000Z"),
              caseIssues: [{ issueId: 31 }, { issueId: 32 }],
            },
          ]),
        },
      } as unknown as DbClient;

      const rows: any[] = await createRepositoryStatsMetricRegistry(
        true
      ).testCaseCount.aggregate(db, 370, ["issueId"], {});

      expect(
        Object.fromEntries(
          rows.map((r) => [String(r.issueId), r.testCaseCount])
        )
      ).toEqual({ "31": 2, "32": 1 });
    });

    it("labels issues as key: title and scopes values to linked cases", async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 31,
          name: "internal-31",
          title: "Checkout breaks",
          externalKey: "ABT-9",
          status: "Open",
          issueTypeName: "Story",
          issueTypeIconUrl: null,
        },
      ]);
      const db = { issue: { findMany } } as unknown as DbClient;

      const dim = createRepositoryStatsDimensionRegistry(true).issue as any;
      const values = await dim.getValues(db, 370);

      expect(values[0].name).toBe("ABT-9: Checkout breaks");
      expect(dim.display(values[0])).toMatchObject({
        id: 31,
        name: "ABT-9: Checkout breaks",
        status: "Open",
        issueTypeName: "Story",
      });
      const where = findMany.mock.calls[0][0].where;
      expect(where.caseIssues.some.case.projectId).toBe(370);
      expect(where.isDeleted).toBe(false);
    });
  });

  // First/Last Case Created and Case Creation Span reduce each group's cases
  // to a creation window.
  describe("repository-stats creation window metrics", () => {
    const registry = createRepositoryStatsMetricRegistry(true);
    const cases = [
      {
        id: 1,
        projectId: 370,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: 2,
        projectId: 370,
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
      },
      {
        id: 3,
        projectId: 371,
        createdAt: new Date("2026-07-05T00:00:00.000Z"),
      },
    ];

    function makeDb() {
      return {
        repositoryCases: {
          findMany: vi.fn().mockResolvedValue(cases),
          aggregate: vi.fn().mockResolvedValue({
            _min: { createdAt: new Date("2026-07-01T00:00:00.000Z") },
            _max: { createdAt: new Date("2026-07-13T12:00:00.000Z") },
          }),
        },
      } as unknown as DbClient;
    }

    it("reports each group's first and last creation", async () => {
      const db = makeDb();
      const first: any[] = await registry.firstCaseCreated.aggregate(
        db,
        370,
        ["projectId"],
        {}
      );
      const last: any[] = await registry.lastCaseCreated.aggregate(
        db,
        370,
        ["projectId"],
        {}
      );

      const firstByProject = Object.fromEntries(
        first.map((r) => [r.projectId, r.firstCaseCreated])
      );
      const lastByProject = Object.fromEntries(
        last.map((r) => [r.projectId, r.lastCaseCreated])
      );
      expect(firstByProject[370]).toBe("2026-07-01T00:00:00.000Z");
      expect(lastByProject[370]).toBe("2026-07-13T12:00:00.000Z");
      expect(firstByProject[371]).toBe(lastByProject[371]);
    });

    it("reports the span in days, to one decimal", async () => {
      const db = makeDb();
      const rows: any[] = await registry.caseCreationSpan.aggregate(
        db,
        370,
        ["projectId"],
        {}
      );
      const byProject = Object.fromEntries(
        rows.map((r) => [r.projectId, r.caseCreationSpan])
      );
      expect(byProject[370]).toBe(12.5);
      expect(byProject[371]).toBe(0);
    });

    it("uses a single aggregate in the no-dimension path", async () => {
      const db = makeDb();
      const rows: any[] = await registry.caseCreationSpan.aggregate(
        db,
        370,
        [],
        {}
      );
      expect(rows).toEqual([{ caseCreationSpan: 12.5 }]);
      expect((db as any).repositoryCases.findMany).not.toHaveBeenCalled();
    });
  });

  // Linked Cases counts distinct live cases behind the group's issues.
  describe("issue-tracking linkedCaseCount", () => {
    const issues = [
      {
        id: 11,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        createdById: "u1",
        integrationId: 5,
        issueTypeName: "Story",
        status: "Open",
        priority: "high",
        caseIssues: [{ caseId: 100 }, { caseId: 101 }],
      },
      {
        id: 12,
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
        createdById: "u1",
        integrationId: 5,
        issueTypeName: "Story",
        status: "Open",
        priority: "High",
        // caseId 101 is also linked to issue 11 — counted once per group.
        caseIssues: [{ caseId: 101 }],
      },
      {
        id: 13,
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
        createdById: "u2",
        integrationId: 5,
        issueTypeName: "Bug",
        status: "Open",
        priority: "low",
        caseIssues: [],
      },
    ];

    function makeDb() {
      return {
        issue: { findMany: vi.fn().mockResolvedValue(issues) },
      } as unknown as DbClient;
    }

    it("counts distinct cases per group (project-specific)", async () => {
      const db = makeDb();
      const rows: any[] = await createIssueTrackingMetricRegistry(
        true
      ).linkedCaseCount.aggregate(db, 370, ["issueTypeName"], {});

      expect(
        Object.fromEntries(
          rows.map((r) => [r.issueTypeName, r.linkedCaseCount])
        )
      ).toEqual({ Story: 2, Bug: 0 });
    });

    it("counts distinct cases overall when there is no grouping", async () => {
      const db = makeDb();
      const rows: any[] = await createIssueTrackingMetricRegistry(
        false
      ).linkedCaseCount.aggregate(db, undefined, [], {});
      expect(rows).toEqual([{ linkedCaseCount: 2 }]);
    });

    it("normalizes priority group keys like issueCount does", async () => {
      const db = makeDb();
      const rows: any[] = await createIssueTrackingMetricRegistry(
        false
      ).linkedCaseCount.aggregate(db, undefined, ["priority"], {});
      expect(
        Object.fromEntries(rows.map((r) => [r.priority, r.linkedCaseCount]))
      ).toEqual({ High: 2, Low: 0 });
    });
  });
});
