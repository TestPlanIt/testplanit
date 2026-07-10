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
    integrationProject: { findMany: vi.fn() },
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
  const url = new URL(
    "http://localhost/api/integrations/4/milestone-sync/preview"
  );
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
    (baseDb.integrationProject.findMany as any).mockResolvedValue([
      {
        id: "map-1",
        externalProjectKey: "DEMO",
        externalProjectName: "Demo Project",
      },
    ]);
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

describe("milestone-sync preview route — multi-mapping union", () => {
  const getExternalMilestones = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    (authorizeProjectMilestoneSyncAdmin as any).mockResolvedValue({
      ok: true,
      status: 200,
      projectId: 370,
      provider: "JIRA",
    });
    (baseDb.projectIntegration.findFirst as any).mockResolvedValue({
      config: {},
    });
    (baseDb.integrationProject.findMany as any).mockResolvedValue([
      {
        id: "map-abt",
        externalProjectKey: "ABT",
        externalProjectName: "Allego Bug Tracking",
      },
      {
        id: "map-adm",
        externalProjectKey: "ADM",
        externalProjectName: "Admin Tools",
      },
    ]);
    (integrationManager.getAdapter as any).mockResolvedValue({
      getExternalMilestones,
    });
  });

  it("unions items across every active mapping and annotates their source", async () => {
    getExternalMilestones.mockImplementation(async ({ projectKey }: any) => ({
      items:
        projectKey === "ABT"
          ? [{ id: "v-1", kind: "RELEASE", name: "Icebox", state: "FUTURE" }]
          : [
              {
                id: "s-1",
                kind: "ITERATION",
                name: "Admin 9.2 S1",
                state: "ACTIVE",
              },
            ],
      hasMore: false,
    }));

    const res = await GET(
      createRequest({ projectMappingId: "map-abt" }),
      params
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getExternalMilestones).toHaveBeenCalledWith(
      expect.objectContaining({ projectKey: "ABT" })
    );
    expect(getExternalMilestones).toHaveBeenCalledWith(
      expect.objectContaining({ projectKey: "ADM" })
    );
    expect(body.items).toHaveLength(2);
    const icebox = body.items.find((i: any) => i.id === "v-1");
    expect(icebox.sourceProjects).toEqual([
      { id: "map-abt", key: "ABT", name: "Allego Bug Tracking" },
    ]);
  });

  it("dedupes a shared-board sprint and records both sources", async () => {
    getExternalMilestones.mockResolvedValue({
      items: [
        { id: "s-9", kind: "ITERATION", name: "Shared", state: "ACTIVE" },
      ],
      hasMore: false,
    });

    const res = await GET(
      createRequest({ projectMappingId: "map-abt" }),
      params
    );
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sourceProjects.map((sp: any) => sp.key)).toEqual([
      "ABT",
      "ADM",
    ]);
  });

  it("degrades gracefully when one mapping's fetch fails, with a warning", async () => {
    getExternalMilestones.mockImplementation(async ({ projectKey }: any) => {
      if (projectKey === "ABT") throw new Error("HTTP 400: boom");
      return {
        items: [{ id: "s-1", kind: "ITERATION", name: "S1", state: "ACTIVE" }],
        hasMore: false,
      };
    });

    const res = await GET(
      createRequest({ projectMappingId: "map-abt" }),
      params
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.warnings).toEqual(["ABT: HTTP 400: boom"]);
  });

  it("fails with 500 only when every mapping's fetch fails", async () => {
    getExternalMilestones.mockRejectedValue(new Error("HTTP 401: nope"));
    const res = await GET(
      createRequest({ projectMappingId: "map-abt" }),
      params
    );
    expect(res.status).toBe(500);
  });
});
