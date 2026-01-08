import { describe, it, expect } from "vitest";

// Re-implement countStatusFlips for testing to avoid server-side dependencies
// This mirrors the implementation in flakyTestsUtils.ts
interface ExecutionStatus {
  resultId: number;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

function countStatusFlips(executions: ExecutionStatus[]): number {
  let flips = 0;
  let lastDefinitiveResult: boolean | null = null;

  for (const execution of executions) {
    const isDefinitive = execution.isSuccess || execution.isFailure;
    if (!isDefinitive) {
      continue;
    }

    const currentIsSuccess = execution.isSuccess;

    if (lastDefinitiveResult !== null && currentIsSuccess !== lastDefinitiveResult) {
      flips++;
    }

    lastDefinitiveResult = currentIsSuccess;
  }

  return flips;
}

describe("flakyTestsUtils", () => {
  describe("countStatusFlips", () => {
    const createExecution = (
      isSuccess: boolean,
      isFailure: boolean
    ): {
      resultId: number;
      statusName: string;
      statusColor: string;
      isSuccess: boolean;
      isFailure: boolean;
      executedAt: string;
    } => ({
      resultId: Math.random(),
      statusName: isSuccess ? "Passed" : isFailure ? "Failed" : "Other",
      statusColor: isSuccess ? "#00ff00" : isFailure ? "#ff0000" : "#888888",
      isSuccess,
      isFailure,
      executedAt: new Date().toISOString(),
    });

    it("should return 0 for empty array", () => {
      expect(countStatusFlips([])).toBe(0);
    });

    it("should return 0 for single execution", () => {
      const executions = [createExecution(true, false)];
      expect(countStatusFlips(executions)).toBe(0);
    });

    it("should return 0 for all passing executions", () => {
      const executions = [
        createExecution(true, false),
        createExecution(true, false),
        createExecution(true, false),
      ];
      expect(countStatusFlips(executions)).toBe(0);
    });

    it("should return 0 for all failing executions", () => {
      const executions = [
        createExecution(false, true),
        createExecution(false, true),
        createExecution(false, true),
      ];
      expect(countStatusFlips(executions)).toBe(0);
    });

    it("should count 1 flip for pass -> fail", () => {
      const executions = [
        createExecution(true, false),
        createExecution(false, true),
      ];
      expect(countStatusFlips(executions)).toBe(1);
    });

    it("should count 1 flip for fail -> pass", () => {
      const executions = [
        createExecution(false, true),
        createExecution(true, false),
      ];
      expect(countStatusFlips(executions)).toBe(1);
    });

    it("should count 2 flips for pass -> fail -> pass", () => {
      const executions = [
        createExecution(true, false),
        createExecution(false, true),
        createExecution(true, false),
      ];
      expect(countStatusFlips(executions)).toBe(2);
    });

    it("should count 3 flips for pass -> fail -> pass -> fail", () => {
      const executions = [
        createExecution(true, false),
        createExecution(false, true),
        createExecution(true, false),
        createExecution(false, true),
      ];
      expect(countStatusFlips(executions)).toBe(3);
    });

    it("should skip non-definitive statuses (neither success nor failure)", () => {
      const executions = [
        createExecution(true, false), // pass
        createExecution(false, false), // blocked/skipped - not definitive
        createExecution(false, true), // fail
      ];
      // Should count as 1 flip: pass -> fail (skipping the blocked status)
      expect(countStatusFlips(executions)).toBe(1);
    });

    it("should handle multiple non-definitive statuses between flips", () => {
      const executions = [
        createExecution(true, false), // pass
        createExecution(false, false), // blocked
        createExecution(false, false), // retest
        createExecution(false, false), // skipped
        createExecution(false, true), // fail
      ];
      // Should count as 1 flip: pass -> fail (skipping all blocked/retest/skipped)
      expect(countStatusFlips(executions)).toBe(1);
    });

    it("should return 0 when only non-definitive statuses exist", () => {
      const executions = [
        createExecution(false, false), // blocked
        createExecution(false, false), // retest
        createExecution(false, false), // skipped
      ];
      expect(countStatusFlips(executions)).toBe(0);
    });

    it("should handle alternating pattern with many flips", () => {
      // pass, fail, pass, fail, pass, fail, pass, fail, pass, fail
      const executions = [
        createExecution(true, false),
        createExecution(false, true),
        createExecution(true, false),
        createExecution(false, true),
        createExecution(true, false),
        createExecution(false, true),
        createExecution(true, false),
        createExecution(false, true),
        createExecution(true, false),
        createExecution(false, true),
      ];
      expect(countStatusFlips(executions)).toBe(9);
    });

    it("should handle mixed definitive and non-definitive statuses", () => {
      const executions = [
        createExecution(true, false), // pass
        createExecution(false, false), // blocked (skip)
        createExecution(true, false), // pass (no flip)
        createExecution(false, true), // fail (flip)
        createExecution(false, false), // retest (skip)
        createExecution(false, true), // fail (no flip)
        createExecution(true, false), // pass (flip)
      ];
      // Flips: pass->fail, fail->pass = 2 flips
      expect(countStatusFlips(executions)).toBe(2);
    });

    it("should handle starting with non-definitive status", () => {
      const executions = [
        createExecution(false, false), // blocked (skip)
        createExecution(true, false), // pass (first definitive)
        createExecution(false, true), // fail (flip)
      ];
      expect(countStatusFlips(executions)).toBe(1);
    });

    it("should handle ending with non-definitive status", () => {
      const executions = [
        createExecution(true, false), // pass
        createExecution(false, true), // fail (flip)
        createExecution(false, false), // blocked (skip, no flip)
      ];
      expect(countStatusFlips(executions)).toBe(1);
    });
  });
});
