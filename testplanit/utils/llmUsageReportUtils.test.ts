import { describe, expect, it, vi } from "vitest";
import {
  createLlmUsageDimensionRegistry,
  createLlmUsageMetricRegistry,
} from "./llmUsageReportUtils";

type UsageOverrides = Partial<{
  feature: string;
  model: string;
  userId: string;
  projectId: number | null;
  llmIntegrationId: number | null;
  success: boolean;
  createdAt: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCost: number | string;
  latency: number;
}>;

function usageRow(overrides: UsageOverrides = {}) {
  return {
    feature: "test_case_generation",
    model: "claude-sonnet-5",
    userId: "user-1",
    projectId: 1,
    llmIntegrationId: 10,
    success: true,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    totalCost: 0.01,
    latency: 2000,
    ...overrides,
    ...(overrides.createdAt
      ? { createdAt: new Date(overrides.createdAt) }
      : {}),
  };
}

function mockDb(rows: ReturnType<typeof usageRow>[]) {
  return {
    llmUsage: { findMany: vi.fn().mockResolvedValue(rows) },
  } as any;
}

describe("llmUsageReportUtils", () => {
  describe("metric registry", () => {
    const registry = createLlmUsageMetricRegistry(false);

    it("counts calls grouped by a single dimension", async () => {
      const db = mockDb([
        usageRow(),
        usageRow(),
        usageRow({ feature: "auto_tag" }),
      ]);
      const rows = await registry.llmCallCount.aggregate(
        db,
        undefined,
        ["feature"],
        undefined
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { feature: "test_case_generation", llmCallCount: 2 },
          { feature: "auto_tag", llmCallCount: 1 },
        ])
      );
      expect(rows).toHaveLength(2);
    });

    it("sums tokens across composite group keys", async () => {
      const db = mockDb([
        usageRow({ totalTokens: 100 }),
        usageRow({ totalTokens: 25 }),
        usageRow({ model: "gpt-5", totalTokens: 7 }),
      ]);
      const rows = await registry.totalTokens.aggregate(
        db,
        undefined,
        ["feature", "model"],
        undefined
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            model: "claude-sonnet-5",
            totalTokens: 125,
          }),
          expect.objectContaining({ model: "gpt-5", totalTokens: 7 }),
        ])
      );
    });

    it("returns a single totals bucket with no dimensions", async () => {
      const db = mockDb([
        usageRow({ promptTokens: 10 }),
        usageRow({ promptTokens: 30 }),
      ]);
      const rows = await registry.promptTokens.aggregate(
        db,
        undefined,
        [],
        undefined
      );
      expect(rows).toEqual([{ promptTokens: 40 }]);
    });

    it("buckets createdAt group keys to UTC midnight", async () => {
      const db = mockDb([
        usageRow({ createdAt: "2026-08-01T00:30:00Z" }),
        usageRow({ createdAt: "2026-08-01T23:59:00Z" }),
        usageRow({ createdAt: "2026-08-02T05:00:00Z" }),
      ]);
      const rows = await registry.llmCallCount.aggregate(
        db,
        undefined,
        ["createdAt"],
        undefined
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { createdAt: "2026-08-01T00:00:00.000Z", llmCallCount: 2 },
          { createdAt: "2026-08-02T00:00:00.000Z", llmCallCount: 1 },
        ])
      );
    });

    it("keeps null project rows as their own group instead of dropping them", async () => {
      const db = mockDb([
        usageRow({ projectId: null }),
        usageRow({ projectId: 1 }),
      ]);
      const rows = await registry.llmCallCount.aggregate(
        db,
        undefined,
        ["projectId"],
        undefined
      );
      expect(rows).toEqual(
        expect.arrayContaining([
          { projectId: null, llmCallCount: 1 },
          { projectId: 1, llmCallCount: 1 },
        ])
      );
    });

    it("sums cost from Decimal-typed values and rounds float noise to 6 places", async () => {
      // Prisma returns Decimal objects; Number() is how the aggregate reads
      // them. 0.1 + 0.2 exercises the rounding.
      const db = mockDb([
        usageRow({ totalCost: "0.1" }),
        usageRow({ totalCost: "0.2" }),
      ]);
      const rows = await registry.totalCost.aggregate(
        db,
        undefined,
        [],
        undefined
      );
      expect(rows).toEqual([{ totalCost: 0.3 }]);
    });

    it("reports average latency in seconds", async () => {
      const db = mockDb([
        usageRow({ latency: 1000 }),
        usageRow({ latency: 4000 }),
      ]);
      const rows = await registry.avgLatency.aggregate(
        db,
        undefined,
        [],
        undefined
      );
      expect(rows).toEqual([{ avgLatency: 2.5 }]);
    });

    it("computes success rate and failed calls per group", async () => {
      const db = mockDb([
        usageRow({ success: true }),
        usageRow({ success: true }),
        usageRow({ success: false }),
        usageRow({ feature: "auto_tag", success: false }),
      ]);
      const successRows = await registry.successRate.aggregate(
        db,
        undefined,
        ["feature"],
        undefined
      );
      expect(successRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            feature: "test_case_generation",
            successRate: (2 / 3) * 100,
          }),
          expect.objectContaining({ feature: "auto_tag", successRate: 0 }),
        ])
      );

      const errorRows = await registry.errorCount.aggregate(
        db,
        undefined,
        ["feature"],
        undefined
      );
      expect(errorRows).toEqual(
        expect.arrayContaining([
          { feature: "test_case_generation", errorCount: 1 },
          { feature: "auto_tag", errorCount: 1 },
        ])
      );
    });

    it("ignores group fields that are not LlmUsage columns", async () => {
      const db = mockDb([usageRow(), usageRow()]);
      const rows = await registry.llmCallCount.aggregate(
        db,
        undefined,
        ["feature", "nonsenseField"],
        undefined
      );
      expect(rows).toEqual([
        { feature: "test_case_generation", llmCallCount: 2 },
      ]);
    });

    it("applies the date filter to the query", async () => {
      const db = mockDb([]);
      await registry.llmCallCount.aggregate(db, undefined, ["feature"], {
        startDate: "2026-08-01T00:00:00Z",
        endDate: "2026-08-02T00:00:00Z",
      });
      const where = db.llmUsage.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({
        gte: new Date("2026-08-01T00:00:00Z"),
        lt: new Date("2026-08-03T00:00:00Z"),
      });
    });

    it("scopes to the project only when project-specific", async () => {
      const projectRegistry = createLlmUsageMetricRegistry(true);
      const db = mockDb([]);
      await projectRegistry.llmCallCount.aggregate(db, 42, ["feature"]);
      expect(db.llmUsage.findMany.mock.calls[0][0].where.projectId).toBe(42);

      const crossDb = mockDb([]);
      await registry.llmCallCount.aggregate(crossDb, undefined, ["feature"]);
      expect(
        crossDb.llmUsage.findMany.mock.calls[0][0].where.projectId
      ).toBeUndefined();
    });
  });

  describe("dimension registry", () => {
    it("includes the project dimension only for cross-project reports", () => {
      expect(createLlmUsageDimensionRegistry(false).project).toBeDefined();
      expect(createLlmUsageDimensionRegistry(true).project).toBeUndefined();
    });

    it("prettifies feature slugs for display but keys groups by the raw slug", async () => {
      const registry = createLlmUsageDimensionRegistry(false);
      const db = {
        llmUsage: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ feature: "test_case_generation" }]),
        },
      } as any;
      const values = await registry.feature.getValues(db);
      expect(values).toEqual([
        {
          id: "test_case_generation",
          name: "Test Case Generation",
          feature: "test_case_generation",
        },
      ]);
      expect(registry.feature.display(values[0])).toEqual({
        id: "test_case_generation",
        name: "Test Case Generation",
      });
    });

    it("outcome values use String(success) ids so group keys and filters match", async () => {
      const registry = createLlmUsageDimensionRegistry(false);
      const values = await registry.outcome.getValues();
      expect(values.map((v: any) => v.id)).toEqual(["true", "false"]);
      // The shared lookup keys on the groupBy column value
      expect(values.map((v: any) => String(v.success))).toEqual([
        "true",
        "false",
      ]);
    });

    it("date values dedupe to UTC days", async () => {
      const registry = createLlmUsageDimensionRegistry(false);
      const db = {
        llmUsage: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { createdAt: new Date("2026-08-01T02:00:00Z") },
              { createdAt: new Date("2026-08-01T20:00:00Z") },
              { createdAt: new Date("2026-08-02T00:00:00Z") },
            ]),
        },
      } as any;
      const values = await registry.date.getValues(db);
      expect(values).toEqual([
        { createdAt: "2026-08-01T00:00:00.000Z" },
        { createdAt: "2026-08-02T00:00:00.000Z" },
      ]);
    });
  });
});
