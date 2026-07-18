import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";

// Shared update mock used both as baseDb.testRuns.update and as the tx client's
// testRuns.update inside the mocked auditedTransaction, so the existing
// assertions keep working regardless of which path performs the write.
const { updateMock } = vi.hoisted(() => ({ updateMock: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    testRuns: {
      findFirst: vi.fn(),
      update: updateMock,
    },
  },
}));

// auditedTransaction runs its callback with a tx whose testRuns.update is the
// shared mock (the real one opens a DB transaction to set the audit GUC).
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: vi.fn((fn) => fn({ testRuns: { update: updateMock } })),
}));

vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: vi.fn(),
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.testRuns.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUpdate = updateMock;
const mockedCanEdit = userCanAddEditArea as unknown as ReturnType<typeof vi.fn>;
const mockedIsAdmin = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/test-runs/1/composition-lock", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = Promise.resolve({ testRunId: "1" });

const RUN = {
  id: 1,
  projectId: 7,
  createdById: "creator-1",
  isCompleted: false,
  compositionLockedAt: null as Date | null,
};

describe("PATCH /api/test-runs/[testRunId]/composition-lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUpdate.mockResolvedValue({
      compositionLockedAt: new Date("2026-07-18T00:00:00Z"),
      compositionLockedById: "editor-1",
    });
  });

  it("401 when unauthenticated", async () => {
    mockedSession.mockResolvedValue(null);
    const res = await PATCH(makeReq({ locked: true }), { params });
    expect(res.status).toBe(401);
  });

  it("400 on invalid body", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", access: "USER" } });
    const res = await PATCH(makeReq({ locked: "yes" }), { params });
    expect(res.status).toBe(400);
  });

  it("400 on non-numeric testRunId", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", access: "USER" } });
    const res = await PATCH(makeReq({ locked: true }), {
      params: Promise.resolve({ testRunId: "abc" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when the run does not exist", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", access: "USER" } });
    mockedFindFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq({ locked: true }), { params });
    expect(res.status).toBe(404);
  });

  it("409 when the run is already completed (already frozen)", async () => {
    mockedSession.mockResolvedValue({ user: { id: "u1", access: "USER" } });
    mockedFindFirst.mockResolvedValue({ ...RUN, isCompleted: true });
    const res = await PATCH(makeReq({ locked: true }), { params });
    expect(res.status).toBe(409);
  });

  describe("lock", () => {
    it("403 when the caller cannot add/edit runs", async () => {
      mockedSession.mockResolvedValue({ user: { id: "u1", access: "USER" } });
      mockedFindFirst.mockResolvedValue({ ...RUN });
      mockedCanEdit.mockResolvedValue(false);
      const res = await PATCH(makeReq({ locked: true }), { params });
      expect(res.status).toBe(403);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it("locks and stamps the actor when the caller can edit", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "editor-1", access: "USER" },
      });
      mockedFindFirst.mockResolvedValue({ ...RUN });
      mockedCanEdit.mockResolvedValue(true);
      const res = await PATCH(makeReq({ locked: true }), { params });
      expect(res.status).toBe(200);
      expect(mockedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ compositionLockedById: "editor-1" }),
        })
      );
      const json = await res.json();
      expect(json.locked).toBe(true);
    });

    it("is idempotent when already locked (no write)", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "editor-1", access: "USER" },
      });
      mockedFindFirst.mockResolvedValue({
        ...RUN,
        compositionLockedAt: new Date(),
      });
      mockedCanEdit.mockResolvedValue(true);
      const res = await PATCH(makeReq({ locked: true }), { params });
      expect(res.status).toBe(200);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });

  describe("unlock", () => {
    const LOCKED = { ...RUN, compositionLockedAt: new Date() };

    it("403 when a plain editor (not creator/admin) tries to unlock", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "someone-else", access: "USER" },
      });
      mockedFindFirst.mockResolvedValue({ ...LOCKED });
      mockedIsAdmin.mockResolvedValue({ ok: false, status: 403 });
      const res = await PATCH(makeReq({ locked: false }), { params });
      expect(res.status).toBe(403);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it("allows the run creator to unlock", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "creator-1", access: "USER" },
      });
      mockedFindFirst.mockResolvedValue({ ...LOCKED });
      mockedIsAdmin.mockResolvedValue({ ok: false, status: 403 });
      const res = await PATCH(makeReq({ locked: false }), { params });
      expect(res.status).toBe(200);
      expect(mockedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { compositionLockedAt: null, compositionLockedById: null },
        })
      );
    });

    it("allows a Project Admin (not creator) to unlock", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "pa-1", access: "USER" },
      });
      mockedFindFirst.mockResolvedValue({ ...LOCKED });
      mockedIsAdmin.mockResolvedValue({ ok: true, status: 200 });
      const res = await PATCH(makeReq({ locked: false }), { params });
      expect(res.status).toBe(200);
      expect(mockedUpdate).toHaveBeenCalled();
    });

    it("allows a system ADMIN to unlock without a project-admin lookup", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "admin-1", access: "ADMIN" },
      });
      mockedFindFirst.mockResolvedValue({ ...LOCKED });
      const res = await PATCH(makeReq({ locked: false }), { params });
      expect(res.status).toBe(200);
      expect(mockedIsAdmin).not.toHaveBeenCalled();
    });

    it("is idempotent when already unlocked (no write)", async () => {
      mockedSession.mockResolvedValue({
        user: { id: "creator-1", access: "USER" },
      });
      mockedFindFirst.mockResolvedValue({ ...RUN });
      const res = await PATCH(makeReq({ locked: false }), { params });
      expect(res.status).toBe(200);
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });
});
