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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflows: {
      findFirst: vi.fn(),
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
    },
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditBulkCreate: vi.fn().mockResolvedValue(undefined),
}));

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

  const createMockFile = (name: string, content: string = "<testsuite></testsuite>"): File => {
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
    (prisma.repositoryCases.create as any).mockResolvedValue(mockRepositoryCase);
    (prisma.repositoryCases.update as any).mockResolvedValue(mockRepositoryCase);
    (prisma.testRunCases.upsert as any).mockResolvedValue(mockTestRunCase);
    (prisma.testRunCases.findFirst as any).mockResolvedValue(mockTestRunCase);
    (prisma.testRunCases.update as any).mockResolvedValue(mockTestRunCase);
    (prisma.jUnitTestSuite.create as any).mockResolvedValue(mockSuite);
    (prisma.jUnitTestResult.create as any).mockResolvedValue({ id: 400 });
    (prisma.status.findFirst as any).mockResolvedValue(mockStatus);

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
});
