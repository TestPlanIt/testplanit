import { NotificationType } from "~/zenstack/models";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

// Mock NotificationService before importing the service under test
vi.mock("./notificationService", () => ({
  NotificationService: {
    createNotification: vi.fn().mockResolvedValue("job-123"),
  },
}));

import { BudgetAlertService, THRESHOLDS } from "./budgetAlertService";
import { NotificationService } from "./notificationService";

// Helper to create a mock Prisma client
function createMockDb() {
  return {
    llmProviderConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    llmUsage: {
      aggregate: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  };
}

// Helper to create a valid provider config
function createConfig(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    llmIntegrationId: 1,
    monthlyBudget: { toString: () => "100.00", toNumber: () => 100 },
    billingPeriodStartDay: 1,
    alertThresholdsFired: null,
    llmIntegration: {
      name: "OpenAI GPT-4",
      isDeleted: false,
    },
    ...overrides,
  };
}

// Helper to create aggregate result
function createAggregateResult(totalCost: number | null) {
  return {
    _sum: {
      totalCost:
        totalCost !== null
          ? { toString: () => totalCost.toFixed(6), toNumber: () => totalCost }
          : null,
    },
  };
}

describe("BudgetAlertService", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let service: BudgetAlertService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset date to a fixed point for deterministic month key
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    mockDb = createMockDb();
    service = new BudgetAlertService(mockDb as any);

    // Default: return 2 admins
    mockDb.user.findMany.mockResolvedValue([
      { id: "admin-1" },
      { id: "admin-2" },
    ]);
    // Default: update succeeds
    mockDb.llmProviderConfig.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("THRESHOLDS constant", () => {
    it("should export thresholds as [80, 90, 100]", () => {
      expect(THRESHOLDS).toEqual([80, 90, 100]);
    });
  });

  describe("threshold detection", () => {
    it("returns [80] when spend is 82% of budget", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(82));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([80]);
      expect(result.currentSpend).toBe(82);
      expect(result.budget).toBe(100);
    });

    it("returns [80, 90] when spend is 95% of budget", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(95));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([80, 90]);
    });

    it("returns [80, 90, 100] when spend is 105% of budget", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(105));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([80, 90, 100]);
    });

    it("returns [] when spend is 50% of budget", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(50));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([]);
      expect(result.currentSpend).toBe(50);
      expect(result.budget).toBe(100);
    });

    it("returns [] when spend is zero", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(0));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([]);
    });

    it("crosses threshold at exactly 80% (>= comparison)", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(80));

      const result = await service.checkAndAlert(1);

      expect(result.thresholdsCrossed).toEqual([80]);
    });

    it("crosses threshold at exactly 90%", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(90));

      const result = await service.checkAndAlert(1);

      expect(result.thresholdsCrossed).toEqual([80, 90]);
    });

    it("crosses threshold at exactly 100%", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(100));

      const result = await service.checkAndAlert(1);

      expect(result.thresholdsCrossed).toEqual([80, 90, 100]);
    });
  });

  describe("deduplication", () => {
    it("skips already-fired threshold 80 when spend is 92%", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-03-01": [80] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(92));

      const result = await service.checkAndAlert(1);

      expect(result.thresholdsCrossed).toEqual([90]);
    });

    it("returns [] when all thresholds already fired for current month", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-03-01": [80, 90, 100] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(150));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([]);
    });

    it("fires threshold 80 in new month even if fired in previous month", async () => {
      // Previous month (February) had 80 and 90 fired
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-02-01": [80, 90] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      const result = await service.checkAndAlert(1);

      // New month (March) should fire 80 again
      expect(result.thresholdsCrossed).toEqual([80]);
    });

    it("treats null alertThresholdsFired as empty object", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: null,
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(82));

      const result = await service.checkAndAlert(1);

      expect(result.thresholdsCrossed).toEqual([80]);
    });
  });

  describe("period boundary", () => {
    it("uses period-start ISO date as key (YYYY-MM-DD)", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1);

      // Default billingPeriodStartDay=1 with system time 2026-03-15 -> "2026-03-01"
      expect(mockDb.llmProviderConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            alertThresholdsFired: expect.objectContaining({
              "2026-03-01": expect.any(Array),
            }),
          }),
        })
      );
    });

    it("preserves previous period entries in alertThresholdsFired", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-02-01": [80, 90] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1);

      // Should preserve "2026-02-01" and add "2026-03-01"
      expect(mockDb.llmProviderConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            alertThresholdsFired: {
              "2026-02-01": [80, 90],
              "2026-03-01": [80],
            },
          }),
        })
      );
    });
  });

  describe("custom billing period (billingPeriodStartDay !== 1)", () => {
    it("aggregates spend with gte=Apr 15 when billingPeriodStartDay=15 and now is Apr 20", async () => {
      vi.setSystemTime(new Date(2026, 3, 20, 12, 0, 0)); // Apr 20 2026 local
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          billingPeriodStartDay: 15,
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(50));

      await service.checkAndAlert(1);

      const expectedPeriodStart = new Date(2026, 3, 15, 0, 0, 0, 0);
      expect(mockDb.llmUsage.aggregate).toHaveBeenCalledWith({
        where: {
          llmIntegrationId: 1,
          createdAt: { gte: expectedPeriodStart },
        },
        _sum: { totalCost: true },
      });
    });

    it("uses period-start ISO date 2026-04-15 as key when billingPeriodStartDay=15 and now is Apr 20", async () => {
      vi.setSystemTime(new Date(2026, 3, 20, 12, 0, 0));
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          billingPeriodStartDay: 15,
          alertThresholdsFired: { "2026-04-15": [80] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(92));

      const result = await service.checkAndAlert(1);

      // 92% should newly cross 90 (80 already fired in 2026-04-15 period)
      expect(result.thresholdsCrossed).toEqual([90]);
      expect(mockDb.llmProviderConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            alertThresholdsFired: {
              "2026-04-15": [80, 90],
            },
          }),
        })
      );
    });

    it("regression guard: thresholds fired in 2026-03-15 period do NOT block 2026-04-15 period", async () => {
      vi.setSystemTime(new Date(2026, 3, 20, 12, 0, 0));
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          billingPeriodStartDay: 15,
          alertThresholdsFired: { "2026-03-15": [80, 90, 100] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      const result = await service.checkAndAlert(1);

      // New period (2026-04-15) should fire 80 again even though prev period had it
      expect(result.thresholdsCrossed).toEqual([80]);
      expect(mockDb.llmProviderConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            alertThresholdsFired: {
              "2026-03-15": [80, 90, 100],
              "2026-04-15": [80],
            },
          }),
        })
      );
    });
  });

  describe("notification delivery", () => {
    it("creates notifications for all active ADMIN users", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1, "tenant-123");

      // Should query for admin users
      expect(mockDb.user.findMany).toHaveBeenCalledWith({
        where: { access: "ADMIN", isActive: true, isDeleted: false },
        select: { id: true },
      });

      // Should create notification for each admin (2 admins)
      expect(NotificationService.createNotification).toHaveBeenCalledTimes(2);
    });

    it("passes tenantId to createNotification", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1, "tenant-xyz");

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-xyz",
        })
      );
    });

    it("sends no notifications when no ADMIN users exist", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));
      mockDb.user.findMany.mockResolvedValue([]);

      const result = await service.checkAndAlert(1);

      expect(result.thresholdsCrossed).toEqual([80]);
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("creates a notification per threshold per admin", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(95));

      await service.checkAndAlert(1);

      // 2 thresholds (80, 90) x 2 admins = 4 notifications
      expect(NotificationService.createNotification).toHaveBeenCalledTimes(4);
    });

    it("uses NotificationType.LLM_BUDGET_ALERT for all notifications", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1);

      const calls = (NotificationService.createNotification as Mock).mock.calls;
      for (const call of calls) {
        expect(call[0].type).toBe(NotificationType.LLM_BUDGET_ALERT);
      }
    });

    it("includes link /admin/llm in notification data", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            link: "/admin/llm",
          }),
        })
      );
    });
  });

  describe("notification content", () => {
    it("title at 80%: 'LLM Budget 80% Used'", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(82));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "LLM Budget 80% Used",
        })
      );
    });

    it("title at 90%: 'LLM Budget 90% Used'", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-03-01": [80] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(92));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "LLM Budget 90% Used",
        })
      );
    });

    it("title at 100%: 'LLM Budget Exceeded'", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-03-01": [80, 90] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(105));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "LLM Budget Exceeded",
        })
      );
    });

    it("message includes provider name", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          llmIntegration: { name: "Claude Sonnet", isDeleted: false },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Claude Sonnet"),
        })
      );
    });

    it("message includes dollar-formatted spend and budget amounts", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(82.5));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/\$82\.50.*\$100\.00/),
        })
      );
    });

    it("message does not include disclaimer (disclaimer is rendered in UI)", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));

      await service.checkAndAlert(1);

      expect(NotificationService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.not.stringContaining("Budget limits"),
        })
      );
    });
  });

  describe("early exits", () => {
    it("returns checked=false when provider config is null", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(null);

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(false);
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("returns checked=false when provider is deleted", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          llmIntegration: { name: "Deleted Provider", isDeleted: true },
        })
      );

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(false);
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });

    it("returns checked=false when monthlyBudget is null", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          monthlyBudget: null,
        })
      );

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(false);
    });

    it("returns checked=false when monthlyBudget is zero", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          monthlyBudget: {
            toString: () => "0.00",
            toNumber: () => 0,
          },
        })
      );

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(false);
    });

    it("does not query usage when budget is null", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({ monthlyBudget: null })
      );

      await service.checkAndAlert(1);

      expect(mockDb.llmUsage.aggregate).not.toHaveBeenCalled();
    });

    it("does not send notifications when no new thresholds crossed", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(50));

      const result = await service.checkAndAlert(1);

      expect(result.checked).toBe(true);
      expect(result.thresholdsCrossed).toEqual([]);
      expect(NotificationService.createNotification).not.toHaveBeenCalled();
    });
  });

  describe("decimal handling", () => {
    it("converts Prisma Decimal monthlyBudget via Number() before comparison", async () => {
      // Prisma Decimal objects have toString() but Number() is needed for arithmetic
      const decimalBudget = {
        toString: () => "150.00",
        toNumber: () => 150,
        // Simulate that direct comparison would fail
        valueOf: () => "150.00",
      };
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({ monthlyBudget: decimalBudget })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(125));

      const result = await service.checkAndAlert(1);

      // 125/150 = 83.3% -> crosses 80% threshold
      expect(result.thresholdsCrossed).toEqual([80]);
      expect(result.budget).toBe(150);
    });

    it("converts aggregated totalCost via Number() before comparison", async () => {
      const decimalCost = {
        toString: () => "82.500000",
        toNumber: () => 82.5,
        valueOf: () => "82.500000",
      };
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue({
        _sum: { totalCost: decimalCost },
      });

      const result = await service.checkAndAlert(1);

      expect(result.currentSpend).toBe(82.5);
      expect(result.thresholdsCrossed).toEqual([80]);
    });

    it("treats null totalCost (no usage records) as zero spend", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(null));

      const result = await service.checkAndAlert(1);

      expect(result.currentSpend).toBe(0);
      expect(result.thresholdsCrossed).toEqual([]);
    });
  });

  describe("alertThresholdsFired update", () => {
    it("writes newly crossed thresholds to alertThresholdsFired", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(95));

      await service.checkAndAlert(1);

      expect(mockDb.llmProviderConfig.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          alertThresholdsFired: {
            "2026-03-01": [80, 90],
          },
        },
      });
    });

    it("merges newly crossed thresholds with already-fired thresholds", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(
        createConfig({
          alertThresholdsFired: { "2026-03-01": [80] },
        })
      );
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(105));

      await service.checkAndAlert(1);

      expect(mockDb.llmProviderConfig.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          alertThresholdsFired: {
            "2026-03-01": [80, 90, 100],
          },
        },
      });
    });

    it("does not call update when no new thresholds crossed", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(50));

      await service.checkAndAlert(1);

      expect(mockDb.llmProviderConfig.update).not.toHaveBeenCalled();
    });

    it("updates before sending notifications (atomicity)", async () => {
      const callOrder: string[] = [];
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(85));
      mockDb.llmProviderConfig.update.mockImplementation(async () => {
        callOrder.push("update");
        return {};
      });
      (NotificationService.createNotification as Mock).mockImplementation(
        async () => {
          callOrder.push("notify");
          return "job-123";
        }
      );

      await service.checkAndAlert(1);

      // Update should happen before any notification
      expect(callOrder[0]).toBe("update");
      expect(callOrder.slice(1).every((c) => c === "notify")).toBe(true);
    });
  });

  describe("spend aggregation", () => {
    it("queries llmUsage with gte=billing period start when billingPeriodStartDay=1 (default)", async () => {
      mockDb.llmProviderConfig.findUnique.mockResolvedValue(createConfig());
      mockDb.llmUsage.aggregate.mockResolvedValue(createAggregateResult(50));

      await service.checkAndAlert(1);

      // Default billingPeriodStartDay=1 with system time 2026-03-15 -> Mar 1 00:00 local
      const expectedPeriodStart = new Date(2026, 2, 1, 0, 0, 0, 0);

      expect(mockDb.llmUsage.aggregate).toHaveBeenCalledWith({
        where: {
          llmIntegrationId: 1,
          createdAt: { gte: expectedPeriodStart },
        },
        _sum: { totalCost: true },
      });
    });
  });
});
