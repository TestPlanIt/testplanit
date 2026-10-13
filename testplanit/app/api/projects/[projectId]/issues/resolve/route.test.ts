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

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
  },
}));

// Declared inside the factory: vi.mock is hoisted above any top-level binding
// this file could otherwise close over.
vi.mock("~/lib/services/resolveIssueKeys", () => ({
  resolveIssueKeys: vi.fn(),
  IssueKeyResolutionError: class extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { getServerSession } from "next-auth";
import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import {
  IssueKeyResolutionError,
  resolveIssueKeys,
} from "~/lib/services/resolveIssueKeys";
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

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue(mockSession);
  (extractBearerToken as any).mockReturnValue(null);
  (baseDb.projects.findFirst as any).mockResolvedValue({
    id: 1,
    name: "Test Project",
  });
  (resolveIssueKeys as any).mockResolvedValue(new Map());
});

describe("Issue key resolve API Route", () => {
  describe("Authentication", () => {
    it("returns 401 when no session and no bearer token", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue(null);

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      // Nothing reached the tracker.
      expect(resolveIssueKeys).not.toHaveBeenCalled();
    });

    it("returns 403 with READ_ONLY_TOKEN code for a read-only token", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue("tpi_readonly");
      (authenticateApiTokenForMethod as any).mockResolvedValue({
        authenticated: false,
        error: "Token is read-only; write operations are not permitted.",
        errorCode: "READ_ONLY_TOKEN",
      });

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] }, "1", {
        authorization: "Bearer tpi_readonly",
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe("READ_ONLY_TOKEN");
      // Resolving creates rows, so a read-only token never gets that far.
      expect(resolveIssueKeys).not.toHaveBeenCalled();
    });

    it("resolves for a valid bearer token", async () => {
      (getServerSession as any).mockResolvedValue(null);
      (extractBearerToken as any).mockReturnValue("tpi_valid");
      (authenticateApiTokenForMethod as any).mockResolvedValue({
        authenticated: true,
        userId: "token-user",
        access: "ADMIN",
        scopes: ["client:mcp"],
      });
      (baseDb.user.findUnique as any).mockResolvedValue({
        name: "Agent",
        email: "agent@example.com",
      });
      (resolveIssueKeys as any).mockResolvedValue(
        new Map([["PROJ-1", { key: "PROJ-1", issueId: 900 }]])
      );

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] }, "1", {
        authorization: "Bearer tpi_valid",
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toMatchObject({ success: true, resolvedCount: 1 });
    });
  });

  describe("Project access", () => {
    it("returns 404 when the project is unknown or not accessible", async () => {
      (baseDb.projects.findFirst as any).mockResolvedValue(null);

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] }, "4242");
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error).toBe("Project not found or access denied");
      expect(resolveIssueKeys).not.toHaveBeenCalled();
    });

    it("returns 400 for a non-numeric project id", async () => {
      const [req, ctx] = createRequest({ keys: ["PROJ-1"] }, "not-a-number");
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid project ID");
    });
  });

  describe("Request validation", () => {
    it("returns 400 when the batch exceeds 100 keys", async () => {
      const keys = Array.from({ length: 101 }, (_, i) => `PROJ-${i}`);

      const [req, ctx] = createRequest({ keys });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
      expect(Array.isArray(data.details)).toBe(true);
      // Rejected before any upstream traffic.
      expect(resolveIssueKeys).not.toHaveBeenCalled();
    });

    it("accepts a batch of exactly 100 keys", async () => {
      const keys = Array.from({ length: 100 }, (_, i) => `PROJ-${i}`);

      const [req, ctx] = createRequest({ keys });
      const res = await POST(req, ctx);

      expect(res.status).toBe(200);
      expect((resolveIssueKeys as any).mock.calls[0][0].keys).toHaveLength(100);
    });

    it("returns 400 for a key longer than 255 characters", async () => {
      const [req, ctx] = createRequest({ keys: ["A".repeat(256)] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
      expect(resolveIssueKeys).not.toHaveBeenCalled();
    });

    it("returns 400 for an empty keys array", async () => {
      const [req, ctx] = createRequest({ keys: [] });
      const res = await POST(req, ctx);

      expect(res.status).toBe(400);
      expect(resolveIssueKeys).not.toHaveBeenCalled();
    });
  });

  describe("Resolution", () => {
    it("echoes results index-for-index when the caller repeats a key", async () => {
      (resolveIssueKeys as any).mockResolvedValue(
        new Map([
          ["PROJ-1", { key: "PROJ-1", issueId: 900, created: true }],
          ["PROJ-2", { key: "PROJ-2", issueId: 901 }],
        ])
      );

      const [req, ctx] = createRequest({
        keys: ["PROJ-1", "PROJ-2", "PROJ-1"],
      });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      // One entry per requested key, in request order — the repeat included.
      expect(data.results).toEqual([
        { key: "PROJ-1", issueId: 900, created: true },
        { key: "PROJ-2", issueId: 901 },
        { key: "PROJ-1", issueId: 900, created: true },
      ]);
      expect(data.resolvedCount).toBe(3);
      expect(data.failedCount).toBe(0);
      expect(data.createdCount).toBe(2);

      // Deduplication is the service's job; the route forwards verbatim.
      expect(resolveIssueKeys).toHaveBeenCalledTimes(1);
      expect((resolveIssueKeys as any).mock.calls[0][0]).toMatchObject({
        projectId: 1,
        keys: ["PROJ-1", "PROJ-2", "PROJ-1"],
      });
    });

    it("reports a per-key failure without failing the batch", async () => {
      (resolveIssueKeys as any).mockResolvedValue(
        new Map([
          ["PROJ-1", { key: "PROJ-1", issueId: 900 }],
          ["TYPO-9", { key: "TYPO-9", error: "Issue does not exist" }],
        ])
      );

      const [req, ctx] = createRequest({ keys: ["PROJ-1", "TYPO-9"] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.resolvedCount).toBe(1);
      expect(data.failedCount).toBe(1);
      expect(data.results[1]).toMatchObject({
        key: "TYPO-9",
        error: "Issue does not exist",
      });
    });

    it("counts a key the resolver omitted as failed rather than dropping it", async () => {
      (resolveIssueKeys as any).mockResolvedValue(new Map());

      const [req, ctx] = createRequest({ keys: ["GHOST-1"] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.results).toHaveLength(1);
      expect(data.results[0].key).toBe("GHOST-1");
      expect(data.results[0].issueId).toBeUndefined();
      expect(data.results[0].error).toBeTruthy();
      expect(data.failedCount).toBe(1);
    });

    it("forwards integrationId when the caller disambiguates", async () => {
      const [req, ctx] = createRequest({
        keys: ["PROJ-1"],
        integrationId: 9,
      });
      await POST(req, ctx);

      expect((resolveIssueKeys as any).mock.calls[0][0].integrationId).toBe(9);
    });

    it("omits integrationId when the caller doesn't supply one", async () => {
      const [req, ctx] = createRequest({ keys: ["PROJ-1"] });
      await POST(req, ctx);

      expect(
        (resolveIssueKeys as any).mock.calls[0][0].integrationId
      ).toBeUndefined();
    });
  });

  describe("Error handling", () => {
    it("maps IssueKeyResolutionError to its own status and message", async () => {
      (resolveIssueKeys as any).mockRejectedValue(
        new IssueKeyResolutionError(
          "Project has more than one active issue-tracker integration.",
          409
        )
      );

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe(
        "Project has more than one active issue-tracker integration."
      );
    });

    it("maps an IssueKeyResolutionError 400 (no integration configured)", async () => {
      (resolveIssueKeys as any).mockRejectedValue(
        new IssueKeyResolutionError("No issue tracker configured.", 400)
      );

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("No issue tracker configured.");
    });

    it("returns 500 for an unexpected failure", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      (resolveIssueKeys as any).mockRejectedValue(new Error("boom"));

      const [req, ctx] = createRequest({ keys: ["PROJ-1"] });
      const res = await POST(req, ctx);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe("Failed to resolve issue keys");
      consoleError.mockRestore();
    });
  });
});
