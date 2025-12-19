import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();

vi.mock("~/lib/prismaBase", () => ({
  prisma: {
    testRunCases: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    testRuns: {
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}));

import { updateTestRunForecast } from "./testRunService";

describe("testRunService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("updateTestRunForecast", () => {
    it("should calculate and update forecast from test run cases", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 100,
            forecastAutomated: 50,
          },
        },
        {
          id: 2,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 200,
            forecastAutomated: 100,
          },
        },
      ]);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { testRunId: 1 },
        include: {
          repositoryCase: {
            select: {
              forecastManual: true,
              forecastAutomated: true,
            },
          },
        },
      });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          forecastManual: 300, // 100 + 200
          forecastAutomated: 150, // 50 + 100
        },
      });

      consoleSpy.mockRestore();
    });

    it("should treat null forecasts as 0", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          testRunId: 1,
          repositoryCase: {
            forecastManual: null,
            forecastAutomated: 50,
          },
        },
        {
          id: 2,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 100,
            forecastAutomated: null,
          },
        },
      ]);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          forecastManual: 100, // 0 + 100
          forecastAutomated: 50, // 50 + 0
        },
      });

      consoleSpy.mockRestore();
    });

    it("should handle cases with no repository case", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          testRunId: 1,
          repositoryCase: null,
        },
        {
          id: 2,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 100,
            forecastAutomated: 50,
          },
        },
      ]);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          forecastManual: 100,
          forecastAutomated: 50,
        },
      });

      consoleSpy.mockRestore();
    });

    it("should handle empty test run cases", async () => {
      mockFindMany.mockResolvedValue([]);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          forecastManual: 0,
          forecastAutomated: 0,
        },
      });

      consoleSpy.mockRestore();
    });

    it("should log success message", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 100,
            forecastAutomated: 50,
          },
        },
      ]);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(42);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Updated forecast for TestRun 42 to forecastManual=100, forecastAutomated=50"
      );

      consoleSpy.mockRestore();
    });

    it("should handle database errors gracefully", async () => {
      mockFindMany.mockRejectedValue(new Error("Database error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error updating forecast for TestRun 1:",
        expect.any(Error)
      );
      expect(mockUpdate).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle update errors gracefully", async () => {
      mockFindMany.mockResolvedValue([]);
      mockUpdate.mockRejectedValue(new Error("Update failed"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error updating forecast for TestRun 1:",
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it("should handle decimal forecast values", async () => {
      mockFindMany.mockResolvedValue([
        {
          id: 1,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 10.5,
            forecastAutomated: 20.25,
          },
        },
        {
          id: 2,
          testRunId: 1,
          repositoryCase: {
            forecastManual: 5.5,
            forecastAutomated: 9.75,
          },
        },
      ]);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          forecastManual: 16, // 10.5 + 5.5
          forecastAutomated: 30, // 20.25 + 9.75
        },
      });

      consoleSpy.mockRestore();
    });

    it("should handle large number of test run cases", async () => {
      const cases = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        testRunId: 1,
        repositoryCase: {
          forecastManual: 10,
          forecastAutomated: 5,
        },
      }));
      mockFindMany.mockResolvedValue(cases);
      mockUpdate.mockResolvedValue({});
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await updateTestRunForecast(1);

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          forecastManual: 1000, // 100 * 10
          forecastAutomated: 500, // 100 * 5
        },
      });

      consoleSpy.mockRestore();
    });
  });
});
