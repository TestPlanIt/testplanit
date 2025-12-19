import { describe, it, expect } from "vitest";
import {
  AUTOMATED_TEST_RUN_TYPES,
  AUTOMATED_CASE_SOURCES,
  isAutomatedTestRunType,
  isAutomatedCaseSource,
  getTestRunTypeLabel,
  getCaseSourceLabel,
} from "./testResultTypes";

describe("testResultTypes", () => {
  describe("AUTOMATED_TEST_RUN_TYPES", () => {
    it("should contain all automated test run types", () => {
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("JUNIT");
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("TESTNG");
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("XUNIT");
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("NUNIT");
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("MSTEST");
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("MOCHA");
      expect(AUTOMATED_TEST_RUN_TYPES).toContain("CUCUMBER");
    });

    it("should have exactly 7 automated types", () => {
      expect(AUTOMATED_TEST_RUN_TYPES).toHaveLength(7);
    });

    it("should not contain REGULAR type", () => {
      expect(AUTOMATED_TEST_RUN_TYPES).not.toContain("REGULAR");
    });
  });

  describe("AUTOMATED_CASE_SOURCES", () => {
    it("should contain all automated case sources", () => {
      expect(AUTOMATED_CASE_SOURCES).toContain("JUNIT");
      expect(AUTOMATED_CASE_SOURCES).toContain("TESTNG");
      expect(AUTOMATED_CASE_SOURCES).toContain("XUNIT");
      expect(AUTOMATED_CASE_SOURCES).toContain("NUNIT");
      expect(AUTOMATED_CASE_SOURCES).toContain("MSTEST");
      expect(AUTOMATED_CASE_SOURCES).toContain("MOCHA");
      expect(AUTOMATED_CASE_SOURCES).toContain("CUCUMBER");
    });

    it("should have exactly 7 automated sources", () => {
      expect(AUTOMATED_CASE_SOURCES).toHaveLength(7);
    });

    it("should not contain MANUAL or API sources", () => {
      expect(AUTOMATED_CASE_SOURCES).not.toContain("MANUAL");
      expect(AUTOMATED_CASE_SOURCES).not.toContain("API");
    });
  });

  describe("isAutomatedTestRunType", () => {
    it("should return true for JUnit", () => {
      expect(isAutomatedTestRunType("JUNIT")).toBe(true);
    });

    it("should return true for TestNG", () => {
      expect(isAutomatedTestRunType("TESTNG")).toBe(true);
    });

    it("should return true for xUnit", () => {
      expect(isAutomatedTestRunType("XUNIT")).toBe(true);
    });

    it("should return true for NUnit", () => {
      expect(isAutomatedTestRunType("NUNIT")).toBe(true);
    });

    it("should return true for MSTest", () => {
      expect(isAutomatedTestRunType("MSTEST")).toBe(true);
    });

    it("should return true for Mocha", () => {
      expect(isAutomatedTestRunType("MOCHA")).toBe(true);
    });

    it("should return true for Cucumber", () => {
      expect(isAutomatedTestRunType("CUCUMBER")).toBe(true);
    });

    it("should return false for REGULAR", () => {
      expect(isAutomatedTestRunType("REGULAR")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isAutomatedTestRunType(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isAutomatedTestRunType(undefined)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isAutomatedTestRunType("")).toBe(false);
    });

    it("should return false for invalid type", () => {
      expect(isAutomatedTestRunType("INVALID")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(isAutomatedTestRunType("junit")).toBe(false);
      expect(isAutomatedTestRunType("Junit")).toBe(false);
    });
  });

  describe("isAutomatedCaseSource", () => {
    it("should return true for JUnit", () => {
      expect(isAutomatedCaseSource("JUNIT")).toBe(true);
    });

    it("should return true for TestNG", () => {
      expect(isAutomatedCaseSource("TESTNG")).toBe(true);
    });

    it("should return true for xUnit", () => {
      expect(isAutomatedCaseSource("XUNIT")).toBe(true);
    });

    it("should return true for NUnit", () => {
      expect(isAutomatedCaseSource("NUNIT")).toBe(true);
    });

    it("should return true for MSTest", () => {
      expect(isAutomatedCaseSource("MSTEST")).toBe(true);
    });

    it("should return true for Mocha", () => {
      expect(isAutomatedCaseSource("MOCHA")).toBe(true);
    });

    it("should return true for Cucumber", () => {
      expect(isAutomatedCaseSource("CUCUMBER")).toBe(true);
    });

    it("should return false for MANUAL", () => {
      expect(isAutomatedCaseSource("MANUAL")).toBe(false);
    });

    it("should return false for API", () => {
      expect(isAutomatedCaseSource("API")).toBe(false);
    });

    it("should return false for null", () => {
      expect(isAutomatedCaseSource(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isAutomatedCaseSource(undefined)).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isAutomatedCaseSource("")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(isAutomatedCaseSource("manual")).toBe(false);
    });
  });

  describe("getTestRunTypeLabel", () => {
    it("should return 'Regular' for REGULAR", () => {
      expect(getTestRunTypeLabel("REGULAR")).toBe("Regular");
    });

    it("should return 'JUnit' for JUNIT", () => {
      expect(getTestRunTypeLabel("JUNIT")).toBe("JUnit");
    });

    it("should return 'TestNG' for TESTNG", () => {
      expect(getTestRunTypeLabel("TESTNG")).toBe("TestNG");
    });

    it("should return 'xUnit' for XUNIT", () => {
      expect(getTestRunTypeLabel("XUNIT")).toBe("xUnit");
    });

    it("should return 'NUnit' for NUNIT", () => {
      expect(getTestRunTypeLabel("NUNIT")).toBe("NUnit");
    });

    it("should return 'MSTest' for MSTEST", () => {
      expect(getTestRunTypeLabel("MSTEST")).toBe("MSTest");
    });

    it("should return 'Mocha' for MOCHA", () => {
      expect(getTestRunTypeLabel("MOCHA")).toBe("Mocha");
    });

    it("should return 'Cucumber' for CUCUMBER", () => {
      expect(getTestRunTypeLabel("CUCUMBER")).toBe("Cucumber");
    });

    it("should return the input for unknown types", () => {
      expect(getTestRunTypeLabel("UNKNOWN")).toBe("UNKNOWN");
      expect(getTestRunTypeLabel("custom_type")).toBe("custom_type");
    });
  });

  describe("getCaseSourceLabel", () => {
    it("should return 'Manual' for MANUAL", () => {
      expect(getCaseSourceLabel("MANUAL")).toBe("Manual");
    });

    it("should return 'JUnit' for JUNIT", () => {
      expect(getCaseSourceLabel("JUNIT")).toBe("JUnit");
    });

    it("should return 'TestNG' for TESTNG", () => {
      expect(getCaseSourceLabel("TESTNG")).toBe("TestNG");
    });

    it("should return 'xUnit' for XUNIT", () => {
      expect(getCaseSourceLabel("XUNIT")).toBe("xUnit");
    });

    it("should return 'NUnit' for NUNIT", () => {
      expect(getCaseSourceLabel("NUNIT")).toBe("NUnit");
    });

    it("should return 'MSTest' for MSTEST", () => {
      expect(getCaseSourceLabel("MSTEST")).toBe("MSTest");
    });

    it("should return 'Mocha' for MOCHA", () => {
      expect(getCaseSourceLabel("MOCHA")).toBe("Mocha");
    });

    it("should return 'Cucumber' for CUCUMBER", () => {
      expect(getCaseSourceLabel("CUCUMBER")).toBe("Cucumber");
    });

    it("should return 'API' for API", () => {
      expect(getCaseSourceLabel("API")).toBe("API");
    });

    it("should return the input for unknown sources", () => {
      expect(getCaseSourceLabel("UNKNOWN")).toBe("UNKNOWN");
      expect(getCaseSourceLabel("custom_source")).toBe("custom_source");
    });
  });
});
