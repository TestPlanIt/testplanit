/**
 * Test Results Parser Service
 *
 * Wraps the test-results-parser library to provide a unified interface
 * for parsing test results from multiple formats (JUnit, TestNG, xUnit,
 * NUnit, MSTest, Mocha, Cucumber).
 */

import type { ITestResult, ITestSuite, ITestCase } from "test-results-parser";
import { mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { existsSync, writeFileSync } from "fs";

// Import parseV2 dynamically to avoid Turbopack bundling issues
const { parseV2 } = require("test-results-parser") as {
  parseV2: (options: { type: string; files: string[] }) => {
    result: ITestResult | null;
    errors: string[];
  };
};

/**
 * Supported test result formats
 */
export type TestResultFormat =
  | "junit"
  | "testng"
  | "xunit"
  | "nunit"
  | "mstest"
  | "mocha"
  | "cucumber";

/**
 * Format metadata for UI display and file validation
 */
export const TEST_RESULT_FORMATS: Record<
  TestResultFormat,
  { label: string; extensions: string[]; mimeTypes: string[] }
> = {
  junit: {
    label: "JUnit XML",
    extensions: [".xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  testng: {
    label: "TestNG XML",
    extensions: [".xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  xunit: {
    label: "xUnit XML",
    extensions: [".xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  nunit: {
    label: "NUnit XML",
    extensions: [".xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  mstest: {
    label: "MSTest TRX",
    extensions: [".trx", ".xml"],
    mimeTypes: ["application/xml", "text/xml"],
  },
  mocha: {
    label: "Mocha JSON",
    extensions: [".json"],
    mimeTypes: ["application/json"],
  },
  cucumber: {
    label: "Cucumber JSON",
    extensions: [".json"],
    mimeTypes: ["application/json"],
  },
};

/**
 * Map format to TestRunType enum value (matches schema.zmodel)
 */
export const FORMAT_TO_RUN_TYPE: Record<TestResultFormat, string> = {
  junit: "JUNIT",
  testng: "TESTNG",
  xunit: "XUNIT",
  nunit: "NUNIT",
  mstest: "MSTEST",
  mocha: "MOCHA",
  cucumber: "CUCUMBER",
};

/**
 * Map format to RepositoryCaseSource enum value (matches schema.zmodel)
 */
export const FORMAT_TO_SOURCE: Record<TestResultFormat, string> = {
  junit: "JUNIT",
  testng: "TESTNG",
  xunit: "XUNIT",
  nunit: "NUNIT",
  mstest: "MSTEST",
  mocha: "MOCHA",
  cucumber: "CUCUMBER",
};

/**
 * Auto-detect the format of a test result file based on its content
 * @param content - The file content as a string
 * @param fileName - Optional file name for extension-based hints
 * @returns The detected format or null if unable to detect
 */
export function detectFormat(
  content: string,
  fileName?: string
): TestResultFormat | null {
  const trimmedContent = content.trim();

  // Check file extension first for hints
  const ext = fileName?.toLowerCase().split(".").pop();

  // TRX files are always MSTest
  if (ext === "trx") {
    return "mstest";
  }

  // JSON-based formats
  if (trimmedContent.startsWith("[") || trimmedContent.startsWith("{")) {
    try {
      const json = JSON.parse(trimmedContent);

      // Cucumber JSON is an array of features with "elements" containing scenarios
      if (Array.isArray(json)) {
        const firstItem = json[0];
        if (firstItem && "elements" in firstItem && "keyword" in firstItem) {
          return "cucumber";
        }
        // Could also be Cucumber if it has uri and elements
        if (firstItem && "uri" in firstItem && "elements" in firstItem) {
          return "cucumber";
        }
      }

      // Mocha JSON has "stats" and "tests" or "passes"/"failures" at root
      if (
        "stats" in json &&
        ("tests" in json || "passes" in json || "failures" in json)
      ) {
        return "mocha";
      }

      // Mocha can also have results array with suites
      if ("results" in json && Array.isArray(json.results)) {
        return "mocha";
      }
    } catch {
      // Not valid JSON, continue to XML detection
    }
  }

  // XML-based formats - check for root elements
  if (trimmedContent.startsWith("<?xml") || trimmedContent.startsWith("<")) {
    // MSTest TRX format - has TestRun with microsoft namespace
    if (
      trimmedContent.includes("<TestRun") &&
      trimmedContent.includes("microsoft.com/schemas/VisualStudio")
    ) {
      return "mstest";
    }

    // TestNG format - has testng-results root
    if (trimmedContent.includes("<testng-results")) {
      return "testng";
    }

    // NUnit format - has test-results or test-run with NUnit attributes
    if (
      trimmedContent.includes("<test-results") ||
      (trimmedContent.includes("<test-run") && trimmedContent.includes("nunit"))
    ) {
      return "nunit";
    }

    // xUnit format - has assemblies root element
    if (trimmedContent.includes("<assemblies")) {
      return "xunit";
    }

    // JUnit format - has testsuite(s) root element (most common)
    if (
      trimmedContent.includes("<testsuite") ||
      trimmedContent.includes("<testsuites")
    ) {
      return "junit";
    }
  }

  return null;
}

/**
 * Auto-detect format from multiple files
 * Returns the detected format if all files match, or null if mixed/unknown
 */
export function detectFormatFromFiles(
  files: Array<{ content: string; name: string }>
): TestResultFormat | null {
  if (files.length === 0) return null;

  let detectedFormat: TestResultFormat | null = null;

  for (const file of files) {
    const format = detectFormat(file.content, file.name);
    if (!format) {
      return null; // Unable to detect one file
    }
    if (detectedFormat === null) {
      detectedFormat = format;
    } else if (detectedFormat !== format) {
      return null; // Mixed formats
    }
  }

  return detectedFormat;
}

/**
 * Normalized status values used internally
 */
export type NormalizedStatus = "passed" | "failed" | "error" | "skipped";

/**
 * Map various status strings from different formats to normalized values
 */
const STATUS_MAP: Record<string, NormalizedStatus> = {
  // Common values
  pass: "passed",
  passed: "passed",
  success: "passed",
  ok: "passed",
  // Failure variations
  fail: "failed",
  failed: "failed",
  failure: "failed",
  // Error variations
  error: "error",
  errored: "error",
  broken: "error",
  // Skip variations
  skip: "skipped",
  skipped: "skipped",
  pending: "skipped",
  ignored: "skipped",
  todo: "skipped",
  undefined: "skipped", // Cucumber uses this
  disabled: "skipped",
  not_run: "skipped",
  notrun: "skipped",
  inconclusive: "skipped", // NUnit/MSTest
};

/**
 * Normalize a status string to our internal format
 */
export function normalizeStatus(status: string | undefined): NormalizedStatus {
  if (!status) return "passed";
  const normalized = status.toLowerCase().trim().replace(/[_-]/g, "");
  return STATUS_MAP[normalized] || "passed";
}

/**
 * Result of parsing test files
 */
export interface ParsedTestResults {
  result: ITestResult;
  errors: string[];
  format: TestResultFormat;
}

/**
 * Parse test result files using the specified format
 *
 * @param files - Array of File objects from FormData
 * @param format - The test result format to use for parsing
 * @returns Parsed results with any errors encountered
 */
export async function parseTestResults(
  files: File[],
  format: TestResultFormat
): Promise<ParsedTestResults> {
  // Create a unique temp directory for this parse operation
  const tempDir = join(tmpdir(), `test-results-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  const tempFiles: string[] = [];

  try {
    // Write all files to temp directory using sync operations
    // to avoid any async issues with the parser's require() calls
    for (const file of files) {
      const content = await file.text();
      // Ensure proper file extension for the format
      let fileName = file.name;
      if (format === "cucumber" || format === "mocha") {
        // JSON-based formats need .json extension for require() to work
        if (!fileName.endsWith(".json")) {
          fileName =
            fileName.replace(/\.[^.]+$/, ".json") || fileName + ".json";
        }
      }
      const tempPath = join(tempDir, fileName);
      // Use sync write to ensure file is fully written before parsing
      writeFileSync(tempPath, content, "utf-8");
      tempFiles.push(tempPath);
    }

    // Verify files exist before parsing
    for (const tempFile of tempFiles) {
      if (!existsSync(tempFile)) {
        throw new Error(`Failed to create temp file: ${tempFile}`);
      }
    }

    // Parse using the library
    let parseResult;
    try {
      parseResult = parseV2({
        type: format,
        files: tempFiles,
      });
    } catch (parseError) {
      const errorMessage =
        parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to parse ${format} files: ${errorMessage}`);
    }

    const { result, errors } = parseResult;

    // Check if parsing returned a valid result
    if (!result) {
      const errorDetails = errors?.length
        ? errors.join(", ")
        : "Unknown parsing error";
      throw new Error(`Failed to parse ${format} files: ${errorDetails}`);
    }

    // Normalize durations from milliseconds to seconds for consistency
    // with existing JUnit data (JUnit XML uses seconds)
    normalizeDurations(result, format);

    return {
      result,
      errors: errors || [],
      format,
    };
  } finally {
    // Clean up temp files
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
      console.warn(`Failed to clean up temp directory: ${tempDir}`);
    }
  }
}

/**
 * Normalize durations across the result tree
 * The test-results-parser library returns durations in milliseconds for ALL formats
 * (including JUnit, even though JUnit XML uses seconds - the library converts them).
 * We convert to seconds for consistency with our database schema.
 */
function normalizeDurations(
  result: ITestResult,
  format: TestResultFormat
): void {
  // The test-results-parser library converts ALL formats to milliseconds internally,
  // including JUnit (which has seconds in XML). We always need to convert back to seconds.
  const needsConversion = true;

  if (needsConversion) {
    // Convert result duration
    if (result.duration && result.duration > 0) {
      result.duration = result.duration / 1000;
    }

    // Convert suite and case durations
    for (const suite of result.suites || []) {
      if (suite.duration && suite.duration > 0) {
        suite.duration = suite.duration / 1000;
      }
      for (const testCase of suite.cases || []) {
        if (testCase.duration && testCase.duration > 0) {
          testCase.duration = testCase.duration / 1000;
        }
        // Convert step durations (steps may not have duration if skipped)
        for (const step of testCase.steps || []) {
          if (step && step.duration && step.duration > 0) {
            step.duration = step.duration / 1000;
          }
        }
      }
    }
  }
}

/**
 * Validate that the format is supported
 */
export function isValidFormat(format: string): format is TestResultFormat {
  return format in TEST_RESULT_FORMATS;
}

/**
 * Get file extensions accepted for a format
 */
export function getAcceptedExtensions(format: TestResultFormat): string {
  return TEST_RESULT_FORMATS[format].extensions.join(",");
}

/**
 * Extract class name from a test case
 * Different formats store this differently:
 * - JUnit: Uses fully qualified Java class name (e.g., com.example.TestClass)
 * - TestNG: Similar to JUnit
 * - Cucumber: Uses feature name as the class equivalent
 * - Mocha: Uses describe block / suite name
 * - Others: Suite name serves as the class identifier
 *
 * This value is used as part of the composite unique key for RepositoryCases
 * to help identify test cases uniquely across imports.
 */
export function extractClassName(
  testCase: ITestCase,
  suite: ITestSuite
): string {
  // Check metadata for className (some formats store it there)
  const metadata = testCase.metadata as Record<string, unknown> | undefined;
  if (metadata?.classname) return String(metadata.classname);
  if (metadata?.className) return String(metadata.className);
  if (metadata?.class) return String(metadata.class);

  // For formats that use suite name as class (like TestNG, JUnit)
  // the suite name often contains the fully qualified class name
  if (suite.name && suite.name.includes(".")) {
    return suite.name;
  }

  // For Cucumber, Mocha, and other formats, the suite name
  // (feature name, describe block) serves as the class identifier
  // This ensures we always have a meaningful className for uniqueness
  if (suite.name) {
    return suite.name;
  }

  // Ultimate fallback - should rarely happen
  return "Unknown";
}

/**
 * Count total test cases across all suites
 */
export function countTotalTestCases(result: ITestResult): number {
  let total = 0;
  for (const suite of result.suites || []) {
    total += suite.cases?.length || 0;
  }
  return total;
}
