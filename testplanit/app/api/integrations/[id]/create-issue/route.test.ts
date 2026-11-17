import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route handler
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    userIntegrationAuth: {
      findFirst: vi.fn(),
    },
    integration: {
      findUnique: vi.fn(),
    },
    repositoryCases: {
      findUnique: vi.fn(),
    },
    testRuns: {
      findUnique: vi.fn(),
    },
    sessions: {
      findUnique: vi.fn(),
    },
    projectAssignment: {
      findUnique: vi.fn(),
    },
    issue: {
      upsert: vi.fn(),
    },
    repositoryCaseIssue: {
      upsert: vi.fn(),
    },
    failureSignatureIssue: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock("@/lib/integrations/editorMediaAttachments", () => ({
  resolveEditorMediaAttachments: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  failureSignatureFindFirst: vi.fn(),
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    failureSignature: { findFirst: mocks.failureSignatureFindFirst },
  })),
}));

vi.mock("~/lib/services/areaPermission", () => ({
  isProjectAdminFor: vi.fn(),
  userHasAreaPermission: vi.fn(),
}));

import { resolveEditorMediaAttachments } from "@/lib/integrations/editorMediaAttachments";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { baseDb } from "@/lib/db";
import { getEnhancedDb } from "~/lib/auth/utils";
import {
  isProjectAdminFor,
  userHasAreaPermission,
} from "~/lib/services/areaPermission";
import { getServerSession } from "next-auth/next";

import { POST } from "./route";

const createRequest = (payload: Record<string, any> = {}): NextRequest => {
  return new NextRequest("http://localhost/api/integrations/1/create-issue", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
};

const params = { params: Promise.resolve({ id: "1" }) };

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@example.com" },
};

const mockAdapter = {
  createIssue: vi.fn(),
  searchUsers: vi.fn(),
};

describe("POST /api/integrations/[id]/create-issue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (IntegrationManager.getInstance as any).mockReturnValue({
      getAdapter: vi.fn().mockResolvedValue(mockAdapter),
    });
    mockAdapter.createIssue.mockResolvedValue({
      id: "ext-123",
      key: "PROJ-1",
      title: "Test Issue",
      url: "https://example.com/issues/PROJ-1",
      status: "Open",
    });
    mockAdapter.searchUsers.mockResolvedValue([]);
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST(
        createRequest({ title: "Test", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user id", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const response = await POST(
        createRequest({ title: "Test", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when title is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest({ projectId: "PROJ" }), params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("returns 400 when projectId is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ title: "Test Issue" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });
  });

  describe("Integration lookup", () => {
    it("returns 404 when integration not found and no user auth", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue(null);

      const response = await POST(
        createRequest({ title: "Test", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 401 when OAuth integration requires user auth", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
      });

      const response = await POST(
        createRequest({ title: "Test", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.authType).toBe("OAUTH2");
    });
  });

  describe("Successful creation with API_KEY integration", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
        provider: "JIRA",
      });
    });

    it("returns created issue data for API_KEY integration", async () => {
      const response = await POST(
        createRequest({ title: "New Issue", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.key).toBe("PROJ-1");
      expect(data.title).toBe("Test Issue");
    });

    it("calls getAdapter without a user id so API key integrations share one adapter", async () => {
      const mockGetAdapter = vi.fn().mockResolvedValue(mockAdapter);
      (IntegrationManager.getInstance as any).mockReturnValue({
        getAdapter: mockGetAdapter,
      });

      await POST(
        createRequest({ title: "New Issue", projectId: "PROJ" }),
        params
      );

      expect(mockGetAdapter).toHaveBeenCalledWith("1", undefined, undefined);
    });
  });

  describe("Successful creation with user auth (OAuth)", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue({
        id: 10,
        userId: "user-1",
        integrationId: 1,
        isActive: true,
        accessToken: "oauth-token",
        integration: {
          id: 1,
          provider: "JIRA",
          authType: "OAUTH2",
          status: "ACTIVE",
        },
      });
    });

    it("creates issue and returns data when user has OAuth auth", async () => {
      const response = await POST(
        createRequest({ title: "OAuth Issue", projectId: "PROJ" }),
        params
      );
      const _data = await response.json();

      expect(response.status).toBe(200);
      expect(mockAdapter.createIssue).toHaveBeenCalledOnce();
    });

    it("passes the linked project's full external ID to the adapter", async () => {
      const response = await POST(
        createRequest({
          title: "GitHub Issue",
          projectId: "testrepo",
          externalProjectId: "testowner/testrepo",
        }),
        params
      );

      expect(response.status).toBe(200);
      expect(mockAdapter.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "testrepo",
          externalProjectId: "testowner/testrepo",
        })
      );
    });

    it("passes the requesting user id to getAdapter so the issue is reported as that user", async () => {
      const mockGetAdapter = vi.fn().mockResolvedValue(mockAdapter);
      (IntegrationManager.getInstance as any).mockReturnValue({
        getAdapter: mockGetAdapter,
      });

      await POST(
        createRequest({ title: "OAuth Issue", projectId: "PROJ" }),
        params
      );

      expect(mockGetAdapter).toHaveBeenCalledWith("1", undefined, "user-1");
    });
  });

  describe("Embedded description media", () => {
    const descriptionDoc = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "/api/storage/uploads/document-images/1/shot.png" },
        },
      ],
    };

    const attachmentAdapter: any = {
      createIssue: vi.fn(),
      uploadAttachment: vi.fn(),
      getCapabilities: vi.fn(),
    };

    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
        provider: "JIRA",
      });
      (IntegrationManager.getInstance as any).mockReturnValue({
        getAdapter: vi.fn().mockResolvedValue(attachmentAdapter),
      });
      attachmentAdapter.createIssue.mockResolvedValue({
        id: "ext-123",
        key: "PROJ-1",
        title: "Test Issue",
        url: "https://example.com/issues/PROJ-1",
        status: "Open",
      });
      attachmentAdapter.uploadAttachment.mockResolvedValue({
        id: "att-1",
        url: "https://example.com/attachments/att-1",
      });
      attachmentAdapter.getCapabilities.mockReturnValue({ attachments: true });
      (resolveEditorMediaAttachments as any).mockResolvedValue([]);
    });

    it("uploads media resolved from the description to the created issue", async () => {
      (resolveEditorMediaAttachments as any).mockResolvedValue([
        { filename: "shot.png", buffer: Buffer.from("png-bytes") },
      ]);

      const response = await POST(
        createRequest({
          title: "With image",
          projectId: "PROJ",
          description: descriptionDoc,
        }),
        params
      );

      expect(response.status).toBe(200);
      expect(resolveEditorMediaAttachments).toHaveBeenCalledWith(
        descriptionDoc
      );
      expect(attachmentAdapter.uploadAttachment).toHaveBeenCalledWith(
        "PROJ-1",
        expect.any(Buffer),
        "shot.png"
      );
    });

    it("an attachment upload failure does not fail issue creation", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      (resolveEditorMediaAttachments as any).mockResolvedValue([
        { filename: "a.png", buffer: Buffer.from("a") },
        { filename: "b.png", buffer: Buffer.from("b") },
      ]);
      attachmentAdapter.uploadAttachment.mockRejectedValueOnce(
        new Error("HTTP 413: attachment too large")
      );

      const response = await POST(
        createRequest({
          title: "With images",
          projectId: "PROJ",
          description: descriptionDoc,
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.key).toBe("PROJ-1");
      expect(attachmentAdapter.uploadAttachment).toHaveBeenCalledTimes(2);
      consoleError.mockRestore();
    });

    it("skips media transfer when the adapter does not support attachments", async () => {
      attachmentAdapter.getCapabilities.mockReturnValue({
        attachments: false,
      });

      const response = await POST(
        createRequest({
          title: "No attachments",
          projectId: "PROJ",
          description: descriptionDoc,
        }),
        params
      );

      expect(response.status).toBe(200);
      expect(resolveEditorMediaAttachments).not.toHaveBeenCalled();
      expect(attachmentAdapter.uploadAttachment).not.toHaveBeenCalled();
    });
  });

  describe("Linking to entities", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue({
        id: 42,
        projectId: 100,
      });
      (baseDb.projectAssignment.findUnique as any).mockResolvedValue({
        userId: "user-1",
        projectId: 100,
      });
      (baseDb.issue.upsert as any).mockResolvedValue({
        id: 99,
        externalId: "PROJ-1",
        integrationId: 1,
      });
    });

    it("stores issue in DB when testCaseId provided", async () => {
      const response = await POST(
        createRequest({
          title: "Linked Issue",
          projectId: "PROJ",
          testCaseId: "42",
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(baseDb.issue.upsert).toHaveBeenCalledOnce();
      expect(data.internalId).toBe(99);
      // The test case is linked via the explicit RepositoryCaseIssue join
      // (Issue has no `repositoryCases` relation in v3), idempotently.
      expect(baseDb.repositoryCaseIssue.upsert).toHaveBeenCalledWith({
        where: { caseId_issueId: { caseId: 42, issueId: 99 } },
        create: { caseId: 42, issueId: 99 },
        update: {},
      });
    });

    it("persists tracker columns (key in name, externalKey/Url/Status, issue type) so it renders like a synced issue", async () => {
      mockAdapter.createIssue.mockResolvedValue({
        id: "ext-123",
        key: "PROJ-7",
        title: "Render Me",
        description: "<p>body</p>",
        status: "To Do",
        priority: "High",
        url: "https://example.com/browse/PROJ-7",
        issueType: {
          id: "10001",
          name: "Bug",
          iconUrl: "https://example.com/bug.png",
        },
        labels: ["x"],
      });

      const response = await POST(
        createRequest({
          title: "Render Me",
          projectId: "PROJ",
          testCaseId: "42",
        }),
        params
      );
      expect(response.status).toBe(200);

      const upsertArg = (baseDb.issue.upsert as any).mock.calls[0][0];
      // Regression: the issue key — not the title — must land in `name`, and the
      // first-class columns the UI reads must be populated (were empty before).
      expect(upsertArg.create.name).toBe("PROJ-7");
      expect(upsertArg.create.externalKey).toBe("PROJ-7");
      expect(upsertArg.create.externalUrl).toBe(
        "https://example.com/browse/PROJ-7"
      );
      expect(upsertArg.create.externalStatus).toBe("To Do");
      expect(upsertArg.create.status).toBe("To Do");
      expect(upsertArg.create.issueTypeId).toBe("10001");
      expect(upsertArg.create.issueTypeName).toBe("Bug");
      expect(upsertArg.create.issueTypeIconUrl).toBe(
        "https://example.com/bug.png"
      );
      // The update branch refreshes the same columns.
      expect(upsertArg.update.name).toBe("PROJ-7");
      expect(upsertArg.update.externalKey).toBe("PROJ-7");
    });
  });

  describe("Linking to a failure pattern", () => {
    const patternProjectId = 12;
    const linkWrite = {
      where: { signatureId_issueId: { signatureId: 7, issueId: 99 } },
      create: { signatureId: 7, issueId: 99 },
      update: {},
    };

    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      mocks.failureSignatureFindFirst.mockResolvedValue({
        projectId: patternProjectId,
      });
      (isProjectAdminFor as any).mockResolvedValue(false);
      (userHasAreaPermission as any).mockResolvedValue(false);
      (baseDb.issue.upsert as any).mockResolvedValue({
        id: 99,
        externalId: "PROJ-1",
        integrationId: 1,
      });
      (baseDb.failureSignatureIssue.upsert as any).mockResolvedValue({
        signatureId: 7,
        issueId: 99,
      });
    });

    const expectNothingCreated = () => {
      expect(mockAdapter.createIssue).not.toHaveBeenCalled();
      expect(baseDb.issue.upsert).not.toHaveBeenCalled();
      expect(baseDb.failureSignatureIssue.upsert).not.toHaveBeenCalled();
    };

    it.each(["abc", "2.5"])(
      "returns 400 when failureSignatureId is not an integer (%s)",
      async (failureSignatureId) => {
        const response = await POST(
          createRequest({
            title: "Pattern Issue",
            projectId: "PROJ",
            failureSignatureId,
          }),
          params
        );
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Invalid failure pattern id");
        expectNothingCreated();
      }
    );

    it("returns 404 when the pattern is not found or not visible to the user", async () => {
      mocks.failureSignatureFindFirst.mockResolvedValue(null);

      const response = await POST(
        createRequest({
          title: "Pattern Issue",
          projectId: "PROJ",
          failureSignatureId: "7",
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Failure pattern not found");
      expect(getEnhancedDb).toHaveBeenCalledWith(mockSession);
      expect(mocks.failureSignatureFindFirst).toHaveBeenCalledWith({
        where: { id: 7 },
        select: { projectId: true },
      });
      expectNothingCreated();
    });

    it("returns 400 when testplanitProjectId differs from the pattern's project", async () => {
      (isProjectAdminFor as any).mockResolvedValue(true);

      const response = await POST(
        createRequest({
          title: "Pattern Issue",
          projectId: "PROJ",
          testplanitProjectId: patternProjectId + 1,
          failureSignatureId: "7",
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        "The failure pattern belongs to a different project"
      );
      expectNothingCreated();
    });

    it("returns 403 when the user is neither project admin nor holds the FailurePatterns add/edit grant", async () => {
      const response = await POST(
        createRequest({
          title: "Pattern Issue",
          projectId: "PROJ",
          testplanitProjectId: patternProjectId,
          failureSignatureId: "7",
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe(
        "You do not have permission to link issues to this failure pattern"
      );
      expect(isProjectAdminFor).toHaveBeenCalledWith(
        "user-1",
        patternProjectId
      );
      expect(userHasAreaPermission).toHaveBeenCalledWith(
        "user-1",
        patternProjectId,
        "FailurePatterns",
        "canAddEdit"
      );
      expectNothingCreated();
    });

    it("links the created issue to the pattern for a project admin", async () => {
      (isProjectAdminFor as any).mockResolvedValue(true);

      const response = await POST(
        createRequest({
          title: "Pattern Issue",
          projectId: "PROJ",
          testplanitProjectId: patternProjectId,
          failureSignatureId: "7",
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.internalId).toBe(99);
      expect(mockAdapter.createIssue).toHaveBeenCalledOnce();
      expect(baseDb.issue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ projectId: patternProjectId }),
        })
      );
      expect(baseDb.failureSignatureIssue.upsert).toHaveBeenCalledWith(
        linkWrite
      );
    });

    it("links the created issue to the pattern for a user with the FailurePatterns grant", async () => {
      (userHasAreaPermission as any).mockResolvedValue(true);

      const response = await POST(
        createRequest({
          title: "Pattern Issue",
          projectId: "PROJ",
          testplanitProjectId: patternProjectId,
          failureSignatureId: "7",
        }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.internalId).toBe(99);
      expect(userHasAreaPermission).toHaveBeenCalledWith(
        "user-1",
        patternProjectId,
        "FailurePatterns",
        "canAddEdit"
      );
      expect(mockAdapter.createIssue).toHaveBeenCalledOnce();
      expect(baseDb.failureSignatureIssue.upsert).toHaveBeenCalledWith(
        linkWrite
      );
    });

    it("creates the Issue under the pattern's project when testplanitProjectId is omitted", async () => {
      (isProjectAdminFor as any).mockResolvedValue(true);

      const response = await POST(
        createRequest({
          title: "Pattern Issue",
          projectId: "PROJ",
          failureSignatureId: "7",
        }),
        params
      );

      expect(response.status).toBe(200);
      const upsertArg = (baseDb.issue.upsert as any).mock.calls[0][0];
      expect(upsertArg.create.projectId).toBe(patternProjectId);
      expect(baseDb.failureSignatureIssue.upsert).toHaveBeenCalledWith(
        linkWrite
      );
    });
  });

  describe("Error handling", () => {
    it("returns 500 when adapter createIssue throws", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      mockAdapter.createIssue.mockRejectedValue(
        new Error("External service error")
      );

      const response = await POST(
        createRequest({ title: "Failing Issue", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to create issue");
    });

    it("returns 500 when adapter cannot be initialized", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (baseDb.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      (IntegrationManager.getInstance as any).mockReturnValue({
        getAdapter: vi.fn().mockResolvedValue(null),
      });

      const response = await POST(
        createRequest({ title: "No Adapter Issue", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("adapter");
    });
  });
});
