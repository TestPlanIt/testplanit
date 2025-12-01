import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma using vi.hoisted
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    integration: { findFirst: vi.fn() },
    repositoryCases: { findUnique: vi.fn(), update: vi.fn() },
    testRuns: { findUnique: vi.fn(), update: vi.fn() },
    sessions: { findUnique: vi.fn(), update: vi.fn() },
    testRunResults: { findUnique: vi.fn(), update: vi.fn() },
    sessionResults: { findUnique: vi.fn(), update: vi.fn() },
    testRunStepResults: { findUnique: vi.fn(), update: vi.fn() },
    issue: { upsert: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@prisma/client", () => ({
  IntegrationProvider: {
    JIRA: "JIRA",
    GITHUB: "GITHUB",
  },
}));

import { JiraLinkService } from "./jira-link-service";

describe("JiraLinkService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockIntegration = { id: 1, provider: "JIRA", status: "ACTIVE" };

  describe("linkTestCaseToJiraIssue", () => {
    const mockTestCase = {
      id: 1,
      creatorId: "user-123",
      projectId: 10,
      issues: [],
    };

    it("should throw error when integration is invalid", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestCaseToJiraIssue(1, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Invalid or inactive issue tracking integration");
    });

    it("should throw error when test case not found", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.repositoryCases.findUnique.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestCaseToJiraIssue(999, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Test case not found");
    });

    it("should upsert issue and link to test case", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.repositoryCases.findUnique.mockResolvedValue(mockTestCase);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.repositoryCases.update.mockResolvedValue({});

      await JiraLinkService.linkTestCaseToJiraIssue(
        1,
        "TEST-123",
        "jira-id-123",
        1,
        "Issue Title",
        "https://jira.example.com/TEST-123"
      );

      expect(mockPrisma.issue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            externalId_integrationId: {
              externalId: "jira-id-123",
              integrationId: 1,
            },
          },
          create: expect.objectContaining({
            name: "TEST-123",
            title: "Issue Title",
            externalId: "jira-id-123",
            externalKey: "TEST-123",
            externalUrl: "https://jira.example.com/TEST-123",
            integrationId: 1,
            createdById: "user-123",
            projectId: 10,
          }),
        })
      );

      expect(mockPrisma.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { connect: { id: 100 } } },
      });
    });

    it("should use jiraIssueKey as title when issueTitle not provided", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.repositoryCases.findUnique.mockResolvedValue(mockTestCase);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.repositoryCases.update.mockResolvedValue({});

      await JiraLinkService.linkTestCaseToJiraIssue(1, "TEST-123", "jira-id-123", 1);

      expect(mockPrisma.issue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            title: "TEST-123",
          }),
        })
      );
    });
  });

  describe("linkTestRunToJiraIssue", () => {
    const mockTestRun = {
      id: 1,
      createdById: "user-123",
      projectId: 10,
      issues: [],
    };

    it("should throw error when integration is invalid", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestRunToJiraIssue(1, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Invalid or inactive issue tracking integration");
    });

    it("should throw error when test run not found", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.testRuns.findUnique.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestRunToJiraIssue(999, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Test run not found");
    });

    it("should upsert issue and link to test run", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.testRuns.findUnique.mockResolvedValue(mockTestRun);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.testRuns.update.mockResolvedValue({});

      await JiraLinkService.linkTestRunToJiraIssue(1, "TEST-123", "jira-id-123", 1);

      expect(mockPrisma.testRuns.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { connect: { id: 100 } } },
      });
    });
  });

  describe("linkSessionToJiraIssue", () => {
    const mockSession = {
      id: 1,
      createdById: "user-123",
      projectId: 10,
      issues: [],
    };

    it("should throw error when integration is invalid", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkSessionToJiraIssue(1, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Invalid or inactive issue tracking integration");
    });

    it("should throw error when session not found", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.sessions.findUnique.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkSessionToJiraIssue(999, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Session not found");
    });

    it("should upsert issue and link to session", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.sessions.findUnique.mockResolvedValue(mockSession);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.sessions.update.mockResolvedValue({});

      await JiraLinkService.linkSessionToJiraIssue(1, "TEST-123", "jira-id-123", 1);

      expect(mockPrisma.sessions.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { connect: { id: 100 } } },
      });
    });
  });

  describe("getLinkedJiraIssuesForTestRun", () => {
    it("should return empty array when test run not found", async () => {
      mockPrisma.testRuns.findUnique.mockResolvedValue(null);

      const result = await JiraLinkService.getLinkedJiraIssuesForTestRun(999);

      expect(result).toEqual([]);
    });

    it("should return mapped issues", async () => {
      mockPrisma.testRuns.findUnique.mockResolvedValue({
        id: 1,
        issues: [
          {
            id: 100,
            name: "TEST-123",
            title: "Test Issue",
            externalId: "jira-id-123",
            data: { key: "TEST-123" },
            externalUrl: "https://jira.example.com/TEST-123",
            externalStatus: "Open",
            integration: { id: 1, name: "Jira", provider: "JIRA" },
          },
        ],
      });

      const result = await JiraLinkService.getLinkedJiraIssuesForTestRun(1);

      expect(result).toEqual([
        {
          id: 100,
          key: "TEST-123",
          title: "Test Issue",
          summary: "Test Issue",
          externalId: "jira-id-123",
          data: { key: "TEST-123" },
          url: "https://jira.example.com/TEST-123",
          status: "Open",
          integration: { id: 1, name: "Jira", provider: "JIRA" },
        },
      ]);
    });
  });

  describe("getLinkedJiraIssuesForSession", () => {
    it("should return empty array when session not found", async () => {
      mockPrisma.sessions.findUnique.mockResolvedValue(null);

      const result = await JiraLinkService.getLinkedJiraIssuesForSession(999);

      expect(result).toEqual([]);
    });

    it("should return empty array on error", async () => {
      mockPrisma.sessions.findUnique.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await JiraLinkService.getLinkedJiraIssuesForSession(1);

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("getLinkedJiraIssues (for test case)", () => {
    it("should return mapped issues for test case", async () => {
      mockPrisma.issue.findMany.mockResolvedValue([
        {
          id: 100,
          name: "TEST-123",
          title: "Test Issue",
          externalId: "jira-id-123",
          data: {},
          externalUrl: "https://jira.example.com/TEST-123",
          externalStatus: "Done",
          integration: { id: 1, name: "Jira", provider: "JIRA" },
        },
      ]);

      const result = await JiraLinkService.getLinkedJiraIssues(1);

      expect(result[0].key).toBe("TEST-123");
      expect(result[0].status).toBe("Done");
    });
  });

  describe("unlinkTestCaseFromJiraIssue", () => {
    it("should throw error when issue not found", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.unlinkTestCaseFromJiraIssue(1, "jira-id-123")
      ).rejects.toThrow("Issue not found");
    });

    it("should disconnect issue from test case", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.repositoryCases.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [{ id: 2 }], // Still has other links
        testRuns: [],
        sessions: [],
        testRunResults: [],
        sessionResults: [],
        testRunStepResults: [],
      });

      await JiraLinkService.unlinkTestCaseFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { disconnect: { id: 100 } } },
      });
      expect(mockPrisma.issue.delete).not.toHaveBeenCalled();
    });

    it("should delete issue when no remaining links", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.repositoryCases.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [],
        testRuns: [],
        sessions: [],
        testRunResults: [],
        sessionResults: [],
        testRunStepResults: [],
      });
      mockPrisma.issue.delete.mockResolvedValue({});

      await JiraLinkService.unlinkTestCaseFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.issue.delete).toHaveBeenCalledWith({
        where: { id: 100 },
      });
    });
  });

  describe("unlinkTestRunFromJiraIssue", () => {
    it("should throw error when issue not found", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.unlinkTestRunFromJiraIssue(1, "jira-id-123")
      ).rejects.toThrow("Issue not found");
    });

    it("should disconnect issue from test run", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.testRuns.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [],
        testRuns: [{ id: 2 }], // Still has other links
        sessions: [],
        testRunResults: [],
        sessionResults: [],
        testRunStepResults: [],
      });

      await JiraLinkService.unlinkTestRunFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.testRuns.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { disconnect: { id: 100 } } },
      });
    });
  });

  describe("unlinkSessionFromJiraIssue", () => {
    it("should throw error when issue not found", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.unlinkSessionFromJiraIssue(1, "jira-id-123")
      ).rejects.toThrow("Issue not found");
    });

    it("should disconnect issue from session", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.sessions.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [],
        testRuns: [],
        sessions: [{ id: 2 }], // Still has other links
        testRunResults: [],
        sessionResults: [],
        testRunStepResults: [],
      });

      await JiraLinkService.unlinkSessionFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.sessions.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { disconnect: { id: 100 } } },
      });
    });
  });

  describe("linkTestRunResultToJiraIssue", () => {
    const mockTestRunResult = {
      id: 1,
      issues: [],
      testRunCase: {
        testRun: {
          projectId: 10,
          createdById: "user-123",
        },
      },
    };

    it("should throw error when integration is invalid", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestRunResultToJiraIssue(1, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Invalid or inactive issue tracking integration");
    });

    it("should throw error when test run result not found", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.testRunResults.findUnique.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestRunResultToJiraIssue(999, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Test run result not found");
    });

    it("should link issue to test run result", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.testRunResults.findUnique.mockResolvedValue(mockTestRunResult);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.testRunResults.update.mockResolvedValue({});

      await JiraLinkService.linkTestRunResultToJiraIssue(1, "TEST-123", "jira-id-123", 1);

      expect(mockPrisma.testRunResults.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { connect: { id: 100 } } },
      });
    });
  });

  describe("linkSessionResultToJiraIssue", () => {
    const mockSessionResult = {
      id: 1,
      createdById: "user-123",
      issues: [],
      session: {
        projectId: 10,
      },
    };

    it("should throw error when session result not found", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.sessionResults.findUnique.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkSessionResultToJiraIssue(999, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Session result not found");
    });

    it("should link issue to session result", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.sessionResults.findUnique.mockResolvedValue(mockSessionResult);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.sessionResults.update.mockResolvedValue({});

      await JiraLinkService.linkSessionResultToJiraIssue(1, "TEST-123", "jira-id-123", 1);

      expect(mockPrisma.sessionResults.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { connect: { id: 100 } } },
      });
    });
  });

  describe("unlinkTestRunResultFromJiraIssue", () => {
    it("should throw error when issue not found", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.unlinkTestRunResultFromJiraIssue(1, "jira-id-123")
      ).rejects.toThrow("Issue not found");
    });

    it("should disconnect issue from test run result", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.testRunResults.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [],
        testRuns: [],
        sessions: [],
        testRunResults: [{ id: 2 }],
        sessionResults: [],
      });

      await JiraLinkService.unlinkTestRunResultFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.testRunResults.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { disconnect: { id: 100 } } },
      });
    });
  });

  describe("unlinkSessionResultFromJiraIssue", () => {
    it("should throw error when issue not found", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.unlinkSessionResultFromJiraIssue(1, "jira-id-123")
      ).rejects.toThrow("Issue not found");
    });

    it("should disconnect issue from session result", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.sessionResults.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [],
        testRuns: [],
        sessions: [],
        testRunResults: [],
        sessionResults: [{ id: 2 }],
      });

      await JiraLinkService.unlinkSessionResultFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.sessionResults.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { disconnect: { id: 100 } } },
      });
    });
  });

  describe("linkTestRunStepResultToJiraIssue", () => {
    const mockTestRunStepResult = {
      id: 1,
      issues: [],
      testRunResult: {
        executedById: "user-123",
        testRunCase: {
          testRun: {
            projectId: 10,
          },
        },
      },
    };

    it("should throw error when test run step result not found", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.testRunStepResults.findUnique.mockResolvedValue(null);

      await expect(
        JiraLinkService.linkTestRunStepResultToJiraIssue(999, "TEST-123", "jira-id-123", 1)
      ).rejects.toThrow("Test run step result not found");
    });

    it("should link issue to test run step result", async () => {
      mockPrisma.integration.findFirst.mockResolvedValue(mockIntegration);
      mockPrisma.testRunStepResults.findUnique.mockResolvedValue(mockTestRunStepResult);
      mockPrisma.issue.upsert.mockResolvedValue({ id: 100 });
      mockPrisma.testRunStepResults.update.mockResolvedValue({});

      await JiraLinkService.linkTestRunStepResultToJiraIssue(1, "TEST-123", "jira-id-123", 1);

      expect(mockPrisma.testRunStepResults.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { issues: { connect: { id: 100 } } },
      });
    });
  });

  describe("unlinkTestRunStepResultFromJiraIssue", () => {
    it("should throw error when issue not found", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue(null);

      await expect(
        JiraLinkService.unlinkTestRunStepResultFromJiraIssue(1, "jira-id-123")
      ).rejects.toThrow("Issue not found");
    });

    it("should delete orphaned issue", async () => {
      mockPrisma.issue.findFirst.mockResolvedValue({ id: 100 });
      mockPrisma.testRunStepResults.update.mockResolvedValue({});
      mockPrisma.issue.findUnique.mockResolvedValue({
        id: 100,
        repositoryCases: [],
        testRuns: [],
        sessions: [],
        testRunResults: [],
        sessionResults: [],
        testRunStepResults: [],
      });
      mockPrisma.issue.delete.mockResolvedValue({});

      await JiraLinkService.unlinkTestRunStepResultFromJiraIssue(1, "jira-id-123");

      expect(mockPrisma.issue.delete).toHaveBeenCalledWith({
        where: { id: 100 },
      });
    });
  });

  describe("getLinkedJiraIssuesForTestRunResult", () => {
    it("should return empty array when result not found", async () => {
      mockPrisma.testRunResults.findUnique.mockResolvedValue(null);

      const result = await JiraLinkService.getLinkedJiraIssuesForTestRunResult(999);

      expect(result).toEqual([]);
    });

    it("should return empty array on error", async () => {
      mockPrisma.testRunResults.findUnique.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await JiraLinkService.getLinkedJiraIssuesForTestRunResult(1);

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("getLinkedJiraIssuesForSessionResult", () => {
    it("should return empty array when result not found", async () => {
      mockPrisma.sessionResults.findUnique.mockResolvedValue(null);

      const result = await JiraLinkService.getLinkedJiraIssuesForSessionResult(999);

      expect(result).toEqual([]);
    });
  });

  describe("getLinkedJiraIssuesForTestRunStepResult", () => {
    it("should return empty array when result not found", async () => {
      mockPrisma.testRunStepResults.findUnique.mockResolvedValue(null);

      const result = await JiraLinkService.getLinkedJiraIssuesForTestRunStepResult(999);

      expect(result).toEqual([]);
    });

    it("should return empty array on error", async () => {
      mockPrisma.testRunStepResults.findUnique.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await JiraLinkService.getLinkedJiraIssuesForTestRunStepResult(1);

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("syncJiraIssueData", () => {
    it("should update issue data with lastSynced timestamp", async () => {
      mockPrisma.issue.updateMany.mockResolvedValue({ count: 1 });

      await JiraLinkService.syncJiraIssueData("jira-id-123", {
        status: "Done",
        priority: "High",
      });

      expect(mockPrisma.issue.updateMany).toHaveBeenCalledWith({
        where: {
          externalId: "jira-id-123",
          integration: {
            provider: { in: ["JIRA", "GITHUB"] },
          },
        },
        data: {
          data: expect.objectContaining({
            status: "Done",
            priority: "High",
            lastSynced: expect.any(String),
          }),
        },
      });
    });

    it("should throw error on database failure", async () => {
      mockPrisma.issue.updateMany.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        JiraLinkService.syncJiraIssueData("jira-id-123", {})
      ).rejects.toThrow("DB error");

      consoleSpy.mockRestore();
    });
  });
});
