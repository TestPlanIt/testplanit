import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TestStats, SuiteStats, RunnerStats } from "@wdio/reporter";

// Mock WDIOReporter base class before importing the reporter
vi.mock("@wdio/reporter", () => {
  return {
    default: class MockWDIOReporter {
      options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
      write() {}
      onRunnerStart() {}
      onSuiteStart() {}
      onSuiteEnd() {}
      onTestStart() {}
      onTestPass() {}
      onTestFail() {}
      onTestSkip() {}
      onRunnerEnd() {}
    },
  };
});

// Mock the API client
// Hoisted spies so tests can drive/assert the step-write + case-create path.
const apiMocks = vi.hoisted(() => ({
  findOrCreateTestCase: vi.fn(async () => ({
    testCase: { id: 456, name: "Test Case" },
    action: "found" as "found" | "created" | "moved",
  })),
  createSteps: vi.fn(async (opts: { testCaseId: number; steps: unknown[] }) => ({
    count: opts.steps.length,
  })),
  softDeleteCaseSteps: vi.fn(async () => 3),
  requestStepDerivation: vi.fn(async (_opts: unknown) => ({ enqueued: true })),
  automationStepsToCaseSteps: vi.fn((steps: { title: string; kind: string }[]) =>
    steps.map((s, i) => ({
      step: s.title,
      expectedResult: s.kind === "assertion" ? s.title : undefined,
      order: i,
    })),
  ),
}));

vi.mock("@testplanit/api", () => {
  return {
    automationStepsToCaseSteps: apiMocks.automationStepsToCaseSteps,
    TestPlanItClient: class MockTestPlanItClient {
      findOrCreateTestCase = apiMocks.findOrCreateTestCase;
      createSteps = apiMocks.createSteps;
      softDeleteCaseSteps = apiMocks.softDeleteCaseSteps;
      requestStepDerivation = apiMocks.requestStepDerivation;
      async getStatuses() {
        return [
          {
            id: 1,
            name: "Passed",
            systemName: "passed",
            isSuccess: true,
            isFailure: false,
          },
          {
            id: 2,
            name: "Failed",
            systemName: "failed",
            isSuccess: false,
            isFailure: true,
          },
          {
            id: 3,
            name: "Skipped",
            systemName: "skipped",
            isSuccess: false,
            isFailure: false,
          },
        ];
      }
      async getStatusId(_projectId: number, status: string) {
        const map: Record<string, number> = {
          passed: 1,
          failed: 2,
          skipped: 3,
        };
        return map[status];
      }
      async createTestRun() {
        return { id: 123, name: "Test Run" };
      }
      async getTestRun() {
        return { id: 123, name: "Test Run" };
      }
      async completeTestRun() {
        return { id: 123, isCompleted: true };
      }
      async findOrAddTestCaseToRun() {
        return { id: 456 };
      }
      async createTestResult() {
        return { id: 789 };
      }
      async uploadAttachment() {
        return { id: 1, path: "/attachments/1" };
      }
      async createJUnitTestSuite() {
        return { id: 1, name: "Test Suite" };
      }
      async createJUnitTestResult() {
        return { id: 789 };
      }
      async uploadJUnitAttachment() {
        return { id: 1, path: "/attachments/1" };
      }
      async findTestRunByName() {
        return { id: 123, name: "Test Run" };
      }
      async findConfigurationByName() {
        return { id: 1, name: "Configuration" };
      }
      async findMilestoneByName() {
        return { id: 1, name: "Milestone" };
      }
      async findWorkflowStateByName() {
        return { id: 1, name: "State" };
      }
      async findFolderByName() {
        return { id: 1, name: "Folder" };
      }
      async createFolder() {
        return { id: 1, name: "Folder" };
      }
      async findTemplateByName() {
        return { id: 1, name: "Template" };
      }
      async resolveTagIds() {
        return [1, 2, 3];
      }
      async findOrCreateFolderPath() {
        return { id: 1, name: "Folder" };
      }
    },
    TestPlanItError: class TestPlanItError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "TestPlanItError";
      }
    },
  };
});

// Mock shared state utilities
vi.mock("./shared.js", () => ({
  readSharedState: vi.fn().mockReturnValue(null),
  writeSharedState: vi.fn(),
  writeSharedStateIfAbsent: vi.fn(),
  deleteSharedState: vi.fn(),
  incrementWorkerCount: vi.fn(),
  decrementWorkerCount: vi.fn().mockReturnValue(false),
}));

// Import after mocks are set up
import TestPlanItReporter from "./reporter.js";
import {
  readSharedState,
  incrementWorkerCount,
  decrementWorkerCount,
} from "./shared.js";

describe("TestPlanItReporter", () => {
  let reporter: TestPlanItReporter;
  const defaultOptions = {
    domain: "https://testplanit.example.com",
    apiToken: "tpi_test_token",
    projectId: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.findOrCreateTestCase.mockResolvedValue({
      testCase: { id: 456, name: "Test Case" },
      action: "found",
    });
    apiMocks.createSteps.mockImplementation(async (opts) => ({ count: opts.steps.length }));
    apiMocks.softDeleteCaseSteps.mockResolvedValue(3);
    apiMocks.requestStepDerivation.mockResolvedValue({ enqueued: true });
    reporter = new TestPlanItReporter(defaultOptions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create reporter with valid options", () => {
      const reporter = new TestPlanItReporter(defaultOptions);
      expect(reporter).toBeDefined();
    });

    it("should throw error if domain is missing", () => {
      expect(() => {
        new TestPlanItReporter({
          ...defaultOptions,
          domain: "",
        });
      }).toThrow("domain is required");
    });

    it("should throw error if apiToken is missing", () => {
      expect(() => {
        new TestPlanItReporter({
          ...defaultOptions,
          apiToken: "",
        });
      }).toThrow("apiToken is required");
    });

    it("should throw error if projectId is missing", () => {
      expect(() => {
        new TestPlanItReporter({
          ...defaultOptions,
          projectId: 0,
        });
      }).toThrow("projectId is required");
    });

    it("should use default options", () => {
      const reporter = new TestPlanItReporter(defaultOptions);
      const state = reporter.getState();
      expect(state.initialized).toBe(false);
    });

    it("should use provided testRunId", () => {
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        testRunId: 999,
      });
      const state = reporter.getState();
      expect(state.testRunId).toBe(999);
    });
  });

  describe("case ID parsing", () => {
    it("should parse single case ID from title with default bracket pattern", () => {
      // Default pattern is /\[(\d+)\]/g
      const result = (reporter as any).parseCaseIds(
        "[12345] should load the page"
      );
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe("should load the page");
    });

    it("should parse multiple case IDs from title", () => {
      const result = (reporter as any).parseCaseIds(
        "[123] [456] [789] should work"
      );
      expect(result.caseIds).toEqual([123, 456, 789]);
      expect(result.cleanTitle).toBe("should work");
    });

    it("should handle title without case ID", () => {
      const result = (reporter as any).parseCaseIds(
        "should work without case ID"
      );
      expect(result.caseIds).toEqual([]);
      expect(result.cleanTitle).toBe("should work without case ID");
    });

    it("should handle custom caseIdPattern with C-prefix", () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /C(\d+)/g,
      });
      const result = (customReporter as any).parseCaseIds("C12345 should work");
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe("should work");
    });

    it("should handle custom caseIdPattern with TC- prefix", () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /TC-(\d+)/g,
      });
      const result = (customReporter as any).parseCaseIds(
        "TC-12345 should work"
      );
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe("should work");
    });

    it("should handle caseIdPattern as string", () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: "TEST-(\\d+)",
      });
      const result = (customReporter as any).parseCaseIds(
        "TEST-99999 should work"
      );
      expect(result.caseIds).toEqual([99999]);
      expect(result.cleanTitle).toBe("should work");
    });

    it("should handle case ID at end of title", () => {
      const result = (reporter as any).parseCaseIds(
        "should load the page [12345]"
      );
      expect(result.caseIds).toEqual([12345]);
      expect(result.cleanTitle).toBe("should load the page");
    });

    it("should handle pattern with multiple capturing groups", () => {
      // Pattern that matches either [123] or C123 format
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /(?:\[(\d+)\]|C(\d+))/g,
      });
      const result1 = (customReporter as any).parseCaseIds("[123] should work");
      expect(result1.caseIds).toEqual([123]);

      const result2 = (customReporter as any).parseCaseIds("C456 should work");
      expect(result2.caseIds).toEqual([456]);
    });

    it("should handle plain numeric IDs with custom pattern", () => {
      const customReporter = new TestPlanItReporter({
        ...defaultOptions,
        caseIdPattern: /^(\d+)\s/g,
      });
      const result = (customReporter as any).parseCaseIds(
        "1761 should load the page"
      );
      expect(result.caseIds).toEqual([1761]);
      expect(result.cleanTitle).toBe("should load the page");
    });
  });

  describe("run name formatting", () => {
    it("should replace date placeholder", () => {
      const result = (reporter as any).formatRunName("Test Run - {date}");
      expect(result).toMatch(/Test Run - \d{4}-\d{2}-\d{2}/);
    });

    it("should replace time placeholder", () => {
      const result = (reporter as any).formatRunName("Test Run - {time}");
      expect(result).toMatch(/Test Run - \d{2}:\d{2}:\d{2}/);
    });

    it("should replace browser placeholder", () => {
      (reporter as any).state.capabilities = { browserName: "chrome" };
      const result = (reporter as any).formatRunName("Test Run - {browser}");
      expect(result).toBe("Test Run - chrome");
    });

    it('should use "unknown" for missing browser', () => {
      const result = (reporter as any).formatRunName("Test Run - {browser}");
      expect(result).toBe("Test Run - unknown");
    });

    it("should replace multiple placeholders", () => {
      (reporter as any).state.capabilities = { browserName: "firefox" };
      const result = (reporter as any).formatRunName(
        "{browser} Tests - {date}"
      );
      expect(result).toMatch(/firefox Tests - \d{4}-\d{2}-\d{2}/);
    });
  });

  describe("lifecycle hooks", () => {
    it("should handle onRunnerStart", () => {
      const runnerStats = {
        cid: "0-0",
        capabilities: { browserName: "chrome", platformName: "macOS" },
      } as RunnerStats;

      reporter.onRunnerStart(runnerStats);
      const state = reporter.getState();
      expect(state.capabilities).toEqual({
        browserName: "chrome",
        platformName: "macOS",
      });
    });

    it("should handle onSuiteStart", () => {
      const suiteStats = { title: "Login Tests" } as SuiteStats;
      reporter.onSuiteStart(suiteStats);
      // Suite name should be tracked internally
      expect((reporter as any).currentSuite).toContain("Login Tests");
    });

    it("should handle onSuiteEnd", () => {
      const suiteStats = { title: "Login Tests" } as SuiteStats;
      reporter.onSuiteStart(suiteStats);
      reporter.onSuiteEnd(suiteStats);
      expect((reporter as any).currentSuite).not.toContain("Login Tests");
    });

    it("should handle nested suites", () => {
      reporter.onSuiteStart({ title: "Parent Suite" } as SuiteStats);
      reporter.onSuiteStart({ title: "Child Suite" } as SuiteStats);
      expect((reporter as any).getFullSuiteName()).toBe(
        "Parent Suite > Child Suite"
      );

      reporter.onSuiteEnd({ title: "Child Suite" } as SuiteStats);
      expect((reporter as any).getFullSuiteName()).toBe("Parent Suite");
    });
  });

  describe("test result handling", () => {
    const createTestStats = (overrides: Partial<TestStats> = {}): TestStats =>
      ({
        type: "test",
        title: "[123] should pass",
        fullTitle: "Suite > [123] should pass",
        uid: "test-uid",
        cid: "0-0",
        state: "passed",
        duration: 1500,
        start: new Date("2024-01-01T00:00:00Z"),
        end: new Date("2024-01-01T00:00:01.5Z"),
        retries: 0,
        ...overrides,
      }) as TestStats;

    it("should track passed test", () => {
      reporter.onTestPass(createTestStats());
      const state = reporter.getState();
      expect(state.results.size).toBe(1);

      const result = Array.from(state.results.values())[0];
      expect(result.status).toBe("passed");
      expect(result.caseId).toBe(123);
    });

    it("should track failed test", () => {
      const testStats = createTestStats({
        title: "[456] should fail",
        state: "failed",
        error: {
          message: "Assertion failed",
          stack: "Error: Assertion failed\n  at Test.fn",
        } as Error,
      });

      reporter.onTestFail(testStats);
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Assertion failed");
      expect(result.stackTrace).toContain("Error: Assertion failed");
    });

    it("should track skipped test", () => {
      reporter.onTestSkip(
        createTestStats({ title: "[789] should skip", state: "skipped" })
      );
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.status).toBe("skipped");
    });

    it("should include retry attempt", () => {
      reporter.onTestFail(createTestStats({ retries: 2 }));
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.retryAttempt).toBe(2);
    });

    it("should track test without case ID when autoCreateTestCases is false", () => {
      reporter.onTestPass(createTestStats({ title: "test without case ID" }));
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.caseId).toBeUndefined();
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      const state = reporter.getState();
      expect(state).toHaveProperty("testRunId");
      expect(state).toHaveProperty("results");
      expect(state).toHaveProperty("statusIds");
      expect(state).toHaveProperty("initialized");
    });
  });
});

describe("caseIdPattern edge cases", () => {
  it("should handle complex regex patterns", () => {
    const reporter = new TestPlanItReporter({
      domain: "https://testplanit.example.com",
      apiToken: "tpi_test_token",
      projectId: 1,
      caseIdPattern: /\[CASE-(\d+)\]/g,
    });
    const result = (reporter as any).parseCaseIds("[CASE-123] should work");
    expect(result.caseIds).toEqual([123]);
    expect(result.cleanTitle).toBe("should work");
  });

  it("should handle pattern matching at start only", () => {
    const reporter = new TestPlanItReporter({
      domain: "https://testplanit.example.com",
      apiToken: "tpi_test_token",
      projectId: 1,
      caseIdPattern: /^#(\d+)/g,
    });
    const result = (reporter as any).parseCaseIds("#1234 should work");
    expect(result.caseIds).toEqual([1234]);
    expect(result.cleanTitle).toBe("should work");
  });
});

describe("service-managed mode", () => {
  const defaultOptions = {
    domain: "https://testplanit.example.com",
    apiToken: "tpi_test_token",
    projectId: 1,
  };

  const mockedReadSharedState = vi.mocked(readSharedState);
  const mockedIncrementWorkerCount = vi.mocked(incrementWorkerCount);
  const mockedDecrementWorkerCount = vi.mocked(decrementWorkerCount);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not be managed by service before initialization", () => {
    mockedReadSharedState.mockReturnValue({
      testRunId: 500,
      testSuiteId: 600,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });

    const reporter = new TestPlanItReporter(defaultOptions);
    // Before initialization, the flag should be false
    expect((reporter as any).managedByService).toBe(false);
  });

  it("should adopt service-managed testRunId and testSuiteId after initialization", async () => {
    mockedReadSharedState.mockReturnValue({
      testRunId: 500,
      testSuiteId: 600,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });

    const reporter = new TestPlanItReporter(defaultOptions);
    // Trigger initialization via the private method
    await (reporter as any).initialize();

    expect((reporter as any).managedByService).toBe(true);
    const state = reporter.getState();
    expect(state.testRunId).toBe(500);
    expect(state.testSuiteId).toBe(600);
    expect(state.initialized).toBe(true);
  });

  it("should not create a test run when service-managed", async () => {
    mockedReadSharedState.mockReturnValue({
      testRunId: 500,
      testSuiteId: 600,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });

    const reporter = new TestPlanItReporter(defaultOptions);
    const client = (reporter as any).client;
    const createTestRunSpy = vi.spyOn(client, "createTestRun");

    await (reporter as any).initialize();

    expect(createTestRunSpy).not.toHaveBeenCalled();
  });

  it("should not increment worker count when service-managed", async () => {
    mockedReadSharedState.mockReturnValue({
      testRunId: 500,
      testSuiteId: 600,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });

    const reporter = new TestPlanItReporter(defaultOptions);
    await (reporter as any).initialize();

    expect(mockedIncrementWorkerCount).not.toHaveBeenCalled();
  });

  it("should skip test run completion on runner end when service-managed", async () => {
    mockedReadSharedState.mockReturnValue({
      testRunId: 500,
      testSuiteId: 600,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });

    const reporter = new TestPlanItReporter({
      ...defaultOptions,
      completeRunOnFinish: true,
    });
    await (reporter as any).initialize();

    const client = (reporter as any).client;
    const completeTestRunSpy = vi.spyOn(client, "completeTestRun");

    // Simulate runner end
    const runnerStats = {
      cid: "0-0",
      capabilities: { browserName: "chrome" },
      specs: ["/test/specs/login.spec.js"],
    } as unknown as import("@wdio/reporter").RunnerStats;
    reporter.onRunnerStart(runnerStats);
    await (reporter as any).onRunnerEnd(runnerStats);

    // completeTestRun should NOT have been called
    expect(completeTestRunSpy).not.toHaveBeenCalled();
    // decrementWorkerCount should NOT have been called
    expect(mockedDecrementWorkerCount).not.toHaveBeenCalled();
  });

  it("should still report results when service-managed", async () => {
    mockedReadSharedState.mockReturnValue({
      testRunId: 500,
      testSuiteId: 600,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });

    const reporter = new TestPlanItReporter({
      ...defaultOptions,
      autoCreateTestCases: true,
      parentFolderId: 1,
      templateId: 1,
    });

    // Track a test result
    const testStats = {
      type: "test",
      title: "should work",
      fullTitle: "Suite > should work",
      uid: "test-uid-svc",
      cid: "0-0",
      state: "passed",
      duration: 100,
      start: new Date(),
      end: new Date(),
      retries: 0,
    } as import("@wdio/reporter").TestStats;

    reporter.onTestPass(testStats);
    const state = reporter.getState();
    expect(state.results.size).toBe(1);
  });

  describe("Cucumber scenario accumulation", () => {
    const runner = (framework: string) =>
      ({ cid: "0-0", config: { framework }, capabilities: {} }) as unknown as RunnerStats;
    const featureSuite = () =>
      ({ title: "Feature: Login", uid: "f1" }) as unknown as SuiteStats;
    const scenarioSuite = () =>
      ({ type: "scenario", title: "Scenario: User logs in", uid: "s1", cid: "0-0", start: new Date() }) as unknown as SuiteStats;
    const stepTest = (title: string) =>
      ({ type: "test", title, fullTitle: title, uid: title, cid: "0-0", state: "passed", duration: 1, start: new Date(), end: new Date(), retries: 0 }) as unknown as TestStats;
    const cucumberReporter = (opts: Record<string, unknown> = {}) =>
      new TestPlanItReporter({
        ...defaultOptions,
        autoCreateTestCases: true,
        parentFolderId: 10,
        templateId: 1,
        ...opts,
      });

    // Await the async reportResult operations tracked on the reporter.
    const flush = async (r: TestPlanItReporter) => {
      const ops = (r as unknown as { pendingOperations: Set<Promise<void>> }).pendingOperations;
      for (let i = 0; i < 10 && ops.size > 0; i++) {
        await Promise.allSettled([...ops]);
      }
    };

    const driveScenario = (r: TestPlanItReporter, framework = "cucumber") => {
      r.onRunnerStart(runner(framework));
      r.onSuiteStart(featureSuite());
      r.onSuiteStart(scenarioSuite());
      r.onTestPass(stepTest("Given I am on the homepage"));
      r.onTestPass(stepTest("When I enter valid credentials"));
      r.onTestPass(stepTest("Then I should see the dashboard"));
      r.onSuiteEnd(scenarioSuite());
    };

    it("creates ONE case per scenario (not per step) and writes the Given/When/Then steps", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 456, name: "User logs in" }, action: "created" });
      const r = cucumberReporter();
      driveScenario(r);
      await flush(r);

      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.createSteps).toHaveBeenCalledTimes(1);
      expect(apiMocks.createSteps.mock.calls[0][0].steps).toHaveLength(3);
      expect(apiMocks.createSteps.mock.calls[0][0].testCaseId).toBe(456);
    });

    // ─── Non-Cucumber (Mocha/Jasmine) → opt-in LLM derivation ───────────────
    const driveMochaTest = (r: TestPlanItReporter, title: string, suiteUid = "ms1") => {
      r.onRunnerStart(runner("mocha"));
      r.onSuiteStart({ title: "Auth", uid: suiteUid } as unknown as SuiteStats);
      r.onTestPass(stepTest(title));
    };

    it("requests AI step derivation for non-Cucumber auto-created cases at onRunnerEnd", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 789, name: "x" }, action: "created" });
      const r = cucumberReporter();
      driveMochaTest(r, "should log in with valid credentials");
      await flush(r);
      await (r as unknown as { onRunnerEnd: (rs: RunnerStats) => Promise<void> }).onRunnerEnd(runner("mocha"));

      // No deterministic steps for Mocha...
      expect(apiMocks.createSteps).not.toHaveBeenCalled();
      // ...but exactly one batched AI-derivation request for the created case.
      expect(apiMocks.requestStepDerivation).toHaveBeenCalledTimes(1);
      const arg = apiMocks.requestStepDerivation.mock.calls[0][0] as {
        overwrite: boolean;
        cases: Array<{ testCaseId: number; name: string }>;
      };
      expect(arg.overwrite).toBe(false);
      expect(arg.cases).toHaveLength(1);
      expect(arg.cases[0]).toMatchObject({
        testCaseId: 789,
        name: "should log in with valid credentials",
      });
    });

    it("requests overwrite re-derivation for matched non-Cucumber cases when overwriteSteps is on", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 321, name: "x" }, action: "found" });
      const r = cucumberReporter({ overwriteSteps: true });
      driveMochaTest(r, "should do something", "ms2");
      await flush(r);
      await (r as unknown as { onRunnerEnd: (rs: RunnerStats) => Promise<void> }).onRunnerEnd(runner("mocha"));

      expect(apiMocks.requestStepDerivation).toHaveBeenCalledTimes(1);
      expect((apiMocks.requestStepDerivation.mock.calls[0][0] as { overwrite: boolean }).overwrite).toBe(true);
    });

    it("does NOT request AI derivation for matched cases without overwriteSteps", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 321, name: "x" }, action: "found" });
      const r = cucumberReporter(); // overwriteSteps default false
      driveMochaTest(r, "should do something", "ms3");
      await flush(r);
      await (r as unknown as { onRunnerEnd: (rs: RunnerStats) => Promise<void> }).onRunnerEnd(runner("mocha"));

      expect(apiMocks.requestStepDerivation).not.toHaveBeenCalled();
    });

    it("does NOT request AI derivation when captureSteps is false", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 1, name: "x" }, action: "created" });
      const r = cucumberReporter({ captureSteps: false });
      driveMochaTest(r, "should x", "ms4");
      await flush(r);
      await (r as unknown as { onRunnerEnd: (rs: RunnerStats) => Promise<void> }).onRunnerEnd(runner("mocha"));

      expect(apiMocks.requestStepDerivation).not.toHaveBeenCalled();
    });

    it("does NOT request AI derivation for Cucumber runs (deterministic path)", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 456, name: "x" }, action: "created" });
      const r = cucumberReporter();
      driveScenario(r);
      await flush(r);
      await (r as unknown as { onRunnerEnd: (rs: RunnerStats) => Promise<void> }).onRunnerEnd(runner("cucumber"));

      expect(apiMocks.requestStepDerivation).not.toHaveBeenCalled();
    });

    it("creates the scenario case but writes no steps when captureSteps is false", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 456, name: "x" }, action: "created" });
      const r = cucumberReporter({ captureSteps: false });
      driveScenario(r);
      await flush(r);

      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.createSteps).not.toHaveBeenCalled();
    });

    it("overwriteSteps soft-deletes existing steps then rewrites on a matched case", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 456, name: "x" }, action: "found" });
      const r = cucumberReporter({ overwriteSteps: true });
      driveScenario(r);
      await flush(r);

      expect(apiMocks.softDeleteCaseSteps).toHaveBeenCalledTimes(1);
      expect(apiMocks.createSteps).toHaveBeenCalledTimes(1);
    });

    it("is a silent no-op for a Mocha run (no scenario accumulation, no steps written)", async () => {
      const r = cucumberReporter();
      r.onRunnerStart(runner("mocha"));
      r.onSuiteStart(featureSuite());
      r.onTestPass(stepTest("[123] some test"));
      await flush(r);

      expect(apiMocks.createSteps).not.toHaveBeenCalled();
    });
  });
});
