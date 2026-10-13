// Route tests for the per-issue tri-state classification override.
// Harness mirrors ../detach/route.test.ts (same gate order, same mocks),
// plus a projectIntegration read: the null arm and the response's
// isRequirement resolve against the LIVE config, so the route reads the
// active mapping the way resolveSyncedRequirementFlag does.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: {
      findFirst: vi.fn(),
    },
    projectIntegration: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

const { mockIssueUpdate } = vi.hoisted(() => ({
  mockIssueUpdate: vi.fn(),
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    issue: { update: mockIssueUpdate },
  })),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedIssueFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedMappingFindFirst = baseDb.projectIntegration
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/requirements/10/override",
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

const params = (projectId = "5", issueId = "10") => ({
  params: Promise.resolve({ projectId, issueId }),
});

// A synced Story that the config does NOT classify — the promotion target.
const unclassifiedStory = {
  id: 10,
  integrationId: 99,
  issueTypeId: "10002",
  data: {},
  isRequirement: false,
  requirementOverride: null,
};

describe("POST /api/projects/[projectId]/requirements/[issueId]/override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 5 });
    mockedIssueFindFirst.mockResolvedValue(unclassifiedStory);
    // Epics-only config: type 10001 classifies, the Story's 10002 does not.
    mockedMappingFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });
    mockIssueUpdate.mockImplementation(async ({ data }: any) => ({
      requirementOverride: data.requirementOverride,
      isRequirement: data.isRequirement,
    }));
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(makeRequest({ override: "FORCE_ON" }), params());

    expect(res.status).toBe(401);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when projectId or issueId is not a number", async () => {
    const res = await POST(
      makeRequest({ override: "FORCE_ON" }),
      params("abc", "10")
    );

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("returns 400 on a missing, extra, or unknown-value override", async () => {
    for (const body of [
      {},
      { override: "FORCE_ON", extra: 1 },
      { override: "SOMETIMES" },
      undefined,
    ]) {
      const res = await POST(makeRequest(body), params());
      expect(res.status).toBe(400);
    }
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns the authorizer's status when the caller is not a project admin", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Project admin access required",
    });

    const res = await POST(makeRequest({ override: "FORCE_ON" }), params());

    expect(res.status).toBe(403);
    expect(mockedIssueFindFirst).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the issue is not a live row of this project", async () => {
    mockedIssueFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ override: "FORCE_ON" }), params());

    expect(res.status).toBe(404);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
    // The lookup is project-pinned and excludes soft-deleted rows.
    expect(mockedIssueFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 10,
      projectId: 5,
      isDeleted: false,
    });
  });

  it("returns 400 for a native (un-synced) issue", async () => {
    mockedIssueFindFirst.mockResolvedValue({
      ...unclassifiedStory,
      integrationId: null,
    });

    const res = await POST(makeRequest({ override: "FORCE_ON" }), params());

    expect(res.status).toBe(400);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("FORCE_ON promotes an unclassified synced issue in one write", async () => {
    const res = await POST(makeRequest({ override: "FORCE_ON" }), params());

    expect(res.status).toBe(200);
    expect(mockIssueUpdate).toHaveBeenCalledTimes(1);
    expect(mockIssueUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: 10 },
      data: { requirementOverride: "FORCE_ON", isRequirement: true },
    });
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      requirementOverride: "FORCE_ON",
      isRequirement: true,
    });
  });

  it("FORCE_OFF excludes a config-classified issue in one write", async () => {
    mockedIssueFindFirst.mockResolvedValue({
      ...unclassifiedStory,
      issueTypeId: "10001",
      isRequirement: true,
    });

    const res = await POST(makeRequest({ override: "FORCE_OFF" }), params());

    expect(res.status).toBe(200);
    expect(mockIssueUpdate.mock.calls[0][0].data).toEqual({
      requirementOverride: "FORCE_OFF",
      isRequirement: false,
    });
  });

  it("null resets the row to the live config's answer", async () => {
    // Pinned ON, but the config does not classify its type — resetting
    // must re-follow the config, not keep the pinned state.
    mockedIssueFindFirst.mockResolvedValue({
      ...unclassifiedStory,
      isRequirement: true,
      requirementOverride: "FORCE_ON",
    });

    const res = await POST(makeRequest({ override: null }), params());

    expect(res.status).toBe(200);
    expect(mockIssueUpdate.mock.calls[0][0].data).toEqual({
      requirementOverride: null,
      isRequirement: false,
    });
  });

  it("resolves the null arm through labels for a typeless tracker's issue", async () => {
    mockedMappingFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["epic"] } },
    });
    mockedIssueFindFirst.mockResolvedValue({
      ...unclassifiedStory,
      issueTypeId: null,
      data: { labels: ["epic", "bug"] },
      isRequirement: false,
      requirementOverride: "FORCE_OFF",
    });

    const res = await POST(makeRequest({ override: null }), params());

    expect(res.status).toBe(200);
    expect(mockIssueUpdate.mock.calls[0][0].data).toEqual({
      requirementOverride: null,
      isRequirement: true,
    });
  });

  it("is an idempotent no-op when nothing would change", async () => {
    mockedIssueFindFirst.mockResolvedValue({
      ...unclassifiedStory,
      isRequirement: true,
      requirementOverride: "FORCE_ON",
    });

    const res = await POST(makeRequest({ override: "FORCE_ON" }), params());

    expect(res.status).toBe(200);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      requirementOverride: "FORCE_ON",
      isRequirement: true,
    });
  });
});
