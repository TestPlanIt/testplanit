import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the prisma client used by forecastService.
const repoFindUnique = vi.fn();
const repoFindMany = vi.fn();
const repoUpdate = vi.fn();
const trcFindMany = vi.fn();
const trrFindMany = vi.fn();
const junitFindMany = vi.fn();
const runsFindUnique = vi.fn();
const runsUpdate = vi.fn();

vi.mock("../lib/prismaBase", () => ({
  prisma: {
    repositoryCases: {
      findUnique: (...a: any[]) => repoFindUnique(...a),
      findMany: (...a: any[]) => repoFindMany(...a),
      update: (...a: any[]) => repoUpdate(...a),
    },
    testRunCases: { findMany: (...a: any[]) => trcFindMany(...a) },
    testRunResults: { findMany: (...a: any[]) => trrFindMany(...a) },
    jUnitTestResult: { findMany: (...a: any[]) => junitFindMany(...a) },
    testRuns: {
      findUnique: (...a: any[]) => runsFindUnique(...a),
      update: (...a: any[]) => runsUpdate(...a),
    },
  },
}));

import {
  updateRepositoryCaseForecast,
  updateTestRunForecast,
} from "./forecastService";

describe("forecastService — soft-deleted cases are ignored", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateRepositoryCaseForecast", () => {
    it("filters soft-deleted cases out of the group and never writes their forecasts", async () => {
      // Seed case 1 is linked to case 2 (which is soft-deleted in the DB).
      repoFindUnique.mockResolvedValue({
        id: 1,
        source: "MANUAL",
        linksFrom: [{ caseBId: 2 }],
        linksTo: [],
      });

      // repositoryCases.findMany is used twice: (a) the group fetch with a
      // `source` selection, (b) the current-forecasts fetch keyed by id.
      repoFindMany.mockImplementation((arg: any) => {
        if (arg?.select?.source) {
          // allCases: the DB returns only the live case (2 is soft-deleted).
          return Promise.resolve([{ id: 1, source: "MANUAL" }]);
        }
        // currentForecasts (keyed off liveCaseIds).
        return Promise.resolve([
          { id: 1, forecastManual: null, forecastAutomated: null },
        ]);
      });

      trcFindMany.mockResolvedValue([]); // no manual results, no affected runs
      repoUpdate.mockResolvedValue({});

      await updateRepositoryCaseForecast(1, { skipTestRunUpdate: true });

      // The group query must exclude soft-deleted cases.
      const allCasesCall = repoFindMany.mock.calls.find(
        (c) => c[0]?.select?.source
      );
      expect(allCasesCall?.[0].where).toEqual({
        id: { in: [1, 2] },
        isDeleted: false,
      });

      // Forecast writes are scoped to the live case ids only — case 2 is gone.
      const currentForecastsCall = repoFindMany.mock.calls.find(
        (c) => c[0]?.select?.forecastManual && c[0]?.select?.id
      );
      expect(currentForecastsCall?.[0].where).toEqual({ id: { in: [1] } });

      // The soft-deleted case 2 must never be updated.
      const updatedIds = repoUpdate.mock.calls.map((c) => c[0]?.where?.id);
      expect(updatedIds).not.toContain(2);
    });
  });

  describe("updateTestRunForecast", () => {
    it("excludes soft-deleted memberships and soft-deleted repository cases from the run total", async () => {
      // Two untested cases in the run; the DB will only return the live one
      // from the forecast-sum query (case 2's repository case is deleted).
      trcFindMany.mockResolvedValue([
        { repositoryCaseId: 1, status: null },
        { repositoryCaseId: 2, status: null },
      ]);
      repoFindMany.mockResolvedValue([
        { forecastManual: 100, forecastAutomated: 50 },
      ]);
      runsFindUnique.mockResolvedValue({
        forecastManual: null,
        forecastAutomated: null,
      });
      runsUpdate.mockResolvedValue({});

      // Pre-seed alreadyRefreshedCaseIds so the function skips the per-case
      // refresh recursion and goes straight to the run-sum logic.
      await updateTestRunForecast(7, {
        alreadyRefreshedCaseIds: new Set([1, 2]),
      });

      // The run-membership query must exclude soft-deleted memberships.
      expect(trcFindMany.mock.calls[0][0].where).toEqual({
        testRunId: 7,
        isDeleted: false,
      });

      // The forecast-sum query must exclude soft-deleted repository cases.
      const sumCall = repoFindMany.mock.calls.find(
        (c) => c[0]?.select?.forecastManual && !c[0]?.select?.id
      );
      expect(sumCall?.[0].where).toEqual({
        id: { in: [1, 2] },
        isDeleted: false,
      });

      // Only the live case's forecast (100/50) lands on the run.
      expect(runsUpdate).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { forecastManual: 100, forecastAutomated: 50 },
      });
    });
  });
});
