import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the route handler
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    integrationProject: { findFirst: vi.fn() },
    projectIntegration: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn(),
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectMilestoneSyncAdmin: vi.fn(),
}));

import { baseDb } from "@/lib/db";
import { integrationManager } from "@/lib/integrations/IntegrationManager";
import { getServerSession } from "next-auth";
import { authorizeProjectMilestoneSyncAdmin } from "~/lib/integrations/importAuthorization";

import { GET } from "./route";

const params = { params: Promise.resolve({ id: "4" }) };

const createRequest = (search: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/integrations/4/milestone-sync/preview");
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
};

describe("milestone-sync preview route — configured-kind constraint", () => {
  const getExternalMilestones = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (authorizeProjectMilestoneSyncAdmin as any).mockResolvedValue({
      ok: true,
      status: 200,
      projectId: 390,
      provider: "JIRA",
    });
    (baseDb.integrationProject.findFirst as any).mockResolvedValue({
      externalProjectKey: "DEMO",
    });
    getExternalMilestones.mockResolvedValue({ items: [], hasMore: false });
    (integrationManager.getAdapter as any).mockResolvedValue({
      getExternalMilestones,
    });
  });

  it("constrains the adapter call to the single configured kind when no kind param is passed", async () => {
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue({
      config: { milestoneSync: { enabled: true, kinds: ["RELEASE"] } },
    });

    const res = await GET(createRequest({ projectMappingId: "map-1" }), params);

    expect(res.status).toBe(200);
    expect(getExternalMilestones).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "RELEASE" })
    );
  });

  it("leaves the fetch unconstrained when both kinds are configured", async () => {
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue({
      config: {
        milestoneSync: { enabled: true, kinds: ["RELEASE", "ITERATION"] },
      },
    });

    const res = await GET(createRequest({ projectMappingId: "map-1" }), params);

    expect(res.status).toBe(200);
    const callArgs = getExternalMilestones.mock.calls[0][0];
    expect(callArgs.kind).toBeUndefined();
  });

  it("leaves the fetch unconstrained when no milestoneSync config exists", async () => {
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue({
      config: {},
    });

    const res = await GET(createRequest({ projectMappingId: "map-1" }), params);

    expect(res.status).toBe(200);
    const callArgs = getExternalMilestones.mock.calls[0][0];
    expect(callArgs.kind).toBeUndefined();
  });

  it("an explicit kind param wins over the configured kinds", async () => {
    const res = await GET(
      createRequest({ projectMappingId: "map-1", kind: "ITERATION" }),
      params
    );

    expect(res.status).toBe(200);
    expect(baseDb.projectIntegration.findFirst).not.toHaveBeenCalled();
    expect(getExternalMilestones).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ITERATION" })
    );
  });
});
