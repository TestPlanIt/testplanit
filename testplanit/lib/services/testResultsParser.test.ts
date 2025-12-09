import { describe, it, expect } from "vitest";
import {
  detectFormat,
  detectFormatFromFiles,
  normalizeStatus,
  extractClassName,
  isValidFormat,
  countTotalTestCases,
  TEST_RESULT_FORMATS,
  FORMAT_TO_RUN_TYPE,
  FORMAT_TO_SOURCE,
} from "./testResultsParser";
import type { ITestResult, ITestSuite, ITestCase } from "test-results-parser";

describe("testResultsParser", () => {
  describe("detectFormat", () => {
    describe("JUnit XML", () => {
      it("should detect JUnit XML with testsuites root element", () => {
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="LoginTests" tests="3" failures="1" errors="0">
    <testcase name="testValidLogin" classname="auth.LoginTest" time="12.5"/>
  </testsuite>
</testsuites>`;
        expect(detectFormat(content)).toBe("junit");
      });

      it("should detect JUnit XML with single testsuite root element", () => {
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="LoginTests" tests="3" failures="1" errors="0">
  <testcase name="testValidLogin" classname="auth.LoginTest" time="12.5"/>
</testsuite>`;
        expect(detectFormat(content)).toBe("junit");
      });

      it("should detect JUnit without XML declaration", () => {
        const content = `<testsuite name="Tests">
  <testcase name="test1"/>
</testsuite>`;
        expect(detectFormat(content)).toBe("junit");
      });
    });

    describe("TestNG XML", () => {
      it("should detect TestNG XML format", () => {
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<testng-results skipped="0" failed="1" total="5">
  <suite name="Default Suite">
    <test name="TestSuite1">
      <class name="com.example.TestClass"/>
    </test>
  </suite>
</testng-results>`;
        expect(detectFormat(content)).toBe("testng");
      });
    });

    describe("NUnit XML", () => {
      it("should detect NUnit v2 XML with test-results root", () => {
        const content = `<?xml version="1.0" encoding="utf-8"?>
<test-results name="MyApp.Tests" total="5" errors="0" failures="1">
  <test-suite name="MyApp.Tests">
    <results>
      <test-case name="TestMethod1" result="Success"/>
    </results>
  </test-suite>
</test-results>`;
        expect(detectFormat(content)).toBe("nunit");
      });

      it("should detect NUnit v3 XML with test-run root and nunit attribute", () => {
        const content = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="0" name="MyApp.Tests" testcasecount="2" result="Passed"
          engine-version="3.12.0" nunit="3.12.0">
  <test-suite type="Assembly" name="MyApp.Tests.dll">
    <test-case id="1001" name="AdditionTest" result="Passed"/>
  </test-suite>
</test-run>`;
        expect(detectFormat(content)).toBe("nunit");
      });
    });

    describe("xUnit XML", () => {
      it("should detect xUnit XML format", () => {
        const content = `<?xml version="1.0" encoding="utf-8"?>
<assemblies>
  <assembly name="MyApp.Tests" total="10" passed="9" failed="1">
    <collection name="Test collection">
      <test name="TestMethod1" result="Pass"/>
    </collection>
  </assembly>
</assemblies>`;
        expect(detectFormat(content)).toBe("xunit");
      });
    });

    describe("MSTest TRX", () => {
      it("should detect MSTest TRX format with Microsoft namespace", () => {
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="abc-123" testName="TestMethod1" outcome="Passed" />
  </Results>
</TestRun>`;
        expect(detectFormat(content)).toBe("mstest");
      });

      it("should detect MSTest from .trx file extension", () => {
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun>
  <Results/>
</TestRun>`;
        expect(detectFormat(content, "results.trx")).toBe("mstest");
      });

      it("should detect MSTest from .TRX file extension (case insensitive)", () => {
        const content = `<TestRun><Results/></TestRun>`;
        expect(detectFormat(content, "Results.TRX")).toBe("mstest");
      });
    });

    describe("Mocha JSON", () => {
      it("should detect Mocha JSON with stats and tests", () => {
        const content = JSON.stringify({
          stats: {
            suites: 2,
            tests: 5,
            passes: 4,
            failures: 1,
            duration: 1234,
          },
          tests: [{ title: "test1", state: "passed" }],
        });
        expect(detectFormat(content)).toBe("mocha");
      });

      it("should detect Mocha JSON with stats and passes/failures", () => {
        const content = JSON.stringify({
          stats: { duration: 1000 },
          passes: [{ title: "passing test" }],
          failures: [],
        });
        expect(detectFormat(content)).toBe("mocha");
      });

      it("should detect Mocha JSON with results array", () => {
        const content = JSON.stringify({
          results: [
            {
              title: "Authentication",
              suites: [],
              tests: [{ title: "should login successfully", state: "passed" }],
            },
          ],
        });
        expect(detectFormat(content)).toBe("mocha");
      });
    });

    describe("Cucumber JSON", () => {
      it("should detect Cucumber JSON with elements and keyword", () => {
        const content = JSON.stringify([
          {
            keyword: "Feature",
            name: "User Login",
            elements: [
              {
                keyword: "Scenario",
                name: "Valid login",
                steps: [],
              },
            ],
          },
        ]);
        expect(detectFormat(content)).toBe("cucumber");
      });

      it("should detect Cucumber JSON with uri and elements", () => {
        const content = JSON.stringify([
          {
            uri: "features/login.feature",
            elements: [
              {
                name: "Login scenario",
                steps: [],
              },
            ],
          },
        ]);
        expect(detectFormat(content)).toBe("cucumber");
      });
    });

    describe("Edge cases", () => {
      it("should return null for unknown format", () => {
        const content = `<unknown>
  <data>something</data>
</unknown>`;
        expect(detectFormat(content)).toBeNull();
      });

      it("should return null for empty content", () => {
        expect(detectFormat("")).toBeNull();
      });

      it("should return null for invalid JSON", () => {
        const content = `{ invalid json }`;
        expect(detectFormat(content)).toBeNull();
      });

      it("should handle whitespace in content", () => {
        const content = `
        <?xml version="1.0"?>
        <testsuite name="Test"><testcase name="test1"/></testsuite>
        `;
        expect(detectFormat(content)).toBe("junit");
      });

      it("should return null for JSON array without Cucumber structure", () => {
        const content = JSON.stringify([{ foo: "bar" }, { baz: 123 }]);
        expect(detectFormat(content)).toBeNull();
      });

      it("should return null for JSON object without Mocha structure", () => {
        const content = JSON.stringify({ foo: "bar", nested: { data: 123 } });
        expect(detectFormat(content)).toBeNull();
      });
    });
  });

  describe("detectFormatFromFiles", () => {
    it("should return detected format when all files match", () => {
      const files = [
        { content: "<testsuite><testcase/></testsuite>", name: "test1.xml" },
        {
          content: "<testsuites><testsuite/></testsuites>",
          name: "test2.xml",
        },
      ];
      expect(detectFormatFromFiles(files)).toBe("junit");
    });

    it("should return null for empty files array", () => {
      expect(detectFormatFromFiles([])).toBeNull();
    });

    it("should return null when formats are mixed", () => {
      const files = [
        { content: "<testsuite><testcase/></testsuite>", name: "junit.xml" },
        {
          content: "<testng-results><suite/></testng-results>",
          name: "testng.xml",
        },
      ];
      expect(detectFormatFromFiles(files)).toBeNull();
    });

    it("should return null when a file cannot be detected", () => {
      const files = [
        { content: "<testsuite><testcase/></testsuite>", name: "junit.xml" },
        { content: "<unknown><data/></unknown>", name: "unknown.xml" },
      ];
      expect(detectFormatFromFiles(files)).toBeNull();
    });

    it("should detect single file format", () => {
      const files = [
        {
          content: JSON.stringify({ stats: { tests: 1 }, tests: [] }),
          name: "mocha.json",
        },
      ];
      expect(detectFormatFromFiles(files)).toBe("mocha");
    });
  });

  describe("normalizeStatus", () => {
    describe("passed statuses", () => {
      it.each(["pass", "passed", "success", "ok", "PASS", "PASSED", "SUCCESS"])(
        'should normalize "%s" to "passed"',
        (status) => {
          expect(normalizeStatus(status)).toBe("passed");
        }
      );
    });

    describe("failed statuses", () => {
      it.each(["fail", "failed", "failure", "FAIL", "FAILED", "FAILURE"])(
        'should normalize "%s" to "failed"',
        (status) => {
          expect(normalizeStatus(status)).toBe("failed");
        }
      );
    });

    describe("error statuses", () => {
      it.each(["error", "errored", "broken", "ERROR", "ERRORED", "BROKEN"])(
        'should normalize "%s" to "error"',
        (status) => {
          expect(normalizeStatus(status)).toBe("error");
        }
      );
    });

    describe("skipped statuses", () => {
      it.each([
        "skip",
        "skipped",
        "pending",
        "ignored",
        "todo",
        "undefined",
        "disabled",
        "not_run",
        "notrun",
        "inconclusive",
        "SKIP",
        "SKIPPED",
        "PENDING",
      ])('should normalize "%s" to "skipped"', (status) => {
        expect(normalizeStatus(status)).toBe("skipped");
      });
    });

    describe("edge cases", () => {
      it("should return passed for undefined status", () => {
        expect(normalizeStatus(undefined)).toBe("passed");
      });

      it("should return passed for empty string", () => {
        expect(normalizeStatus("")).toBe("passed");
      });

      it("should return passed for unknown status", () => {
        expect(normalizeStatus("unknown_status")).toBe("passed");
      });

      it("should handle status with underscores and hyphens", () => {
        expect(normalizeStatus("not-run")).toBe("skipped");
        expect(normalizeStatus("not_run")).toBe("skipped");
      });

      it("should handle status with extra whitespace", () => {
        expect(normalizeStatus("  passed  ")).toBe("passed");
      });
    });
  });

  describe("extractClassName", () => {
    it("should extract classname from metadata.classname", () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
        metadata: { classname: "com.example.TestClass" },
      } as unknown as ITestCase;
      const suite = { name: "TestSuite" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe("com.example.TestClass");
    });

    it("should extract className from metadata.className (camelCase)", () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
        metadata: { className: "com.example.AnotherClass" },
      } as unknown as ITestCase;
      const suite = { name: "TestSuite" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe("com.example.AnotherClass");
    });

    it("should extract class from metadata.class", () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
        metadata: { class: "MyClass" },
      } as unknown as ITestCase;
      const suite = { name: "TestSuite" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe("MyClass");
    });

    it("should use suite name when it contains dots (fully qualified)", () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
      } as ITestCase;
      const suite = { name: "com.example.auth.LoginTest" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe(
        "com.example.auth.LoginTest"
      );
    });

    it("should use suite name when no dots but name exists", () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
      } as ITestCase;
      const suite = { name: "Login Feature" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe("Login Feature");
    });

    it('should return "Unknown" when no class info available', () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
      } as ITestCase;
      const suite = { name: "" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe("Unknown");
    });

    it("should prioritize metadata over suite name", () => {
      const testCase = {
        name: "testMethod",
        status: "passed",
        metadata: { classname: "MetadataClass" },
      } as unknown as ITestCase;
      const suite = { name: "com.example.SuiteClass" } as ITestSuite;

      expect(extractClassName(testCase, suite)).toBe("MetadataClass");
    });
  });

  describe("isValidFormat", () => {
    it.each(["junit", "testng", "xunit", "nunit", "mstest", "mocha", "cucumber"])(
      'should return true for valid format "%s"',
      (format) => {
        expect(isValidFormat(format)).toBe(true);
      }
    );

    it("should return false for invalid format", () => {
      expect(isValidFormat("invalid")).toBe(false);
      expect(isValidFormat("JUNIT")).toBe(false); // case sensitive
      expect(isValidFormat("")).toBe(false);
    });
  });

  describe("countTotalTestCases", () => {
    it("should count test cases across all suites", () => {
      const result: ITestResult = {
        name: "Test Results",
        suites: [
          {
            name: "Suite1",
            cases: [
              { name: "test1", status: "passed" },
              { name: "test2", status: "failed" },
            ],
          } as ITestSuite,
          {
            name: "Suite2",
            cases: [
              { name: "test3", status: "passed" },
              { name: "test4", status: "passed" },
              { name: "test5", status: "skipped" },
            ],
          } as ITestSuite,
        ],
      };

      expect(countTotalTestCases(result)).toBe(5);
    });

    it("should return 0 for empty suites", () => {
      const result: ITestResult = {
        name: "Empty Results",
        suites: [],
      };

      expect(countTotalTestCases(result)).toBe(0);
    });

    it("should handle suites without cases", () => {
      const result: ITestResult = {
        name: "Test Results",
        suites: [
          { name: "Suite1" } as ITestSuite,
          { name: "Suite2", cases: [] } as ITestSuite,
        ],
      };

      expect(countTotalTestCases(result)).toBe(0);
    });

    it("should handle undefined suites", () => {
      const result = {
        name: "Test Results",
      } as ITestResult;

      expect(countTotalTestCases(result)).toBe(0);
    });
  });

  describe("TEST_RESULT_FORMATS constant", () => {
    it("should have correct metadata for each format", () => {
      expect(TEST_RESULT_FORMATS.junit.label).toBe("JUnit XML");
      expect(TEST_RESULT_FORMATS.junit.extensions).toContain(".xml");
      expect(TEST_RESULT_FORMATS.junit.mimeTypes).toContain("application/xml");

      expect(TEST_RESULT_FORMATS.mstest.label).toBe("MSTest TRX");
      expect(TEST_RESULT_FORMATS.mstest.extensions).toContain(".trx");

      expect(TEST_RESULT_FORMATS.mocha.label).toBe("Mocha JSON");
      expect(TEST_RESULT_FORMATS.mocha.extensions).toContain(".json");
      expect(TEST_RESULT_FORMATS.mocha.mimeTypes).toContain("application/json");

      expect(TEST_RESULT_FORMATS.cucumber.label).toBe("Cucumber JSON");
    });
  });

  describe("FORMAT_TO_RUN_TYPE constant", () => {
    it("should map formats to correct TestRunType values", () => {
      expect(FORMAT_TO_RUN_TYPE.junit).toBe("JUNIT");
      expect(FORMAT_TO_RUN_TYPE.testng).toBe("TESTNG");
      expect(FORMAT_TO_RUN_TYPE.xunit).toBe("XUNIT");
      expect(FORMAT_TO_RUN_TYPE.nunit).toBe("NUNIT");
      expect(FORMAT_TO_RUN_TYPE.mstest).toBe("MSTEST");
      expect(FORMAT_TO_RUN_TYPE.mocha).toBe("MOCHA");
      expect(FORMAT_TO_RUN_TYPE.cucumber).toBe("CUCUMBER");
    });
  });

  describe("FORMAT_TO_SOURCE constant", () => {
    it("should map formats to correct RepositoryCaseSource values", () => {
      expect(FORMAT_TO_SOURCE.junit).toBe("JUNIT");
      expect(FORMAT_TO_SOURCE.testng).toBe("TESTNG");
      expect(FORMAT_TO_SOURCE.xunit).toBe("XUNIT");
      expect(FORMAT_TO_SOURCE.nunit).toBe("NUNIT");
      expect(FORMAT_TO_SOURCE.mstest).toBe("MSTEST");
      expect(FORMAT_TO_SOURCE.mocha).toBe("MOCHA");
      expect(FORMAT_TO_SOURCE.cucumber).toBe("CUCUMBER");
    });
  });
});
