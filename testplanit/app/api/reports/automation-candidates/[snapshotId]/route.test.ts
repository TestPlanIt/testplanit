/**
 * DELETE /api/reports/automation-candidates/[snapshotId]
 *
 * Soft-deletes a snapshot. Gated on Reporting.canDelete (or project creator,
 * project admin, system admin). Hard-fail vs the schema's `@@allow('update')`
 * policy on canAddEdit is the whole reason this route exists in the first
 * place — without it, a canAddEdit-only user could soft-delete by flipping
 * isDeleted via the model-route update.
 */
import { ApplicationArea } from "~/zenstack/models";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
    llmReportSnapshot: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";
import { DELETE } from "./route";

function req(): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/reports/automation-candidates/1", {
      method: "DELETE",
    })
  );
}

const findUser = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const findProject = prisma.projects.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const findSnapshot = prisma.llmReportSnapshot
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const updateSnapshot = prisma.llmReportSnapshot.update as unknown as ReturnType<
  typeof vi.fn
>;

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

  it("403s when the user lacks Reporting.canDelete and is not project admin or creator", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findSnapshot.mockResolvedValue({ id: 1, projectId: 7 });
    findUser.mockResolvedValue({ access: "USER" });
    findProject.mockResolvedValue({
      createdBy: "someone-else",
      assignedUsers: [],
      userPermissions: [
        {
          accessType: "SPECIFIC_ROLE",
          role: {
            name: "Tester",
            rolePermissions: [{ canDelete: false }],
          },
        },
      ],
      groupPermissions: [],
    });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(403);
    expect(updateSnapshot).not.toHaveBeenCalled();
  });

  it("soft-deletes when the user has Reporting.canDelete via SPECIFIC_ROLE", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findSnapshot.mockResolvedValue({ id: 1, projectId: 7 });
    findUser.mockResolvedValue({ access: "USER" });
    findProject.mockResolvedValue({
      createdBy: "someone-else",
      assignedUsers: [],
      userPermissions: [
        {
          accessType: "SPECIFIC_ROLE",
          role: {
            name: "Tester",
            rolePermissions: [{ canDelete: true }],
          },
        },
      ],
      groupPermissions: [],
    });
    updateSnapshot.mockResolvedValue({ id: 1 });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(200);
    const args = updateSnapshot.mock.calls[0]![0];
    expect(args.where).toEqual({ id: 1 });
    expect(args.data.isDeleted).toBe(true);
  });

  it("soft-deletes when the user is the project creator regardless of role permissions", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findSnapshot.mockResolvedValue({ id: 1, projectId: 7 });
    findUser.mockResolvedValue({ access: "USER" });
    findProject.mockResolvedValue({
      createdBy: "u1",
      assignedUsers: [],
      userPermissions: [],
      groupPermissions: [],
    });
    updateSnapshot.mockResolvedValue({ id: 1 });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(updateSnapshot).toHaveBeenCalled();
  });

  it("soft-deletes when the user is a system admin", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findSnapshot.mockResolvedValue({ id: 1, projectId: 7 });
    findUser.mockResolvedValue({ access: "ADMIN" });
    updateSnapshot.mockResolvedValue({ id: 1 });
    const res = await DELETE(req(), {
      params: Promise.resolve({ snapshotId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(updateSnapshot).toHaveBeenCalled();
  });

  it("does not regress: the ApplicationArea query filter is Reporting (not Settings, etc.)", async () => {
    // Belt-and-suspenders against a future copy-paste mistake that would
    // silently make this gate check the wrong area.
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    findSnapshot.mockResolvedValue({ id: 1, projectId: 7 });
    findUser.mockResolvedValue({ access: "USER" });
    findProject.mockResolvedValue({
      createdBy: "someone-else",
      assignedUsers: [],
      userPermissions: [
        {
          accessType: "SPECIFIC_ROLE",
          role: {
            name: "Tester",
            rolePermissions: [{ canDelete: true }],
          },
        },
      ],
      groupPermissions: [],
    });
    updateSnapshot.mockResolvedValue({ id: 1 });
    await DELETE(req(), { params: Promise.resolve({ snapshotId: "1" }) });
    // The project query selects userPermissions filtered on Reporting area
    const projectQueryArgs = findProject.mock.calls[0]![0];
    const userPermsSelect =
      projectQueryArgs.select.userPermissions.select.role.select
        .rolePermissions;
    expect(userPermsSelect.where).toEqual({
      area: ApplicationArea.Reporting,
    });
  });
});
