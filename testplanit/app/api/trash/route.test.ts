import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
const authenticateApiTokenForMethod = vi.fn();
const listUserTrash = vi.fn();
const restoreUserTrashItem = vi.fn();

vi.mock("~/server/auth", () => ({ getServerAuthSession }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateApiTokenForMethod }));
vi.mock("~/lib/auditContextWrappers", () => ({
  enrichFromApiAuth: vi.fn(),
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/services/userTrash", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/services/userTrash")
  >("~/lib/services/userTrash");
  return {
    UserTrashRestoreError: actual.UserTrashRestoreError,
    listUserTrash,
    restoreUserTrashItem,
  };
});
vi.mock("~/lib/db", () => ({ baseDb: {} }));

const session = (id: string, access = "USER") => ({ user: { id, access } });

beforeEach(() => {
  vi.clearAllMocks();
  listUserTrash.mockResolvedValue({ windowDays: 30, items: [] });
  authenticateApiTokenForMethod.mockResolvedValue({
    authenticated: false,
    error: "No token",
    errorCode: "NO_TOKEN",
  });
});

describe("GET /api/trash", () => {
  it("lists the caller's own trash", async () => {
    getServerAuthSession.mockResolvedValue(session("u1"));
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/trash"));
    expect(res.status).toBe(200);
    expect(listUserTrash).toHaveBeenCalledWith("u1");
  });

  it("refuses another user's trash for non-admins and allows it for ADMIN", async () => {
    const { GET } = await import("./route");
    getServerAuthSession.mockResolvedValue(session("u1"));
    const denied = await GET(
      new NextRequest("http://localhost/api/trash?userId=u2")
    );
    expect(denied.status).toBe(403);
    expect(listUserTrash).not.toHaveBeenCalled();

    getServerAuthSession.mockResolvedValue(session("admin", "ADMIN"));
    const allowed = await GET(
      new NextRequest("http://localhost/api/trash?userId=u2")
    );
    expect(allowed.status).toBe(200);
    expect(listUserTrash).toHaveBeenCalledWith("u2");
  });

  it("falls back to API-token auth and rejects anonymous callers", async () => {
    const { GET } = await import("./route");
    getServerAuthSession.mockResolvedValue(null);
    expect(
      (await GET(new NextRequest("http://localhost/api/trash"))).status
    ).toBe(401);

    authenticateApiTokenForMethod.mockResolvedValue({
      authenticated: true,
      userId: "tok-user",
      access: "USER",
    });
    const res = await GET(new NextRequest("http://localhost/api/trash"));
    expect(res.status).toBe(200);
    expect(listUserTrash).toHaveBeenCalledWith("tok-user");
  });
});

describe("PATCH /api/trash/[itemType]/[itemId]", () => {
  const call = async (itemType = "RepositoryCases", itemId = "7") => {
    const { PATCH } = await import("./[itemType]/[itemId]/route");
    return PATCH(
      new NextRequest(`http://localhost/api/trash/${itemType}/${itemId}`, {
        method: "PATCH",
      }),
      { params: Promise.resolve({ itemType, itemId }) }
    );
  };

  it("restores as the signed-in user and echoes what was restored", async () => {
    getServerAuthSession.mockResolvedValue(session("u1"));
    restoreUserTrashItem.mockResolvedValue({
      item: { id: 7 },
      restored: { steps: 2 },
      projectId: 3,
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "7",
      itemType: "RepositoryCases",
      projectId: 3,
      restoredChildren: { steps: 2 },
    });
    expect(restoreUserTrashItem).toHaveBeenCalledWith({
      actor: { id: "u1", isAdmin: false },
      itemType: "RepositoryCases",
      itemId: "7",
    });
  });

  it.each([
    ["unknown_type", 404],
    ["not_found", 404],
    ["disabled", 403],
    ["not_owner", 403],
    ["expired", 403],
    ["forbidden", 403],
    ["parent_deleted", 409],
    ["name_conflict", 409],
  ])("maps %s to HTTP %i with the code in the body", async (code, status) => {
    const { UserTrashRestoreError } = await import("~/lib/services/userTrash");
    getServerAuthSession.mockResolvedValue(session("u1"));
    restoreUserTrashItem.mockRejectedValue(
      new UserTrashRestoreError(code as never)
    );
    const res = await call();
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it("rejects a read-only API token with 403", async () => {
    getServerAuthSession.mockResolvedValue(null);
    authenticateApiTokenForMethod.mockResolvedValue({
      authenticated: false,
      error: "Read-only token",
      errorCode: "READ_ONLY_TOKEN",
    });
    expect((await call()).status).toBe(403);
    expect(restoreUserTrashItem).not.toHaveBeenCalled();
  });
});
