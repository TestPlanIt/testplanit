import { describe, it, expect } from "vitest";
import { computeLastTestResult, LastTestResult } from "./computeLastTestResult";

describe("computeLastTestResult", () => {
  const createStatus = (id: number, name: string, colorValue?: string) => ({
    id,
    name,
    color: colorValue ? { value: colorValue } : undefined,
  });

  const createTestRun = (id: number, name: string, isDeleted = false) => ({
    id,
    name,
    isDeleted,
  });

  describe("when case has no results", () => {
    it("returns null for empty case", () => {
      const result = computeLastTestResult({});
      expect(result).toBeNull();
    });

    it("returns null when testRuns array is empty", () => {
      const result = computeLastTestResult({ testRuns: [], junitResults: [] });
      expect(result).toBeNull();
    });

    it("returns null when testRuns have no results", () => {
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run 1"),
            results: [],
          },
        ],
        junitResults: [],
      };
      const result = computeLastTestResult(caseItem);
      expect(result).toBeNull();
    });
  });

  describe("with manual test run results only", () => {
    it("returns the single result when only one exists", () => {
      const executedAt = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run 1"),
            results: [
              {
                id: 100,
                executedAt,
                status: createStatus(1, "Passed", "#00ff00"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result).not.toBeNull();
      expect(result!.status.name).toBe("Passed");
      expect(result!.executedAt).toEqual(executedAt);
      expect(result!.testRun).toEqual({ id: 1, name: "Test Run 1" });
    });

    it("returns the most recent result from multiple results", () => {
      const olderDate = new Date("2024-01-10T10:00:00Z");
      const newerDate = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run 1"),
            results: [
              {
                id: 100,
                executedAt: olderDate,
                status: createStatus(1, "Failed", "#ff0000"),
              },
              {
                id: 101,
                executedAt: newerDate,
                status: createStatus(2, "Passed", "#00ff00"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Passed");
      expect(result!.executedAt).toEqual(newerDate);
    });

    it("returns the most recent result across multiple test runs", () => {
      const oldestDate = new Date("2024-01-05T10:00:00Z");
      const middleDate = new Date("2024-01-10T10:00:00Z");
      const newestDate = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run 1"),
            results: [
              {
                id: 100,
                executedAt: oldestDate,
                status: createStatus(1, "Passed"),
              },
            ],
          },
          {
            testRun: createTestRun(2, "Test Run 2"),
            results: [
              {
                id: 101,
                executedAt: newestDate,
                status: createStatus(2, "Failed"),
              },
            ],
          },
          {
            testRun: createTestRun(3, "Test Run 3"),
            results: [
              {
                id: 102,
                executedAt: middleDate,
                status: createStatus(3, "Blocked"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Failed");
      expect(result!.testRun).toEqual({ id: 2, name: "Test Run 2" });
    });

    it("skips deleted test runs", () => {
      const deletedRunDate = new Date("2024-01-20T10:00:00Z");
      const activeRunDate = new Date("2024-01-10T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Deleted Run", true),
            results: [
              {
                id: 100,
                executedAt: deletedRunDate,
                status: createStatus(1, "Passed"),
              },
            ],
          },
          {
            testRun: createTestRun(2, "Active Run", false),
            results: [
              {
                id: 101,
                executedAt: activeRunDate,
                status: createStatus(2, "Failed"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Failed");
      expect(result!.testRun!.name).toBe("Active Run");
    });

    it("skips results without executedAt", () => {
      const validDate = new Date("2024-01-10T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run 1"),
            results: [
              {
                id: 100,
                executedAt: null,
                status: createStatus(1, "Passed"),
              },
              {
                id: 101,
                executedAt: validDate,
                status: createStatus(2, "Failed"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Failed");
    });

    it("skips results without status", () => {
      const validDate = new Date("2024-01-15T10:00:00Z");
      const invalidDate = new Date("2024-01-20T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run 1"),
            results: [
              {
                id: 100,
                executedAt: invalidDate,
                status: null,
              },
              {
                id: 101,
                executedAt: validDate,
                status: createStatus(2, "Passed"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Passed");
    });
  });

  describe("with JUnit results only", () => {
    it("returns the single JUnit result when only one exists", () => {
      const executedAt = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [],
        junitResults: [
          {
            id: 200,
            executedAt,
            status: createStatus(1, "Passed", "#00ff00"),
            testSuite: {
              id: 10,
              testRun: createTestRun(1, "CI Run"),
            },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Passed");
      expect(result!.executedAt).toEqual(executedAt);
      expect(result!.testRun).toEqual({ id: 1, name: "CI Run" });
    });

    it("returns the most recent JUnit result", () => {
      const olderDate = new Date("2024-01-10T10:00:00Z");
      const newerDate = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [],
        junitResults: [
          {
            id: 200,
            executedAt: olderDate,
            status: createStatus(1, "Failed"),
            testSuite: { id: 10, testRun: createTestRun(1, "CI Run 1") },
          },
          {
            id: 201,
            executedAt: newerDate,
            status: createStatus(2, "Passed"),
            testSuite: { id: 11, testRun: createTestRun(2, "CI Run 2") },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Passed");
      expect(result!.testRun!.name).toBe("CI Run 2");
    });

    it("skips deleted test runs in JUnit results", () => {
      const deletedRunDate = new Date("2024-01-20T10:00:00Z");
      const activeRunDate = new Date("2024-01-10T10:00:00Z");
      const caseItem = {
        testRuns: [],
        junitResults: [
          {
            id: 200,
            executedAt: deletedRunDate,
            status: createStatus(1, "Passed"),
            testSuite: { id: 10, testRun: createTestRun(1, "Deleted Run", true) },
          },
          {
            id: 201,
            executedAt: activeRunDate,
            status: createStatus(2, "Failed"),
            testSuite: { id: 11, testRun: createTestRun(2, "Active Run", false) },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Failed");
      expect(result!.testRun!.name).toBe("Active Run");
    });

    it("handles JUnit result without testSuite.testRun", () => {
      const executedAt = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [],
        junitResults: [
          {
            id: 200,
            executedAt,
            status: createStatus(1, "Passed"),
            testSuite: { id: 10, testRun: null },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Passed");
      expect(result!.testRun).toBeUndefined();
    });
  });

  describe("with mixed manual and JUnit results", () => {
    it("returns manual result when it is more recent", () => {
      const manualDate = new Date("2024-01-20T10:00:00Z");
      const junitDate = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Manual Run"),
            results: [
              {
                id: 100,
                executedAt: manualDate,
                status: createStatus(1, "Passed"),
              },
            ],
          },
        ],
        junitResults: [
          {
            id: 200,
            executedAt: junitDate,
            status: createStatus(2, "Failed"),
            testSuite: { id: 10, testRun: createTestRun(2, "CI Run") },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Passed");
      expect(result!.testRun!.name).toBe("Manual Run");
    });

    it("returns JUnit result when it is more recent", () => {
      const manualDate = new Date("2024-01-10T10:00:00Z");
      const junitDate = new Date("2024-01-20T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Manual Run"),
            results: [
              {
                id: 100,
                executedAt: manualDate,
                status: createStatus(1, "Passed"),
              },
            ],
          },
        ],
        junitResults: [
          {
            id: 200,
            executedAt: junitDate,
            status: createStatus(2, "Failed"),
            testSuite: { id: 10, testRun: createTestRun(2, "CI Run") },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.status.name).toBe("Failed");
      expect(result!.testRun!.name).toBe("CI Run");
    });

    it("handles same timestamp by returning one of them", () => {
      const sameDate = new Date("2024-01-15T10:00:00Z");
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Manual Run"),
            results: [
              {
                id: 100,
                executedAt: sameDate,
                status: createStatus(1, "Passed"),
              },
            ],
          },
        ],
        junitResults: [
          {
            id: 200,
            executedAt: sameDate,
            status: createStatus(2, "Failed"),
            testSuite: { id: 10, testRun: createTestRun(2, "CI Run") },
          },
        ],
      };

      const result = computeLastTestResult(caseItem);

      expect(result).not.toBeNull();
      expect(result!.executedAt).toEqual(sameDate);
    });
  });

  describe("date handling", () => {
    it("handles string dates by converting to Date objects", () => {
      const dateString = "2024-01-15T10:00:00Z";
      const caseItem = {
        testRuns: [
          {
            testRun: createTestRun(1, "Test Run"),
            results: [
              {
                id: 100,
                executedAt: dateString,
                status: createStatus(1, "Passed"),
              },
            ],
          },
        ],
        junitResults: [],
      };

      const result = computeLastTestResult(caseItem);

      expect(result!.executedAt).toBeInstanceOf(Date);
      expect(result!.executedAt.getTime()).toBe(new Date(dateString).getTime());
    });
  });
});
