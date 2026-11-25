import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  user,
  purgeUser,
  reassignPurgedUserInSearch,
  captureAuditEvent,
  UserPurgeError,
} = vi.hoisted(() => {
  class UserPurgeError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message);
      this.name = "UserPurgeError";
    }
  }
  return {
    user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    purgeUser: vi.fn(),
    reassignPurgedUserInSearch: vi.fn(),
    captureAuditEvent: vi.fn(),
    UserPurgeError,
  };
});

vi.mock("~/lib/s3Client", () => ({ getS3Client: () => ({ send: vi.fn() }) }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/multiTenantDb", () => ({ getCurrentTenantId: () => "acme" }));
vi.mock("~/lib/services/auditLog", () => ({ captureAuditEvent }));
vi.mock("~/lib/services/runCaseStatusSync", () => ({
  syncRunCaseStatusAfterResultRemoval: vi.fn(),
}));
vi.mock("~/lib/services/userPurge", () => ({
  purgeUser,
  reassignPurgedUserInSearch,
  UserPurgeError,
}));
vi.mock("~/server/db", () => ({ db: { user } }));
vi.mock("../../shared", () => ({
  checkAdminAuth: vi.fn().mockResolvedValue({ userId: "admin" }),
  getTrashModel: () => ({
    modelName: "User",
    idType: "String",
    model: user,
  }),
}));

import { DELETED_USER_ID } from "~/lib/deletedUser";
import { DELETE, PATCH } from "./route";

const purged = { id: "u1", name: "Dana", email: "dana@example.com" };

function call(handler: typeof DELETE, itemId = "u1") {
  return handler(
    new NextRequest(`http://localhost/api/admin/trash/User/${itemId}`, {
      method: handler === DELETE ? "DELETE" : "PATCH",
    }),
    { params: Promise.resolve({ itemType: "User", itemId }) }
  );
}

describe("DELETE /api/admin/trash/User/[itemId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("purges a user who owns nothing", async () => {
    purgeUser.mockResolvedValue({ user: purged, reassigned: {} });

    const response = await call(DELETE);

    expect(response.status).toBe(200);
    expect((await response.json()).reassigned).toEqual({});
    expect(user.delete).not.toHaveBeenCalled();
  });

  it("keeps owned content and reports what was reassigned", async () => {
    const reassigned = { Comment: 1, TestRuns: 1, TestRunResults: 1 };
    purgeUser.mockResolvedValue({ user: purged, reassigned });

    const response = await call(DELETE);

    expect(response.status).toBe(200);
    expect((await response.json()).reassigned).toEqual(reassigned);
    expect(purgeUser).toHaveBeenCalledWith(expect.anything(), "u1");
    expect(reassignPurgedUserInSearch).toHaveBeenCalledWith("u1", "acme");
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entityType: "User",
        entityId: "u1",
        entityName: "Dana",
        metadata: expect.objectContaining({
          contentReassignedTo: DELETED_USER_ID,
          reassigned,
        }),
      })
    );
    expect(user.delete).not.toHaveBeenCalled();
  });

  it("still succeeds when the search index cannot be updated", async () => {
    purgeUser.mockResolvedValue({ user: purged, reassigned: { Comment: 1 } });
    reassignPurgedUserInSearch.mockRejectedValue(new Error("search is down"));

    const response = await call(DELETE);

    expect(response.status).toBe(200);
  });

  it("returns the reason when the user cannot be purged", async () => {
    purgeUser.mockRejectedValue(
      new UserPurgeError("User with ID u1 is not marked as deleted.", 400)
    );

    const response = await call(DELETE);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "User with ID u1 is not marked as deleted.",
    });
    expect(captureAuditEvent).not.toHaveBeenCalled();
  });

  it("names the table that still references the user", async () => {
    purgeUser.mockRejectedValue(
      new Error(
        'update or delete on table "User" violates foreign key constraint "ScimToken_systemUserId_fkey" on table "ScimToken"'
      )
    );

    const response = await call(DELETE);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Failed to purge User: records in ScimToken still reference it. Remove those records first.",
    });
  });
});

describe("PATCH /api/admin/trash/User/[itemId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to restore the Deleted User row", async () => {
    const response = await call(PATCH, DELETED_USER_ID);

    expect(response.status).toBe(400);
    expect(user.update).not.toHaveBeenCalled();
  });
});
