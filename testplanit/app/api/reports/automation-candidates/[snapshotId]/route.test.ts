/**
 * DELETE /api/reports/automation-candidates/[snapshotId]
 *
 * Soft-deletes a snapshot. Gated on Reporting.canDelete (or project creator,
 * project admin, system admin). Hard-fail vs the schema's `@@allow('update')`
 * policy on canAddEdit is the whole reason this route exists in the first
 * place — without it, a canAddEdit-only user could soft-delete by flipping
 * isDeleted via the model-route update.
 *
 * The gate walks the effective-access ladder in lib/services/areaPermission.ts
 * and reads the Reporting area's canDelete bit off the result, so the tests
 * drive the ladder's resolution directly.
 */
import { ApplicationArea } from "~/zenstack/models";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: { findFirst: vi.fn() },
    llmReportSnapshot: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/areaPermission", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/areaPermission")>();
  return { ...actual, resolveEffectiveProjectAccess: vi.fn() };
});

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { resolveEffectiveProjectAccess } from "~/lib/services/areaPermission";
import { DELETE } from "./route";

function req(): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/reports/automation-candidates/1", {
      method: "DELETE",
    })
  );
}

const findProject = baseDb.projects.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const findSnapshot = baseDb.llmReportSnapshot
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const updateSnapshot = baseDb.llmReportSnapshot.update as unknown as ReturnType<
  typeof vi.fn
>;
const resolveAccess = vi.mocked(resolveEffectiveProjectAccess);

const baseResolution = {
  isSystemAdmin: false,
  isSystemProjectAdmin: false,
  isProjectAdmin: false,
  accessDenied: false,
  effectiveRole: null,
  userAccessType: null,
  groupAccessType: null,
  projectDefaultAccessType: null,
  resolved: true,
};

const reportingRole = (canDelete: boolean) => ({
  id: 3,
  name: "Tester",
  rolePermissions: [
    {
      area: ApplicationArea.Reporting,
      canAddEdit: true,
      canDelete,
      canClose: false,
    },
  ],
});

function signedIn() {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: "u1" },
  } as never);
  findSnapshot.mockResolvedValue({ id: 1, projectId: 7 });
  findProject.mockResolvedValue({ id: 7 });
  updateSnapshot.mockResolvedValue({ id: 1 });
}

describe("DELETE /api/reports/automation-candidates/[snapshotId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(401);
  });

  it("400s on a non-numeric snapshot id", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when the snapshot does not exist or is already deleted", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findSnapshot.mockResolvedValue(null);
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(404);
    expect(updateSnapshot).not.toHaveBeenCalled();
  });

  it("403s when the user lacks Reporting.canDelete and is not a project admin", async () => {
    signedIn();
    resolveAccess.mockResolvedValue({
      ...baseResolution,
      effectiveRole: reportingRole(false),
    });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(403);
    expect(updateSnapshot).not.toHaveBeenCalled();
    expect(resolveAccess).toHaveBeenCalledWith("u1", 7);
  });

  it("403s when the project is missing or deleted", async () => {
    signedIn();
    findProject.mockResolvedValue(null);
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(403);
    expect(resolveAccess).not.toHaveBeenCalled();
  });

  it("soft-deletes when the effective role carries Reporting.canDelete", async () => {
    signedIn();
    resolveAccess.mockResolvedValue({
      ...baseResolution,
      effectiveRole: reportingRole(true),
    });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(200);
    const args = updateSnapshot.mock.calls[0]![0];
    expect(args.where).toEqual({ id: 1 });
    expect(args.data.isDeleted).toBe(true);
  });

  it("soft-deletes for a project admin regardless of the Reporting bits", async () => {
    signedIn();
    resolveAccess.mockResolvedValue({
      ...baseResolution,
      isProjectAdmin: true,
      effectiveRole: reportingRole(false),
    });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(updateSnapshot).toHaveBeenCalled();
  });

  it("soft-deletes when the user is a system admin", async () => {
    signedIn();
    resolveAccess.mockResolvedValue({
      ...baseResolution,
      isSystemAdmin: true,
      isProjectAdmin: true,
    });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(updateSnapshot).toHaveBeenCalled();
  });

  it("does not regress: the gate reads the Reporting area, not another area's canDelete", async () => {
    signedIn();
    resolveAccess.mockResolvedValue({
      ...baseResolution,
      effectiveRole: {
        id: 3,
        name: "Tester",
        rolePermissions: [
          {
            area: ApplicationArea.TestRuns,
            canAddEdit: true,
            canDelete: true,
            canClose: true,
          },
        ],
      },
    });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(403);
    expect(updateSnapshot).not.toHaveBeenCalled();
  });
});
