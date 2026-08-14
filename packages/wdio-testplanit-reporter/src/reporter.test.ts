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
  findTestCaseByCustomField: vi.fn(
    async (_opts: { projectId: number; fieldName: string; value: string | number }) =>
      undefined as { id: number; name: string; source: string; automated?: boolean } | undefined,
  ),
  updateTestCase: vi.fn(async (caseId: number, data: { automated?: boolean }) => ({
    id: caseId,
    automated: data.automated,
  })),
  getTestCase: vi.fn(async (caseId: number) => ({
    id: caseId,
    name: "Test Case",
    automated: true,
  })),
  findOrAddTestCaseToRun: vi.fn(async (_opts: { repositoryCaseId: number }) => ({ id: 456 })),
  findOrCreateFolderPath: vi.fn(
    async (_projectId: number, _path: string[], _rootFolderId?: number) => ({ id: 1, name: "Folder" }),
  ),
  createJUnitTestResult: vi.fn(async (_opts: { repositoryCaseId: number }) => ({ id: 789 })),
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
      findTestCaseByCustomField = apiMocks.findTestCaseByCustomField;
      updateTestCase = apiMocks.updateTestCase;
      getTestCase = apiMocks.getTestCase;
      findOrAddTestCaseToRun = apiMocks.findOrAddTestCaseToRun;
      createJUnitTestResult = apiMocks.createJUnitTestResult;
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
      async createTestResult() {
        return { id: 789 };
      }
      async uploadAttachment() {
        return { id: 1, path: "/attachments/1" };
      }
      async createJUnitTestSuite() {
        return { id: 1, name: "Test Suite" };
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
      findOrCreateFolderPath = apiMocks.findOrCreateFolderPath;
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
vi.mock("./shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./shared.js")>();
  return {
    RUN_ID_ENV_VAR: actual.RUN_ID_ENV_VAR,
    parseEnvTestRunId: actual.parseEnvTestRunId,
    readSharedState: vi.fn().mockReturnValue(null),
    writeSharedState: vi.fn(),
    writeSharedStateIfAbsent: vi.fn(),
    writeSharedStateForRun: vi.fn(),
    deleteSharedState: vi.fn(),
    incrementWorkerCount: vi.fn(),
    decrementWorkerCount: vi.fn().mockReturnValue(false),
  };
});

// Import after mocks are set up
import TestPlanItReporter from "./reporter.js";
import {
  readSharedState,
  writeSharedStateIfAbsent,
  writeSharedStateForRun,
  deleteSharedState,
  incrementWorkerCount,
  decrementWorkerCount,
  RUN_ID_ENV_VAR,
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
    apiMocks.findTestCaseByCustomField.mockResolvedValue(undefined);
    apiMocks.updateTestCase.mockImplementation(async (caseId: number, data: { automated?: boolean }) => ({
      id: caseId,
      automated: data.automated,
    }));
    apiMocks.getTestCase.mockImplementation(async (caseId: number) => ({
      id: caseId,
      name: "Test Case",
      automated: true,
    }));
    apiMocks.findOrAddTestCaseToRun.mockResolvedValue({ id: 456 });
    apiMocks.createJUnitTestResult.mockResolvedValue({ id: 789 });
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

    it("should report a to-be-retried failing attempt via onTestRetry", () => {
      // Mocha/Jasmine route a failing attempt that will be retried to
      // test:retry, not test:fail — it must still reach TestPlanIt so the
      // fail-then-pass sequence reads as flaky.
      reporter.onTestRetry(
        createTestStats({
          title: "[456] flaky test",
          state: "failed",
          error: { message: "boom", stack: "Error: boom" } as Error,
        })
      );
      const state = reporter.getState();
      expect(state.results.size).toBe(1);
      const result = Array.from(state.results.values())[0];
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("boom");
    });

    it("should track test without case ID when autoCreateTestCases is false", () => {
      reporter.onTestPass(createTestStats({ title: "test without case ID" }));
      const state = reporter.getState();
      const result = Array.from(state.results.values())[0];
      expect(result.caseId).toBeUndefined();
    });
  });

  describe("excludeSkipped", () => {
    const testStats = (overrides: Partial<TestStats> = {}): TestStats =>
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

    // Await the async reportResult operations tracked on the reporter.
    const flush = async (r: TestPlanItReporter) => {
      const ops = (r as unknown as { pendingOperations: Set<Promise<void>> }).pendingOperations;
      for (let i = 0; i < 10 && ops.size > 0; i++) {
        await Promise.allSettled([...ops]);
      }
    };

    it("reports skipped results by default", async () => {
      reporter.onTestSkip(testStats({ title: "[789] is skipped", state: "skipped" }));
      await flush(reporter);

      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledTimes(1);
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ type: "SKIPPED", statusId: 3 })
      );
    });

    it("sends the runner cid as the worker id", async () => {
      reporter.onTestPass(testStats({ title: "[789] runs in a worker" }));
      await flush(reporter);

      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ worker: "0-0" })
      );
    });

    it("does not report skipped results when excludeSkipped is enabled", async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, excludeSkipped: true });
      r.onTestSkip(testStats({ title: "[789] is skipped", state: "skipped" }));
      await flush(r);

      expect(apiMocks.createJUnitTestResult).not.toHaveBeenCalled();
      // An all-skipped spec never initializes or creates a run.
      expect(r.getState().initialized).toBe(false);
      expect(r.getState().testRunId).toBeUndefined();
    });

    it("still reports non-skipped results when excludeSkipped is enabled", async () => {
      const r = new TestPlanItReporter({ ...defaultOptions, excludeSkipped: true });
      r.onTestSkip(testStats({ title: "[789] is skipped", state: "skipped" }));
      r.onTestPass(testStats({ title: "[123] passes" }));
      await flush(r);

      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledTimes(1);
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 123, type: "PASSED" })
      );
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

    it("captures the test's commands and includes them in the derivation request", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 900, name: "x" }, action: "created" });
      const r = cucumberReporter();
      r.onRunnerStart(runner("mocha"));
      r.onSuiteStart({ title: "Account", uid: "mc1" } as unknown as SuiteStats);
      const t = stepTest("should log in with valid credentials");
      r.onTestStart(t);
      // Commands fire between onTestStart and the test ending.
      r.onBeforeCommand({ command: "navigateTo", body: { url: "https://app/login" } } as never);
      r.onBeforeCommand({ command: "elementSendKeys", body: { text: "a@b.com" } } as never);
      r.onBeforeCommand({ command: "elementClick" } as never);
      r.onTestPass(t);
      await flush(r);
      await (r as unknown as { onRunnerEnd: (rs: RunnerStats) => Promise<void> }).onRunnerEnd(runner("mocha"));

      expect(apiMocks.requestStepDerivation).toHaveBeenCalledTimes(1);
      const arg = apiMocks.requestStepDerivation.mock.calls[0][0] as {
        cases: Array<{ commands?: string[] }>;
      };
      const commands = arg.cases[0].commands;
      expect(commands).toBeDefined();
      expect(commands).toContain('navigateTo {"url":"https://app/login"}');
      expect(commands).toContain('elementSendKeys {"text":"a@b.com"}');
      expect(commands).toContain("elementClick");
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

  describe("matchByCustomField", () => {
    const runner = (framework = "mocha") =>
      ({
        cid: "0-0",
        config: { framework },
        capabilities: { browserName: "chrome" },
        specs: ["/test/specs/search.spec.ts"],
      }) as unknown as RunnerStats;
    const mochaTest = (title: string, uid = title) =>
      ({
        type: "test",
        title,
        fullTitle: title,
        uid,
        cid: "0-0",
        state: "passed",
        duration: 5,
        start: new Date(),
        end: new Date(),
        retries: 0,
      }) as unknown as TestStats;
    const flush = async (r: TestPlanItReporter) => {
      const ops = (r as unknown as { pendingOperations: Set<Promise<void>> }).pendingOperations;
      for (let i = 0; i < 10 && ops.size > 0; i++) {
        await Promise.allSettled([...ops]);
      }
    };
    // A migrated MANUAL case carrying a backfilled external ID (not yet automated).
    const manualCase = { id: 30715, name: "Verify 'Relevance' is the default sort order", source: "MANUAL", automated: false };
    const legacyTitle = "89434 Verify 'Relevance' is the default sort order for search results";

    // ─── Title → identifier parsing (parseCustomFieldId) ───────────────────
    it("parses a bare leading number by default", () => {
      const r = new TestPlanItReporter({ ...defaultOptions, matchByCustomField: { fieldName: "External ID" } });
      expect((r as any).parseCustomFieldId(legacyTitle)).toBe("89434");
    });

    it("honors a custom idPattern (string or RegExp)", () => {
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID", idPattern: /TM-(\d+)/ },
      });
      expect((r as any).parseCustomFieldId("TM-4321 does a thing")).toBe("4321");

      const r2 = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID", idPattern: "TM-(\\d+)" },
      });
      expect((r2 as any).parseCustomFieldId("TM-4321 does a thing")).toBe("4321");
    });

    it("returns undefined when the title has no identifier", () => {
      const r = new TestPlanItReporter({ ...defaultOptions, matchByCustomField: { fieldName: "External ID" } });
      expect((r as any).parseCustomFieldId("no leading number here")).toBeUndefined();
    });

    // ─── Match found → attach directly to the existing case ────────────────
    it("attaches the result directly to a case matched by custom field, skipping auto-create", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(manualCase);
      // Deliberately WITHOUT autoCreateTestCases / parentFolderId / templateId:
      // the direct-attach path must not need them.
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      // Looked up by the parsed identifier against the named field.
      expect(apiMocks.findTestCaseByCustomField).toHaveBeenCalledTimes(1);
      expect(apiMocks.findTestCaseByCustomField).toHaveBeenCalledWith({
        projectId: 1,
        fieldName: "External ID",
        value: "89434",
      });
      // Attached to the matched case id (regardless of its MANUAL source)...
      expect(apiMocks.findOrAddTestCaseToRun).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 30715 }),
      );
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 30715 }),
      );
      // ...and NO new case was created.
      expect(apiMocks.findOrCreateTestCase).not.toHaveBeenCalled();
      expect(r.getState().stats.testCasesFound).toBe(1);
      expect(r.getState().stats.apiErrors).toBe(0);
    });

    // ─── Flip the matched case to automated ────────────────────────────────
    it("flips the matched case to automated when it is not already automated", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(manualCase); // automated: false
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      expect(apiMocks.updateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.updateTestCase).toHaveBeenCalledWith(30715, { automated: true });
      // The result is still attached to the matched case.
      expect(apiMocks.findOrAddTestCaseToRun).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 30715 }),
      );
      expect(r.getState().stats.apiErrors).toBe(0);
    });

    it("does not write when the matched case is already automated", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue({ ...manualCase, automated: true });
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      // Already automated → no redundant update, but still attaches.
      expect(apiMocks.updateTestCase).not.toHaveBeenCalled();
      expect(apiMocks.findOrAddTestCaseToRun).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 30715 }),
      );
    });

    it("swallows an updateTestCase failure and still reports the result", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(manualCase); // automated: false
      apiMocks.updateTestCase.mockRejectedValue(new Error("boom"));
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      // The flip was attempted but failed — reporting continued regardless.
      expect(apiMocks.updateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.findOrAddTestCaseToRun).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 30715 }),
      );
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 30715 }),
      );
      // A failed flip does not count as a reporting API error.
      expect(r.getState().stats.apiErrors).toBe(0);
    });

    it("caches the resolution so a retried test does not re-query", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(manualCase);
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      // Retries run sequentially: the second pass resolves after the first has
      // populated the cache, so it must not hit the API again.
      r.onTestPass(mochaTest(legacyTitle, "uid-a"));
      await flush(r);
      r.onTestPass(mochaTest(legacyTitle, "uid-b"));
      await flush(r);

      expect(apiMocks.findTestCaseByCustomField).toHaveBeenCalledTimes(1);
    });

    // ─── No match → fall through to existing behavior ──────────────────────
    it("falls through to auto-create when no case matches the custom field", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(undefined);
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 999, name: "x" }, action: "created" });
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
        autoCreateTestCases: true,
        parentFolderId: 10,
        templateId: 1,
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      expect(apiMocks.findTestCaseByCustomField).toHaveBeenCalledTimes(1);
      // Fell through to the standard name+className+source create path.
      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.findOrAddTestCaseToRun).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 999 }),
      );
      expect(r.getState().stats.apiErrors).toBe(0);
    });

    // ─── Field doesn't exist → graceful fall-through, never throws ─────────
    it("falls through without throwing when the named field does not exist (client returns undefined)", async () => {
      // A missing field yields no matching rows -> undefined, same as no match.
      apiMocks.findTestCaseByCustomField.mockResolvedValue(undefined);
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 42, name: "x" }, action: "created" });
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "Nonexistent Field" },
        autoCreateTestCases: true,
        parentFolderId: 10,
        templateId: 1,
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(r.getState().stats.apiErrors).toBe(0);
    });

    it("swallows a lookup error and falls through to the standard flow", async () => {
      apiMocks.findTestCaseByCustomField.mockRejectedValue(new Error("boom"));
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 77, name: "x" }, action: "created" });
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
        autoCreateTestCases: true,
        parentFolderId: 10,
        templateId: 1,
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      // The lookup error did not abort reporting — the create fallback ran and
      // the result was attached. The error is handled inside resolution, so the
      // reporter's own error counter is not bumped.
      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 77 }),
      );
    });

    it("skips the test (no create) when no match and auto-create is off", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(undefined);
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      expect(apiMocks.findTestCaseByCustomField).toHaveBeenCalledTimes(1);
      expect(apiMocks.findOrCreateTestCase).not.toHaveBeenCalled();
      expect(apiMocks.findOrAddTestCaseToRun).not.toHaveBeenCalled();
    });

    // ─── Precedence + backward compatibility ───────────────────────────────
    it("an explicit case id in the title takes precedence over custom-field matching", async () => {
      apiMocks.findTestCaseByCustomField.mockResolvedValue(manualCase);
      const r = new TestPlanItReporter({
        ...defaultOptions,
        matchByCustomField: { fieldName: "External ID" },
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest("[555] some explicitly linked test"));
      await flush(r);

      expect(apiMocks.findTestCaseByCustomField).not.toHaveBeenCalled();
      expect(apiMocks.findOrAddTestCaseToRun).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 555 }),
      );
    });

    it("never queries the custom field when the option is not configured (backward compatible)", async () => {
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 456, name: "x" }, action: "created" });
      const r = new TestPlanItReporter({
        ...defaultOptions,
        autoCreateTestCases: true,
        parentFolderId: 10,
        templateId: 1,
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      expect(apiMocks.findTestCaseByCustomField).not.toHaveBeenCalled();
      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
    });

    it("falls back to the parent folder when folder creation fails", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      apiMocks.findOrCreateFolderPath.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "RepositoryFolders_projectId_repositoryId_parentId_name_isDe_key"'),
      );
      apiMocks.findOrCreateTestCase.mockResolvedValue({ testCase: { id: 456, name: "x" }, action: "created" });
      const r = new TestPlanItReporter({
        ...defaultOptions,
        autoCreateTestCases: true,
        createFolderHierarchy: true,
        parentFolderId: 10,
        templateId: 1,
      });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest(legacyTitle));
      await flush(r);

      // The result is not lost — the case lands in the configured parent folder.
      expect(apiMocks.findOrCreateFolderPath).toHaveBeenCalledTimes(1);
      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.findOrCreateTestCase).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 10 }),
      );
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledTimes(1);
      err.mockRestore();
    });

    // ─── Explicitly linked cases ([123] in the title) flip to automated ─────
    it("flips a not-automated explicitly linked case when a result reports against it", async () => {
      apiMocks.getTestCase.mockResolvedValueOnce({ id: 555, name: "Manual case", automated: false });
      const r = new TestPlanItReporter({ ...defaultOptions });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest("[555] some explicitly linked test"));
      await flush(r);

      expect(apiMocks.getTestCase).toHaveBeenCalledWith(555);
      expect(apiMocks.updateTestCase).toHaveBeenCalledWith(555, { automated: true });
      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 555 }),
      );
    });

    it("skips the write when the explicitly linked case is already automated", async () => {
      apiMocks.getTestCase.mockResolvedValueOnce({ id: 555, name: "Auto case", automated: true });
      const r = new TestPlanItReporter({ ...defaultOptions });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest("[555] some explicitly linked test"));
      await flush(r);

      expect(apiMocks.updateTestCase).not.toHaveBeenCalled();
    });

    it("checks each explicitly linked case once per run (memoized)", async () => {
      apiMocks.getTestCase.mockResolvedValue({ id: 555, name: "Manual case", automated: false });
      const r = new TestPlanItReporter({ ...defaultOptions });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest("[555] first test", "t1"));
      r.onTestPass(mochaTest("[555] second test", "t2"));
      await flush(r);

      expect(apiMocks.getTestCase).toHaveBeenCalledTimes(1);
      expect(apiMocks.updateTestCase).toHaveBeenCalledTimes(1);
    });

    it("never loses the result when the explicit-link flip fails", async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      apiMocks.getTestCase.mockRejectedValueOnce(new Error("boom"));
      const r = new TestPlanItReporter({ ...defaultOptions });
      r.onRunnerStart(runner());
      r.onSuiteStart({ title: "Search", uid: "s1" } as unknown as SuiteStats);
      r.onTestPass(mochaTest("[555] some explicitly linked test"));
      await flush(r);

      expect(apiMocks.createJUnitTestResult).toHaveBeenCalledWith(
        expect.objectContaining({ repositoryCaseId: 555 }),
      );
      expect(r.getState().stats.apiErrors).toBe(0);
      err.mockRestore();
    });
  });
});

describe("externally managed test run", () => {
  const defaultOptions = {
    domain: "https://testplanit.example.com",
    apiToken: "tpi_test_token",
    projectId: 1,
  };

  const mockedReadSharedState = vi.mocked(readSharedState);
  const mockedWriteSharedStateIfAbsent = vi.mocked(writeSharedStateIfAbsent);
  const mockedWriteSharedStateForRun = vi.mocked(writeSharedStateForRun);
  const mockedDeleteSharedState = vi.mocked(deleteSharedState);
  const mockedDecrementWorkerCount = vi.mocked(decrementWorkerCount);

  const runner = () =>
    ({
      cid: "0-0",
      config: { framework: "mocha" },
      capabilities: { browserName: "chrome", platformName: "macOS" },
      specs: ["/test/specs/login.spec.js"],
    }) as unknown as RunnerStats;

  const passingTest = (title = "[555] logs in") =>
    ({
      type: "test",
      title,
      fullTitle: `Login > ${title}`,
      uid: `uid-${title}`,
      cid: "0-0",
      state: "passed",
      duration: 100,
      start: new Date(),
      end: new Date(),
      retries: 0,
    }) as unknown as TestStats;

  const flush = async (r: TestPlanItReporter) => {
    const ops = (r as unknown as { pendingOperations: Set<Promise<void>> }).pendingOperations;
    for (let i = 0; i < 10 && ops.size > 0; i++) {
      await Promise.allSettled([...ops]);
    }
  };

  // Report one result, the way a real invocation would. `currentSpec` is set by
  // the WDIOReporter base class during onSuiteStart; the mocked base class in
  // this file does not, so it is assigned here.
  const driveResults = async (r: TestPlanItReporter) => {
    r.onRunnerStart(runner());
    r.onSuiteStart({ title: "Login", uid: "s1" } as unknown as SuiteStats);
    (r as any).currentSpec = "/test/specs/login.spec.js";
    r.onTestPass(passingTest());
    await flush(r);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadSharedState.mockReturnValue(null);
    delete process.env[RUN_ID_ENV_VAR];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env[RUN_ID_ENV_VAR];
  });

  describe("resolution precedence", () => {
    it("pins the run from TESTPLANIT_RUN_ID", () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter(defaultOptions);

      expect(reporter.getState().testRunId).toBe(984);
      expect((reporter as any).externallyManaged).toBe(true);
    });

    it("prefers a numeric testRunId option over the environment variable", () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter({ ...defaultOptions, testRunId: 42 });

      expect(reporter.getState().testRunId).toBe(42);
    });

    it("prefers the environment variable over a run name lookup", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        testRunId: "Web Regression Tests - DEV #984",
      });
      const findByName = vi.spyOn((reporter as any).client, "findTestRunByName");

      await (reporter as any).initialize();

      expect(reporter.getState().testRunId).toBe(984);
      expect(findByName).not.toHaveBeenCalled();
    });

    it("falls back to a run name lookup and marks the run externally managed", async () => {
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        testRunId: "Web Regression Tests - DEV #984",
      });
      const createTestRun = vi.spyOn((reporter as any).client, "createTestRun");

      await (reporter as any).initialize();

      expect(reporter.getState().testRunId).toBe(123);
      expect((reporter as any).externallyManaged).toBe(true);
      expect(createTestRun).not.toHaveBeenCalled();
    });

    it("ignores a non-numeric environment variable", () => {
      process.env[RUN_ID_ENV_VAR] = "${RUN_ID}";
      const reporter = new TestPlanItReporter(defaultOptions);

      expect(reporter.getState().testRunId).toBeUndefined();
      expect((reporter as any).externallyManaged).toBe(false);
    });

    it("ignores an empty environment variable", () => {
      process.env[RUN_ID_ENV_VAR] = "   ";
      const reporter = new TestPlanItReporter(defaultOptions);

      expect(reporter.getState().testRunId).toBeUndefined();
      expect((reporter as any).externallyManaged).toBe(false);
    });

    it("takes precedence over the oneReport shared state", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      mockedReadSharedState.mockReturnValue({
        testRunId: 500,
        testSuiteId: 600,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      });

      const reporter = new TestPlanItReporter(defaultOptions);
      await (reporter as any).initialize();

      expect(reporter.getState().testRunId).toBe(984);
      expect(reporter.getState().testSuiteId).toBeUndefined();
    });
  });

  describe("run lifecycle", () => {
    it("never creates a run", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter(defaultOptions);
      const createTestRun = vi.spyOn((reporter as any).client, "createTestRun");

      await (reporter as any).initialize();

      expect(createTestRun).not.toHaveBeenCalled();
      expect(reporter.getState().testRunId).toBe(984);
    });

    it("never completes the run, even with completeRunOnFinish enabled", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        completeRunOnFinish: true,
        oneReport: false,
      });
      const completeTestRun = vi.spyOn((reporter as any).client, "completeTestRun");

      await (reporter as any).initialize();
      await driveResults(reporter);
      await (reporter as any).onRunnerEnd(runner());

      expect(completeTestRun).not.toHaveBeenCalled();
      expect((reporter as any).reporterOptions.completeRunOnFinish).toBe(false);
    });

    it("does not complete the run when it is the last worker of an invocation", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      mockedDecrementWorkerCount.mockReturnValue(true);

      const reporter = new TestPlanItReporter({ ...defaultOptions, completeRunOnFinish: true });
      const completeTestRun = vi.spyOn((reporter as any).client, "completeTestRun");

      await (reporter as any).initialize();
      await driveResults(reporter);
      await (reporter as any).onRunnerEnd(runner());

      expect(completeTestRun).not.toHaveBeenCalled();
      expect(mockedDecrementWorkerCount).toHaveBeenCalledWith(1);
    });

    it("stays on the pinned run across two invocations reporting into it", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";

      const first = new TestPlanItReporter({ ...defaultOptions, completeRunOnFinish: true });
      const firstComplete = vi.spyOn((first as any).client, "completeTestRun");
      await (first as any).initialize();
      await driveResults(first);
      await (first as any).onRunnerEnd(runner());

      // The second invocation starts after the first finished — the state file
      // now reports zero active workers.
      mockedReadSharedState.mockReturnValue({
        testRunId: 984,
        testSuiteId: 600,
        createdAt: new Date().toISOString(),
        activeWorkers: 0,
      });

      const second = new TestPlanItReporter({ ...defaultOptions, completeRunOnFinish: true });
      const secondComplete = vi.spyOn((second as any).client, "completeTestRun");
      const secondCreate = vi.spyOn((second as any).client, "createTestRun");
      await (second as any).initialize();
      await driveResults(second);
      await (second as any).onRunnerEnd(runner());

      expect(first.getState().testRunId).toBe(984);
      expect(second.getState().testRunId).toBe(984);
      expect(secondCreate).not.toHaveBeenCalled();
      expect(firstComplete).not.toHaveBeenCalled();
      expect(secondComplete).not.toHaveBeenCalled();
    });

    it("keeps the pinned run when the shared state reports no active workers", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      mockedReadSharedState.mockReturnValue({
        testRunId: 984,
        testSuiteId: 600,
        createdAt: new Date().toISOString(),
        activeWorkers: 0,
      });

      const reporter = new TestPlanItReporter(defaultOptions);
      await (reporter as any).initialize();

      expect(reporter.getState().testRunId).toBe(984);
      expect(mockedDeleteSharedState).not.toHaveBeenCalled();
    });

    it("keeps the pinned run when it is already completed", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter(defaultOptions);
      vi.spyOn((reporter as any).client, "getTestRun").mockResolvedValue({
        id: 984,
        name: "Web Regression Tests - DEV #984",
        isCompleted: true,
        isDeleted: false,
      });

      await (reporter as any).initialize();

      expect(reporter.getState().testRunId).toBe(984);
      expect(mockedDeleteSharedState).not.toHaveBeenCalled();
    });

    it("keeps attaching when the pinned run cannot be read", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter(defaultOptions);
      vi.spyOn((reporter as any).client, "getTestRun").mockRejectedValue(new Error("404"));
      const createTestRun = vi.spyOn((reporter as any).client, "createTestRun");
      vi.spyOn(console, "error").mockImplementation(() => {});

      await (reporter as any).initialize();

      expect(reporter.getState().testRunId).toBe(984);
      expect(reporter.getState().initialized).toBe(true);
      expect(createTestRun).not.toHaveBeenCalled();
    });
  });

  describe("run field resolution", () => {
    it("does not resolve configuration, milestone, state or tags for a pinned run", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        configId: "Chrome / macOS",
        milestoneId: "Release 2.0",
        stateId: "In Progress",
        tagIds: ["regression"],
      });
      const client = (reporter as any).client;
      const findConfig = vi.spyOn(client, "findConfigurationByName");
      const findMilestone = vi.spyOn(client, "findMilestoneByName");
      const findState = vi.spyOn(client, "findWorkflowStateByName");
      const resolveTags = vi.spyOn(client, "resolveTagIds");

      await (reporter as any).initialize();

      expect(findConfig).not.toHaveBeenCalled();
      expect(findMilestone).not.toHaveBeenCalled();
      expect(findState).not.toHaveBeenCalled();
      expect(resolveTags).not.toHaveBeenCalled();
      expect(reporter.getState().resolvedIds.configId).toBeUndefined();
    });

    it("still resolves folder and template, which test case creation needs", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        autoCreateTestCases: true,
        parentFolderId: "Automated",
        templateId: "Automation",
      });
      const client = (reporter as any).client;
      const findFolder = vi.spyOn(client, "findFolderByName");
      const findTemplate = vi.spyOn(client, "findTemplateByName");

      await (reporter as any).initialize();

      expect(findFolder).toHaveBeenCalled();
      expect(findTemplate).toHaveBeenCalled();
      expect(reporter.getState().resolvedIds.parentFolderId).toBe(1);
      expect(reporter.getState().resolvedIds.templateId).toBe(1);
    });

    it("resolves run fields normally when no run is pinned", async () => {
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        configId: "Chrome / macOS",
        tagIds: ["regression"],
      });
      const client = (reporter as any).client;
      const findConfig = vi.spyOn(client, "findConfigurationByName");
      const resolveTags = vi.spyOn(client, "resolveTagIds");

      await (reporter as any).initialize();

      expect(findConfig).toHaveBeenCalled();
      expect(resolveTags).toHaveBeenCalled();
      expect(reporter.getState().resolvedIds.configId).toBe(1);
    });
  });

  describe("JUnit suite naming", () => {
    it("names the suite by capability and spec for a pinned run", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter(defaultOptions);
      const createSuite = vi.spyOn((reporter as any).client, "createJUnitTestSuite");

      await (reporter as any).initialize();
      await driveResults(reporter);

      expect(createSuite).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId: 984,
          name: "Login - chrome/macOS - login",
        }),
      );
    });

    it("honours an explicit testSuiteName template", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        testSuiteName: "Shard {spec} on {browser}",
      });
      const createSuite = vi.spyOn((reporter as any).client, "createJUnitTestSuite");

      await (reporter as any).initialize();
      await driveResults(reporter);

      expect(createSuite).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Shard login on chrome" }),
      );
    });

    it("keeps naming the suite after the run when no run is pinned", async () => {
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        runName: "Nightly Regression",
      });
      const createSuite = vi.spyOn((reporter as any).client, "createJUnitTestSuite");

      await (reporter as any).initialize();
      await driveResults(reporter);

      expect(createSuite).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Nightly Regression" }),
      );
    });

    it("ignores a shared suite recorded for a different run", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      mockedReadSharedState.mockReturnValue({
        testRunId: 500,
        testSuiteId: 600,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      });
      const reporter = new TestPlanItReporter(defaultOptions);
      const createSuite = vi.spyOn((reporter as any).client, "createJUnitTestSuite");

      await (reporter as any).initialize();
      await driveResults(reporter);

      expect(createSuite).toHaveBeenCalledWith(expect.objectContaining({ testRunId: 984 }));
      expect(reporter.getState().testSuiteId).not.toBe(600);
    });

    it("reuses a shared suite recorded for the pinned run", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      mockedReadSharedState.mockReturnValue({
        testRunId: 984,
        testSuiteId: 600,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      });
      const reporter = new TestPlanItReporter(defaultOptions);
      const createSuite = vi.spyOn((reporter as any).client, "createJUnitTestSuite");

      await (reporter as any).initialize();
      await driveResults(reporter);

      expect(createSuite).not.toHaveBeenCalled();
      expect(reporter.getState().testSuiteId).toBe(600);
    });

    it("records the suite against the pinned run rather than joining stale state", async () => {
      process.env[RUN_ID_ENV_VAR] = "984";
      const reporter = new TestPlanItReporter(defaultOptions);

      await (reporter as any).initialize();
      await driveResults(reporter);

      expect(mockedWriteSharedStateForRun).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ testRunId: 984 }),
      );
      expect(mockedWriteSharedStateIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe("backward compatibility", () => {
    it("creates and completes a run when nothing pins one", async () => {
      const reporter = new TestPlanItReporter({
        ...defaultOptions,
        completeRunOnFinish: true,
        oneReport: false,
      });
      const createTestRun = vi.spyOn((reporter as any).client, "createTestRun");
      const completeTestRun = vi.spyOn((reporter as any).client, "completeTestRun");

      await (reporter as any).initialize();
      await driveResults(reporter);
      await (reporter as any).onRunnerEnd(runner());

      expect((reporter as any).externallyManaged).toBe(false);
      expect(createTestRun).toHaveBeenCalled();
      expect(completeTestRun).toHaveBeenCalled();
    });

    it("still discards a completed shared run when nothing pins one", async () => {
      mockedReadSharedState.mockReturnValue({
        testRunId: 500,
        testSuiteId: 600,
        createdAt: new Date().toISOString(),
        activeWorkers: 1,
      });
      const reporter = new TestPlanItReporter(defaultOptions);
      vi.spyOn((reporter as any).client, "getTestRun").mockResolvedValue({
        id: 500,
        name: "Old Run",
        isCompleted: true,
        isDeleted: false,
      });
      const createTestRun = vi.spyOn((reporter as any).client, "createTestRun");

      await (reporter as any).initialize();

      expect(mockedDeleteSharedState).toHaveBeenCalled();
      expect(createTestRun).toHaveBeenCalled();
    });
  });
});
