/**
 * Utility functions for working with test result types
 *
 * These helpers abstract the concept of "automated" or "imported" test results
 * which can come from multiple formats (JUnit, TestNG, xUnit, NUnit, MSTest, Mocha, Cucumber).
 */

import { RepositoryCaseSource, TestRunType } from "~/zenstack/models";

/**
 * All test run types that represent imported/automated test results
 * These types use the JUnitTestSuite/JUnitTestResult models to store results
 */
export const AUTOMATED_TEST_RUN_TYPES: TestRunType[] = [
  "JUNIT",
  "TESTNG",
  "XUNIT",
  "NUNIT",
  "MSTEST",
  "MOCHA",
  "CUCUMBER",
];

/**
 * Run types whose execution is driven from the manual (TestRunCases →
 * TestRunResults) tree. HYBRID belongs here: it is a REGULAR run that has
 * also received automated results, and every automated result is projected
 * onto TestRunCases.statusId, so the manual summary/progress code describes
 * it correctly.
 */
export const MANUAL_TEST_RUN_TYPES: TestRunType[] = ["REGULAR", "HYBRID"];

/**
 * All repository case sources that represent imported/automated test cases
 */
export const AUTOMATED_CASE_SOURCES: RepositoryCaseSource[] = [
  "JUNIT",
  "TESTNG",
  "XUNIT",
  "NUNIT",
  "MSTEST",
  "MOCHA",
  "CUCUMBER",
];

/**
 * Check if a test run type is an automated/imported type
 * Used to determine whether to show JUnit-style results view
 */
export function isAutomatedTestRunType(
  type: TestRunType | string | null | undefined
): boolean {
  if (!type) return false;
  return AUTOMATED_TEST_RUN_TYPES.includes(type as TestRunType);
}

/**
 * A REGULAR run that has also received automated results. Falls on the manual
 * side of `isAutomatedTestRunType` on purpose: composition lock, review,
 * assignment, the execution sheet and the ready-to-complete check all still
 * apply. Use `hasAutomatedResultsView` to decide whether to render the
 * automated results panel.
 */
export function isHybridTestRunType(
  type: TestRunType | string | null | undefined
): boolean {
  return type === "HYBRID";
}

/**
 * Whether a run's page should show the automated (JUnit-family) results
 * view: pure automated runs and hybrid runs.
 */
export function hasAutomatedResultsView(
  type: TestRunType | string | null | undefined
): boolean {
  return isAutomatedTestRunType(type) || isHybridTestRunType(type);
}

/**
 * Check if a repository case source is an automated/imported source
 * Used to determine editing restrictions and display formatting
 */
export function isAutomatedCaseSource(
  source: RepositoryCaseSource | string | null | undefined
): boolean {
  if (!source) return false;
  return AUTOMATED_CASE_SOURCES.includes(source as RepositoryCaseSource);
}

/**
 * Get a human-readable label for a test run type
 */
export function getTestRunTypeLabel(type: TestRunType | string): string {
  const labels: Record<string, string> = {
    REGULAR: "Regular",
    JUNIT: "JUnit",
    TESTNG: "TestNG",
    XUNIT: "xUnit",
    NUNIT: "NUnit",
    MSTEST: "MSTest",
    MOCHA: "Mocha",
    CUCUMBER: "Cucumber",
    HYBRID: "Hybrid",
  };
  return labels[type] || type;
}

/**
 * Get a human-readable label for a case source
 */
export function getCaseSourceLabel(
  source: RepositoryCaseSource | string
): string {
  const labels: Record<string, string> = {
    MANUAL: "Manual",
    JUNIT: "JUnit",
    TESTNG: "TestNG",
    XUNIT: "xUnit",
    NUNIT: "NUnit",
    MSTEST: "MSTest",
    MOCHA: "Mocha",
    CUCUMBER: "Cucumber",
    API: "API",
  };
  return labels[source] || source;
}
