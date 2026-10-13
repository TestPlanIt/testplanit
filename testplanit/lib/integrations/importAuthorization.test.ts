import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    integrationProject: {
      findFirst: vi.fn(),
    },
    integration: {
      findUnique: vi.fn(),
    },
    projects: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/areaPermission", () => ({
  isProjectAdminFor: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { isProjectAdminFor } from "~/lib/services/areaPermission";
import {
  authorizeProjectAdminForProject,
  authorizeProjectImport,
  authorizeProjectMilestoneSyncAdmin,
} from "./importAuthorization";

const INTEGRATION_ID = 1;
const MAPPING_ID = "mapping-1";
const PROJECT_ID = 100;

function mockValidMapping() {
  (baseDb.integrationProject.findFirst as any).mockResolvedValue({
    id: MAPPING_ID,
    isActive: true,
    projectIntegration: {
      integrationId: INTEGRATION_ID,
      projectId: PROJECT_ID,
    },
  });
  (baseDb.integration.findUnique as any).mockResolvedValue({
    provider: "JIRA",
  });
}

function session(overrides: Partial<Session["user"]> = {}): Session {
  return {
    user: {
      id: "user-1",
      access: "USER",
      ...overrides,
    },
  } as unknown as Session;
}

describe("authorizeProjectMilestoneSyncAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session user id", async () => {
    const result = await authorizeProjectMilestoneSyncAdmin(
      { user: {} } as unknown as Session,
      INTEGRATION_ID,
      MAPPING_ID
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("propagates authorizeProjectImport's 404 when mapping not found", async () => {
    (baseDb.integrationProject.findFirst as any).mockResolvedValue(null);

    const result = await authorizeProjectMilestoneSyncAdmin(
      session(),
      INTEGRATION_ID,
      MAPPING_ID
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    // projects.findFirst (the admin gate) should never be reached.
    expect(baseDb.projects.findFirst).not.toHaveBeenCalled();
  });

  it("propagates authorizeProjectImport's 400 SIMPLE_URL rejection", async () => {
    (baseDb.integrationProject.findFirst as any).mockResolvedValue({
      id: MAPPING_ID,
      isActive: true,
      projectIntegration: {
        integrationId: INTEGRATION_ID,
        projectId: PROJECT_ID,
      },
    });
    (baseDb.integration.findUnique as any).mockResolvedValue({
      provider: "SIMPLE_URL",
    });

    const result = await authorizeProjectMilestoneSyncAdmin(
      session(),
      INTEGRATION_ID,
      MAPPING_ID
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(baseDb.projects.findFirst).not.toHaveBeenCalled();
  });

  it("rejects (403) a plain project MEMBER that authorizeProjectImport would have ALLOWED", async () => {
    mockValidMapping();
    // authorizeProjectImport's own member check passes (baseDb.projects.findFirst
    // is called twice in this flow — once by authorizeProjectImport's member
    // check, once by the admin gate). Both calls resolve via the same mock;
    // simulate: base membership check finds the project (any member allowed),
    // but the STRICTER admin-only query (this test's actual target) finds
    // nothing because the mocked implementation below distinguishes by query
    // shape isn't practical here, so we mock sequential calls explicitly.
    // Three total baseDb.projects.findFirst calls happen across this test:
    // (1) authorizeProjectMilestoneSyncAdmin's internal authorizeProjectImport
    //     member check — allowed, (2) the stricter admin gate — not an admin,
    // (3) the standalone authorizeProjectImport baseline call below — allowed.
    (baseDb.projects.findFirst as any)
      .mockResolvedValueOnce({ id: PROJECT_ID }) // authorizeProjectImport member check: allowed
      .mockResolvedValueOnce({ id: PROJECT_ID }) // admin gate: project exists
      .mockResolvedValueOnce({ id: PROJECT_ID }); // baseline authorizeProjectImport call: allowed
    (isProjectAdminFor as any).mockResolvedValue(false); // admin gate: not an admin

    const result = await authorizeProjectMilestoneSyncAdmin(
      session({ id: "user-1", access: "USER" }),
      INTEGRATION_ID,
      MAPPING_ID
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(isProjectAdminFor).toHaveBeenCalledWith("user-1", PROJECT_ID);
    // Confirm the SAME user was in fact allowed by authorizeProjectImport.
    const baseline = await authorizeProjectImport(
      session({ id: "user-1", access: "USER" }),
      INTEGRATION_ID,
      MAPPING_ID
    );
    expect(baseline.ok).toBe(true);
  });

  it("allows a member the project-admin ladder admits (creator, Settings-bit role, assigned PROJECTADMIN)", async () => {
    mockValidMapping();
    (baseDb.projects.findFirst as any)
      .mockResolvedValueOnce({ id: PROJECT_ID }) // authorizeProjectImport member check
      .mockResolvedValueOnce({ id: PROJECT_ID }); // admin gate: project exists
    (isProjectAdminFor as any).mockResolvedValue(true);

    const result = await authorizeProjectMilestoneSyncAdmin(
      session({ id: "project-admin-1", access: "USER" }),
      INTEGRATION_ID,
      MAPPING_ID
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.provider).toBe("JIRA");
    expect(isProjectAdminFor).toHaveBeenCalledWith(
      "project-admin-1",
      PROJECT_ID
    );
  });

  it("authorizeProjectAdminForProject refuses a deleted or missing project even for a ladder admin", async () => {
    (baseDb.projects.findFirst as any).mockResolvedValueOnce(null);
    (isProjectAdminFor as any).mockResolvedValue(true);

    const result = await authorizeProjectAdminForProject(
      session({ id: "project-admin-1", access: "USER" }),
      PROJECT_ID
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(baseDb.projects.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, isDeleted: false },
      select: { id: true },
    });
  });

  it("allows a system ADMIN without an extra project query (short-circuit)", async () => {
    mockValidMapping();
    (baseDb.projects.findFirst as any).mockResolvedValueOnce({
      id: PROJECT_ID,
    }); // authorizeProjectImport's isAdmin branch skips its own member query

    const result = await authorizeProjectMilestoneSyncAdmin(
      session({ id: "sys-admin-1", access: "ADMIN" }),
      INTEGRATION_ID,
      MAPPING_ID
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    // authorizeProjectImport's own isAdmin branch skips baseDb.projects.findFirst
    // entirely, and the admin gate short-circuits on session.user.access ===
    // "ADMIN" without querying — so projects.findFirst is never called.
    expect(baseDb.projects.findFirst).not.toHaveBeenCalled();
  });
});
