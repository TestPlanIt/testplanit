import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through the audit wrapper so POST keeps its (request, { params }) shape.
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (h: any) => h,
  enrichFromApiAuth: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/api-token-auth", () => ({
  extractBearerToken: vi.fn(),
  authenticateApiTokenForMethod: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
    templates: { findFirst: vi.fn() },
    repositoryFolders: { findFirst: vi.fn() },
    workflows: { findFirst: vi.fn() },
    repositoryCases: { findFirst: vi.fn() },
    tags: { upsert: vi.fn() },
  },
}));

vi.mock("~/lib/services/jira-panel-generation", () => ({
  loadTemplateData: vi.fn(),
}));

vi.mock("~/lib/services/testCaseImport", () => ({
  persistGeneratedTestCases: vi.fn(),
}));

import { getServerSession } from "next-auth";
import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { loadTemplateData } from "~/lib/services/jira-panel-generation";
import { persistGeneratedTestCases } from "~/lib/services/testCaseImport";
import { POST } from "./route";

const mockSession = {
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    access: "ADMIN",
  },
};

function createRequest(
  body: any,
  projectId = "1",
  headers: Record<string, string> = {}
): [NextRequest, { params: Promise<{ projectId: string }> }] {
  const request = {
    json: async () => body,
    headers: new Headers(headers),
    method: "POST",
  } as unknown as NextRequest;
  return [request, { params: Promise.resolve({ projectId }) }];
}

// Importer mock that echoes each input case as a success result so per-case
// id → result mapping (and grouping) is exercised naturally.
function importerEchoSuccess() {
  (persistGeneratedTestCases as any).mockImplementation(async (input: any) => ({
    status: "success",
    importedCount: input.testCases.length,
    importedIds: input.testCases.map((_: any, i: number) => 1000 + i),
    errors: [],
    results: input.testCases.map((tc: any, i: number) => ({
      id: tc.id,
      name: tc.name,
      status: "success",
      caseId: 1000 + i,
    })),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue(mockSession);
  (extractBearerToken as any).mockReturnValue(null);
  (prisma.projects.findFirst as any).mockResolvedValue({
    id: 1,
    name: "Test Project",
  });
  // Default template resolution (no explicit templateId → default lookup).
  (prisma.templates.findFirst as any).mockResolvedValue({ id: 22 });
  (loadTemplateData as any).mockResolvedValue({
    template: { id: 22, name: "Default", fields: [] },
    fieldMappings: [
      {
        fieldName: "Priority",
        caseFieldId: 1,
        fieldType: "Dropdown",
        fieldOptions: [],
      },
    ],
  });
  (prisma.repositoryFolders.findFirst as any).mockResolvedValue({
    id: 12,
    name: "Root",
    repositoryId: 5,
  });
  (prisma.workflows.findFirst as any).mockResolvedValue({
    id: 3,
    name: "Draft",
  });
  (prisma.repositoryCases.findFirst as any).mockResolvedValue({ order: 4 });
  (prisma.tags.upsert as any).mockImplementation(async ({ where }: any) => ({
    id: where.name === "Regression" ? 50 : 51,
  }));
  importerEchoSuccess();
});

describe("Bulk Create API Route", () => {
  describe("Authentication", () => {
    it("returns 401 when no session and no bearer token", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue(null);

      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [{ name: "A" }],
      });
      const res = await POST(req, ctx);
      expect(res.status).toBe(401);
    });

    it("returns 403 with READ_ONLY_TOKEN code for a read-only token", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue("tpi_readonly");
      (authenticateApiTokenForMethod as any).mockResolvedValue({
        authenticated: false,
        error: "Token is read-only; write operations are not permitted.",
        errorCode: "READ_ONLY_TOKEN",
      });

      const [req, ctx] = createRequest(
        { folderId: 12, cases: [{ name: "A" }] },
        "1",
        { authorization: "Bearer tpi_readonly" }
      );
      const res = await POST(req, ctx);
      const data = await res.json();
      expect(res.status).toBe(403);
      expect(data.code).toBe("READ_ONLY_TOKEN");
    });

    it("authenticates via bearer token and attributes the actor", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue("tpi_valid");
      (authenticateApiTokenForMethod as any).mockResolvedValue({
        authenticated: true,
        userId: "token-user",
        access: "ADMIN",
        scopes: ["client:mcp"],
      });
      (prisma.user.findUnique as any).mockResolvedValue({
        name: "Agent",
        email: "agent@example.com",
      });

      const [req, ctx] = createRequest(
        { folderId: 12, cases: [{ name: "A" }] },
        "1",
        { authorization: "Bearer tpi_valid" }
      );
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);

      expect(enrichFromApiAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "token-user",
          userName: "Agent",
          userEmail: "agent@example.com",
        })
      );
      // The importer is attributed to the token user.
      const author = (persistGeneratedTestCases as any).mock.calls[0][1];
      expect(author).toMatchObject({ userId: "token-user", userName: "Agent" });
    });
  });

  describe("Validation / access", () => {
    it("returns 404 when project not found or access denied", async () => {
      (prisma.projects.findFirst as any).mockResolvedValue(null);

      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [{ name: "A" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();
      expect(res.status).toBe(404);
      expect(data.error).toBe("Project not found or access denied");
    });

    it("returns 400 for an invalid body (no cases)", async () => {
      const [req, ctx] = createRequest({ folderId: 12, cases: [] });
      const res = await POST(req, ctx);
      expect(res.status).toBe(400);
    });

    it("returns 400 when an explicit templateId is not assigned/enabled", async () => {
      (prisma.templates.findFirst as any).mockResolvedValue(null);

      const [req, ctx] = createRequest({
        templateId: 99,
        folderId: 12,
        cases: [{ name: "A" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toContain("Template 99");
    });

    it("returns 422 when no default template is assigned", async () => {
      (prisma.templates.findFirst as any).mockResolvedValue(null);

      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [{ name: "A" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();
      expect(res.status).toBe(422);
      expect(data.error).toContain("No enabled template");
    });
  });

  describe("Happy path", () => {
    it("creates a single-folder/state batch in one importer transaction", async () => {
      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [{ name: "A" }, { name: "B" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.importedCount).toBe(2);
      expect(data.failedCount).toBe(0);
      expect(data.results).toEqual([
        { id: "0", name: "A", status: "success", caseId: 1000 },
        { id: "1", name: "B", status: "success", caseId: 1001 },
      ]);

      // One group → one importer call.
      expect(persistGeneratedTestCases).toHaveBeenCalledTimes(1);
      const importInput = (persistGeneratedTestCases as any).mock.calls[0][0];
      expect(importInput).toMatchObject({
        projectId: 1,
        repositoryId: 5,
        folderId: 12,
        templateId: 22,
        stateId: 3,
        maxOrder: 4,
        source: "MANUAL",
      });
      expect(importInput.testCases.map((c: any) => c.id)).toEqual(["0", "1"]);
    });

    it("maps step text → step and splits tags (names + ids) into numeric tagIds", async () => {
      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [
          {
            name: "A",
            steps: [{ text: "do x", expectedResult: "y" }],
            tags: [4, "Regression"],
          },
        ],
      });
      const res = await POST(req, ctx);
      expect(res.status).toBe(200);

      // "Regression" was upserted to id 50; combined with explicit id 4.
      const importInput = (persistGeneratedTestCases as any).mock.calls[0][0];
      const tc = importInput.testCases[0];
      expect(tc.steps).toEqual([{ step: "do x", expectedResult: "y" }]);
      expect(tc.tagIds).toEqual([4, 50]);
      expect(importInput.autoGenerateTags).toBe(false);
    });

    it("groups cases by (folderId, stateName) — one importer call per group", async () => {
      (prisma.repositoryFolders.findFirst as any).mockImplementation(
        async ({ where }: any) => ({
          id: where.id,
          name: `Folder ${where.id}`,
          repositoryId: 5,
        })
      );

      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [
          { name: "A" }, // → folder 12
          { name: "B", folderId: 77 }, // → folder 77
          { name: "C" }, // → folder 12
        ],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.importedCount).toBe(3);
      // Two distinct folder groups → two importer transactions.
      expect(persistGeneratedTestCases).toHaveBeenCalledTimes(2);
      // Every input case is represented in the results, in input order.
      expect(data.results.map((r: any) => r.name)).toEqual(["A", "B", "C"]);
    });
  });

  describe("Partial failure", () => {
    it("reports a per-case error when the importer marks one case failed", async () => {
      (persistGeneratedTestCases as any).mockImplementation(
        async (input: any) => ({
          status: "success",
          importedCount: 1,
          importedIds: [1000],
          errors: ['Failed to import "B": boom'],
          results: [
            {
              id: input.testCases[0].id,
              name: "A",
              status: "success",
              caseId: 1000,
            },
            {
              id: input.testCases[1].id,
              name: "B",
              status: "error",
              error: "boom",
            },
          ],
        })
      );

      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [{ name: "A" }, { name: "B" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.importedCount).toBe(1);
      expect(data.failedCount).toBe(1);
      expect(data.results[1]).toMatchObject({ status: "error", error: "boom" });
    });

    it("fails the whole group when the importer transaction rolls back", async () => {
      (persistGeneratedTestCases as any).mockResolvedValue({
        status: "error",
        message: "Import failed: deadlock",
        importedCount: 0,
        importedIds: [],
        errors: [],
        results: [],
      });

      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [{ name: "A" }, { name: "B" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.importedCount).toBe(0);
      expect(data.failedCount).toBe(2);
      expect(data.results.every((r: any) => r.status === "error")).toBe(true);
      expect(data.results[0].error).toContain("deadlock");
    });

    it("fails a group whose folder doesn't belong to the project", async () => {
      (prisma.repositoryFolders.findFirst as any).mockResolvedValue(null);

      const [req, ctx] = createRequest({
        folderId: 999,
        cases: [{ name: "A" }],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.importedCount).toBe(0);
      expect(data.results[0]).toMatchObject({ status: "error" });
      expect(data.results[0].error).toContain("Folder 999");
      // No importer call — the group failed pre-import.
      expect(persistGeneratedTestCases).not.toHaveBeenCalled();
    });
  });

  describe("Custom field validation", () => {
    it("rejects a case whose customField isn't on the template (per-case error, not silently dropped)", async () => {
      const [req, ctx] = createRequest({
        folderId: 12,
        cases: [
          { name: "ok", customFields: { Priority: "High" } }, // Priority is on the template
          { name: "bad", customFields: { Phantom: "x" } }, // Phantom is not
        ],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.importedCount).toBe(1);
      expect(data.failedCount).toBe(1);

      const bad = data.results.find((r: any) => r.name === "bad");
      expect(bad.status).toBe("error");
      expect(bad.error).toContain("Phantom");
      expect(bad.error).toContain("template");

      // Only the valid case reached the importer.
      const importInput = (persistGeneratedTestCases as any).mock.calls[0][0];
      expect(importInput.testCases).toHaveLength(1);
      expect(importInput.testCases[0].name).toBe("ok");
    });
  });
});
