import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiToken: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  // CR-01: import/route.ts wraps `routeToIteration` in
  // `prisma.$transaction(async (tx) => …)`. The mock executes the
  // callback synchronously with the same `prisma` mock as the tx
  // client, which is enough for the smoke tests since
  // `routeToIteration` itself is mocked out below.
  const prismaMock: any = {
    workflows: {
      findFirst: vi.fn(),
      // `resolveCreateStateRemap` enumerates gated states via findMany to
      // walk the strict-transitive chain. Returning an empty array keeps
      // the smoke flow on the no-gates-in-scope branch.
      findMany: vi.fn().mockResolvedValue([]),
    },
    templates: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    testRuns: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    repositories: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    repositoryFolders: {
      findFirst: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    repositoryCases: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    testRunCases: {
      upsert: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    testRunCaseIteration: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    jUnitTestSuite: {
      create: vi.fn(),
    },
    jUnitTestResult: {
      create: vi.fn(),
    },
    jUnitTestStep: {
      create: vi.fn(),
    },
    status: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    projects: {
      findUnique: vi.fn(),
    },
    // `resolveCreateStateRemap` (wired into the import route by the v0.30.0
    // strict-transitive create-gate fix) calls `isReviewFeatureSystemEnabled`
    // which reads AppConfig. A `findUnique` that resolves to `null` keeps the
    // helper on the default-on path and lets the import flow proceed without
    // exercising any review-gate semantics in these smokes.
    appConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
  prismaMock.$transaction = vi.fn(async (cb: (tx: any) => Promise<any>) =>
    cb(prismaMock)
  );
  return { prisma: prismaMock };
});

vi.mock("~/lib/services/auditLog", () => ({
  auditBulkCreate: vi.fn().mockResolvedValue(undefined),
}));

// INT-02: mock the router so smokes can assert it was called (without
// touching the DB) and inject the cap-exceeded error path.
vi.mock("~/lib/services/junitIterationRouter", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/services/junitIterationRouter")
  >("~/lib/services/junitIterationRouter");
  return {
    ...actual,
    routeToIteration: vi.fn().mockResolvedValue({
      iterationId: 555,
      autoCreated: false,
    }),
  };
});

vi.mock("~/lib/services/testResultsParser", () => ({
  detectFormat: vi.fn(),
  isValidFormat: vi.fn(),
  parseTestResults: vi.fn(),
  normalizeStatus: vi.fn(),
  extractClassName: vi.fn(),
  parseExtendedTestCaseData: vi.fn(),
  getExtendedDataKey: vi.fn(),
  countTotalTestCases: vi.fn(),
  FORMAT_TO_RUN_TYPE: {
    junit: "JUNIT",
    testng: "JUNIT",
    xunit: "JUNIT",
    nunit: "JUNIT",
    mocha: "JUNIT",
    cucumber: "JUNIT",
  },
  FORMAT_TO_SOURCE: {
    junit: "JUNIT",
    testng: "TESTNG",
    xunit: "XUNIT",
    nunit: "NUNIT",
    mocha: "MOCHA",
    cucumber: "CUCUMBER",
  },
  TEST_RESULT_FORMATS: {
    junit: { label: "JUnit XML" },
  },
}));

import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";
import { routeToIteration } from "~/lib/services/junitIterationRouter";
import { getServerAuthSession } from "~/server/auth";
import {
  detectFormat,
  parseTestResults,
  normalizeStatus,
  extractClassName,
  parseExtendedTestCaseData,
  getExtendedDataKey,
  countTotalTestCases,
  isValidFormat,
} from "~/lib/services/testResultsParser";

// Helper to read all SSE data events from a Response
async function readSseResponse(response: Response): Promise<any[]> {
  const text = await response.text();
  const events: any[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        events.push(JSON.parse(line.slice(6)));
      } catch {
        // skip
      }
    }
  }
  return events;
}

describe("Test Results Import API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
    },
  };

  const mockWorkflow = { id: 1, workflowType: "DONE", scope: "CASES" };
  const mockRunWorkflow = { id: 2, workflowType: "DONE", scope: "RUNS" };
  const mockTemplate = { id: 1, isDefault: true };
  const mockTestRun = { id: 42, testRunType: "JUNIT" };
  const mockRepository = { id: 1, projectId: 1 };
  const mockFolder = { id: 10, projectId: 1 };
  const mockRepositoryCase = { id: 100, name: "test case" };
  const mockTestRunCase = { id: 200, testRunId: 42, repositoryCaseId: 100 };
  const mockSuite = { id: 300, testRunId: 42 };
  const mockStatus = { id: 1, isSuccess: true, color: null };

  const createMockFile = (
    name: string,
    content: string = "<testsuite></testsuite>"
  ): File => {
    const blob = new Blob([content], { type: "text/xml" });
    return new File([blob], name, { type: "text/xml" });
  };

  const createFormDataRequest = (formData: FormData): NextRequest => {
    return {
      formData: async () => formData,
      headers: new Headers(),
    } as unknown as NextRequest;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerAuthSession as any).mockResolvedValue(mockSession);
    (prisma.workflows.findFirst as any)
      .mockResolvedValueOnce(mockWorkflow)
      .mockResolvedValueOnce(mockRunWorkflow);
    (prisma.templates.findFirst as any).mockResolvedValue(mockTemplate);
    (prisma.testRuns.create as any).mockResolvedValue(mockTestRun);
    (prisma.testRuns.findUnique as any).mockResolvedValue(mockTestRun);
    (prisma.repositories.findFirst as any).mockResolvedValue(mockRepository);
    (prisma.repositoryFolders.findFirst as any).mockResolvedValue(mockFolder);
    (prisma.repositoryFolders.upsert as any).mockResolvedValue(mockFolder);
    (prisma.repositoryCases.findFirst as any).mockResolvedValue(null);
    (prisma.repositoryCases.create as any).mockResolvedValue(
      mockRepositoryCase
    );
    (prisma.repositoryCases.update as any).mockResolvedValue(
      mockRepositoryCase
    );
    (prisma.testRunCases.upsert as any).mockResolvedValue(mockTestRunCase);
    (prisma.testRunCases.findFirst as any).mockResolvedValue(mockTestRunCase);
    (prisma.testRunCases.update as any).mockResolvedValue(mockTestRunCase);
    (prisma.jUnitTestSuite.create as any).mockResolvedValue(mockSuite);
    (prisma.jUnitTestResult.create as any).mockResolvedValue({ id: 400 });
    (prisma.status.findFirst as any).mockResolvedValue(mockStatus);
    // INT-02: project iteration-property config + status map are loaded
    // ONCE per import (before the per-case loop). Default mocks reflect
    // the legacy (non-parameterized) path so existing tests keep passing.
    (prisma.projects.findUnique as any).mockResolvedValue({
      junitIterationPropertyNames: [],
    });
    (prisma.status.findMany as any).mockResolvedValue([]);
    (prisma.testRunCaseIteration.findFirst as any).mockResolvedValue(null);
    (prisma.testRunCaseIteration.upsert as any).mockResolvedValue({ id: 999 });
    (prisma.testRunCaseIteration.findMany as any).mockResolvedValue([]);

    (detectFormat as any).mockReturnValue("junit");
    (isValidFormat as any).mockReturnValue(true);
    (normalizeStatus as any).mockReturnValue("passed");
    (extractClassName as any).mockReturnValue("com.example.TestClass");
    (parseExtendedTestCaseData as any).mockReturnValue(new Map());
    (getExtendedDataKey as any).mockReturnValue("key");
    (countTotalTestCases as any).mockReturnValue(1);
    (parseTestResults as any).mockResolvedValue({
      result: {
        total: 1,
        passed: 1,
        failed: 0,
        errors: 0,
        skipped: 0,
        duration: 1.5,
        suites: [
          {
            name: "com.example.TestSuite",
            total: 1,
            passed: 1,
            failed: 0,
            errors: 0,
            skipped: 0,
            duration: 1.5,
            cases: [
              {
                name: "test_login",
                status: "passed",
                duration: 1.5,
                failure: null,
                stack_trace: null,
                attachments: [],
              },
            ],
          },
        ],
      },
      errors: [],
    });
  });

  describe("Authentication", () => {
    it("returns 401 in stream when no session and no API token", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: false,
        error: "No token",
        errorCode: "NO_TOKEN",
      });

      const formData = new FormData();
      const request = createFormDataRequest(formData);

      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it("allows access with valid API token when no session", async () => {
      (getServerAuthSession as any).mockResolvedValue(null);
      (authenticateApiToken as any).mockResolvedValue({
        authenticated: true,
        userId: "api-user-456",
      });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);

      // SSE stream is returned — not a 401
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });
  });

  describe("SSE Stream Response", () => {
    it("returns text/event-stream content type", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("streams progress events and final complete event", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);

      const events = await readSseResponse(response);

      // Should have progress events with numeric progress
      const progressEvents = events.filter((e) => "progress" in e);
      expect(progressEvents.length).toBeGreaterThan(0);

      // Should have a completion event
      const completeEvent = events.find((e) => e.complete === true);
      expect(completeEvent).toBeDefined();
      expect(completeEvent).toHaveProperty("testRunId");
    });

    it("emits error event when required fields are missing", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      // Missing name and projectId — workflows will be missing

      (prisma.workflows.findFirst as any).mockResolvedValue(null);

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      const errorEvent = events.find((e) => "error" in e);
      expect(errorEvent).toBeDefined();
    });

    it("emits error when format cannot be detected", async () => {
      (detectFormat as any).mockReturnValue(null);

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml", "not xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      const errorEvent = events.find((e) => "error" in e);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toContain("Unable to auto-detect format");
    });

    it("creates test run when testRunId not provided", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "New Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      await readSseResponse(response);

      expect(prisma.testRuns.create).toHaveBeenCalled();
    });

    it("reuses existing test run when testRunId is provided and type matches", async () => {
      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("testRunId", "42");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      // Should not create a new test run
      expect(prisma.testRuns.create).not.toHaveBeenCalled();
      // Should complete successfully
      const completeEvent = events.find((e) => e.complete === true);
      expect(completeEvent?.testRunId).toBe(42);
    });

    it("emits error when existing test run type does not match format", async () => {
      (prisma.testRuns.findUnique as any).mockResolvedValue({
        id: 42,
        testRunType: "REGULAR", // does not match JUNIT
      });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("testRunId", "42");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      const errorEvent = events.find((e) => "error" in e);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toContain("not of type");
    });

    it("emits error when no template is available", async () => {
      (prisma.templates.findFirst as any).mockResolvedValue(null);

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      const errorEvent = events.find((e) => "error" in e);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toContain("No template found");
    });
  });

  describe("INT-02 iteration routing branch", () => {
    it("calls routeToIteration when metadata.iteration is present", async () => {
      // Project has the default property name list (empty array → fallback
      // to ['iteration'] inside the helper).
      (prisma.projects.findUnique as any).mockResolvedValue({
        junitIterationPropertyNames: [],
      });
      // Parsed test case carries an iteration property.
      (parseTestResults as any).mockResolvedValueOnce({
        result: {
          total: 1,
          passed: 1,
          failed: 0,
          errors: 0,
          skipped: 0,
          duration: 1.5,
          suites: [
            {
              name: "com.example.TestSuite",
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              skipped: 0,
              duration: 1.5,
              cases: [
                {
                  name: "test_login",
                  status: "passed",
                  duration: 1.5,
                  failure: null,
                  stack_trace: null,
                  attachments: [],
                  metadata: { iteration: "2" },
                },
              ],
            },
          ],
        },
        errors: [],
      });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      await readSseResponse(response);

      // The router was called with iterationIndex === 2.
      expect(routeToIteration).toHaveBeenCalled();
      const callArgs = (routeToIteration as any).mock.calls[0][1];
      expect(callArgs.iterationIndex).toBe(2);
      // PARAM-07: the legacy TestRunCases.update path was NOT taken — the
      // router owns the rollup on the iteration path.
      expect(prisma.testRunCases.update).not.toHaveBeenCalled();
    });

    it("does NOT call routeToIteration when metadata.iteration is absent (legacy path)", async () => {
      // No metadata on the parsed case (default fixture). Router must
      // not be invoked; legacy TestRunCases.update runs.
      (prisma.projects.findUnique as any).mockResolvedValue({
        junitIterationPropertyNames: [],
      });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      await readSseResponse(response);

      expect(routeToIteration).not.toHaveBeenCalled();
      // Legacy path writes case-level status directly.
      expect(prisma.testRunCases.update).toHaveBeenCalled();
    });

    it("refuses with a 422 pre-flight event when a single case exceeds the cap (WR-07)", async () => {
      (prisma.projects.findUnique as any).mockResolvedValue({
        junitIterationPropertyNames: [],
      });
      (parseTestResults as any).mockResolvedValueOnce({
        result: {
          total: 1,
          passed: 1,
          failed: 0,
          errors: 0,
          skipped: 0,
          duration: 1.5,
          suites: [
            {
              name: "com.example.TestSuite",
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              skipped: 0,
              duration: 1.5,
              cases: [
                {
                  name: "test_overflow",
                  status: "passed",
                  duration: 1.5,
                  failure: null,
                  stack_trace: null,
                  attachments: [],
                  metadata: { iteration: "5001" },
                },
              ],
            },
          ],
        },
        errors: [],
      });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      const errorEvent = events.find(
        (e) => e.code === "ITERATION_CAP_EXCEEDED"
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent.status).toBe(422);
      expect(errorEvent.cap).toBe(5000);
      expect(errorEvent.violatorCount).toBe(1);
      expect(errorEvent.violators).toHaveLength(1);
      expect(errorEvent.violators[0]).toMatchObject({
        suiteName: "com.example.TestSuite",
        caseName: "test_overflow",
        requestedIndex: 5001,
        cap: 5000,
      });
      expect(errorEvent.i18nKey).toBe(
        "api.testResults.import.iterationCapExceeded"
      );
      // routeToIteration must NEVER be called: pre-flight refused before
      // the per-suite loop began. No partial DB state can exist.
      expect(routeToIteration).not.toHaveBeenCalled();
      // The completion event must NOT be present — we bailed before it.
      const completeEvent = events.find((e) => e.complete === true);
      expect(completeEvent).toBeUndefined();
    });

    it("refuses with a multi-violator 422 listing every offender in one pass (WR-07)", async () => {
      (prisma.projects.findUnique as any).mockResolvedValue({
        junitIterationPropertyNames: [],
      });
      (parseTestResults as any).mockResolvedValueOnce({
        result: {
          total: 3,
          passed: 3,
          failed: 0,
          errors: 0,
          skipped: 0,
          duration: 3,
          suites: [
            {
              name: "Alpha",
              total: 2,
              passed: 2,
              failed: 0,
              errors: 0,
              skipped: 0,
              duration: 2,
              cases: [
                {
                  name: "case-A",
                  status: "passed",
                  duration: 1,
                  failure: null,
                  stack_trace: null,
                  attachments: [],
                  metadata: { iteration: "9999" },
                },
                {
                  name: "case-OK",
                  status: "passed",
                  duration: 1,
                  failure: null,
                  stack_trace: null,
                  attachments: [],
                  metadata: { iteration: "3" },
                },
              ],
            },
            {
              name: "Beta",
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              skipped: 0,
              duration: 1,
              cases: [
                {
                  name: "case-B",
                  status: "passed",
                  duration: 1,
                  failure: null,
                  stack_trace: null,
                  attachments: [],
                  metadata: { iteration: "12345" },
                },
              ],
            },
          ],
        },
        errors: [],
      });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      const errorEvent = events.find(
        (e) => e.code === "ITERATION_CAP_EXCEEDED"
      );
      expect(errorEvent).toBeDefined();
      expect(errorEvent.violatorCount).toBe(2);
      expect(errorEvent.violators.map((v: { caseName: string }) => v.caseName)).toEqual(
        ["case-A", "case-B"]
      );
      expect(errorEvent.i18nKey).toBe(
        "api.testResults.import.iterationCapExceededMulti"
      );
      expect(routeToIteration).not.toHaveBeenCalled();
    });
  });

  describe("case-ID linking", () => {
    const setSingleCase = (
      testName: string,
      metadata?: Record<string, string>
    ) => {
      (parseTestResults as any).mockResolvedValueOnce({
        result: {
          total: 1,
          passed: 1,
          failed: 0,
          errors: 0,
          skipped: 0,
          duration: 1,
          suites: [
            {
              name: "com.example.TestSuite",
              total: 1,
              passed: 1,
              failed: 0,
              errors: 0,
              skipped: 0,
              duration: 1,
              cases: [
                {
                  name: testName,
                  status: "passed",
                  duration: 1,
                  failure: null,
                  stack_trace: null,
                  attachments: [],
                  ...(metadata ? { metadata } : {}),
                },
              ],
            },
          ],
        },
        errors: [],
      });
    };

    it("links to an existing case by an ID in the name without creating a case", async () => {
      (prisma.repositoryCases.findFirst as any).mockImplementation(
        async (args: any) =>
          args?.where?.id === 123
            ? { id: 123, name: "Curated name", className: null }
            : null
      );
      (prisma.repositoryCases.update as any).mockResolvedValue({
        id: 123,
        name: "Curated name",
        className: null,
      });

      setSingleCase("[123] login works");

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      formData.append("caseMatcher", "name");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      expect(prisma.repositoryCases.findFirst).toHaveBeenCalledWith({
        where: { id: 123, projectId: 1 },
      });
      expect(prisma.repositoryCases.create).not.toHaveBeenCalled();
      expect(prisma.testRunCases.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            testRunId_repositoryCaseId: {
              testRunId: 42,
              repositoryCaseId: 123,
            },
          },
        })
      );
      expect(events.find((e) => e.complete === true)).toBeDefined();
    });

    it("prefers the test_id property over the name in auto mode", async () => {
      (prisma.repositoryCases.findFirst as any).mockImplementation(
        async (args: any) =>
          args?.where?.id === 456
            ? { id: 456, name: "Curated", className: null }
            : null
      );
      (prisma.repositoryCases.update as any).mockResolvedValue({
        id: 456,
        name: "Curated",
        className: null,
      });

      setSingleCase("[123] login works", { test_id: "456" });

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      formData.append("caseMatcher", "auto");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      await readSseResponse(response);

      expect(prisma.repositoryCases.findFirst).toHaveBeenCalledWith({
        where: { id: 456, projectId: 1 },
      });
      expect(prisma.repositoryCases.create).not.toHaveBeenCalled();
    });

    it("warns and skips when the referenced case ID is not in the project", async () => {
      (prisma.repositoryCases.findFirst as any).mockResolvedValue(null);

      setSingleCase("[999] login works");

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      formData.append("caseMatcher", "name");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      expect(prisma.repositoryCases.create).not.toHaveBeenCalled();
      expect(prisma.testRunCases.upsert).not.toHaveBeenCalled();
      const complete = events.find((e) => e.complete === true);
      expect(complete?.caseIdWarnings).toEqual([
        {
          testName: "[999] login works",
          className: "com.example.TestClass",
          requestedCaseId: 999,
        },
      ]);
    });

    it("falls back to name+className matching when matching is off (default)", async () => {
      (prisma.repositoryCases.findFirst as any).mockResolvedValue(null);

      setSingleCase("[123] login works");

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      // no caseMatcher → off

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      await readSseResponse(response);

      expect(prisma.repositoryCases.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: "[123] login works",
            className: "com.example.TestClass",
          }),
        })
      );
      expect(prisma.repositoryCases.create).toHaveBeenCalled();
    });

    it("links one result to every case when multiple IDs are present", async () => {
      (prisma.repositoryCases.findFirst as any).mockImplementation(
        async (args: any) => {
          const id = args?.where?.id;
          return id === 123 || id === 456
            ? { id, name: `Case ${id}`, className: null }
            : null;
        }
      );
      (prisma.repositoryCases.update as any).mockImplementation(
        async (args: any) => ({
          id: args.where.id,
          name: `Case ${args.where.id}`,
          className: null,
        })
      );

      setSingleCase("[123, 456] login works");

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      formData.append("caseMatcher", "name");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      expect(prisma.repositoryCases.findFirst).toHaveBeenCalledWith({
        where: { id: 123, projectId: 1 },
      });
      expect(prisma.repositoryCases.findFirst).toHaveBeenCalledWith({
        where: { id: 456, projectId: 1 },
      });
      expect(prisma.repositoryCases.create).not.toHaveBeenCalled();
      const linkedIds = (prisma.testRunCases.upsert as any).mock.calls.map(
        (c: any[]) => c[0].where.testRunId_repositoryCaseId.repositoryCaseId
      );
      expect(linkedIds).toEqual(expect.arrayContaining([123, 456]));
      // One result row created per matched case.
      expect((prisma.jUnitTestResult.create as any).mock.calls.length).toBe(2);
      expect(events.find((e) => e.complete === true)).toBeDefined();
    });

    it("links the found IDs and warns on the missing ones", async () => {
      (prisma.repositoryCases.findFirst as any).mockImplementation(
        async (args: any) =>
          args?.where?.id === 123
            ? { id: 123, name: "Found", className: null }
            : null
      );
      (prisma.repositoryCases.update as any).mockResolvedValue({
        id: 123,
        name: "Found",
        className: null,
      });

      setSingleCase("[123, 999] login works");

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      formData.append("caseMatcher", "name");

      const request = createFormDataRequest(formData);
      const response = await POST(request);
      const events = await readSseResponse(response);

      expect(prisma.repositoryCases.create).not.toHaveBeenCalled();
      expect(prisma.testRunCases.upsert).toHaveBeenCalledTimes(1);
      const complete = events.find((e) => e.complete === true);
      expect(complete?.caseIdWarnings).toEqual([
        {
          testName: "[123, 999] login works",
          className: "com.example.TestClass",
          requestedCaseId: 999,
        },
      ]);
    });

    it("updates an ID-matched case non-destructively (preserves curated fields)", async () => {
      (prisma.repositoryCases.findFirst as any).mockImplementation(
        async (args: any) =>
          args?.where?.id === 123
            ? { id: 123, name: "Curated", className: "Curated.Class" }
            : null
      );
      (prisma.repositoryCases.update as any).mockResolvedValue({
        id: 123,
        name: "Curated",
        className: "Curated.Class",
      });

      setSingleCase("[123] renamed in code");

      const formData = new FormData();
      formData.append("files", createMockFile("results.xml"));
      formData.append("name", "CI Run");
      formData.append("projectId", "1");
      formData.append("caseMatcher", "name");

      const request = createFormDataRequest(formData);
      await readSseResponse(await POST(request));

      const updateArg = (prisma.repositoryCases.update as any).mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 123 });
      // Only linkability fields are touched; name/class/template/state/estimate
      // are left to the user's curation.
      expect(updateArg.data).toEqual({
        automated: true,
        isDeleted: false,
        isArchived: false,
      });
    });
  });
});
