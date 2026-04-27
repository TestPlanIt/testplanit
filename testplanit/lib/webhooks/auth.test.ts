import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

const mockProjectsFindFirst = vi.fn();
const mockGetEnhancedDb = vi.fn();
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: (...args: unknown[]) => mockGetEnhancedDb(...args),
}));

import { canManageWebhookConfig } from "./auth";

function makeSession(
  overrides: Partial<Session["user"]> & { id?: string }
): Session {
  return {
    user: {
      id: "user-1",
      access: "USER",
      ...overrides,
    },
  } as unknown as Session;
}

describe("canManageWebhookConfig (CR-02 helper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEnhancedDb.mockResolvedValue({
      projects: { findFirst: mockProjectsFindFirst },
    });
  });

  it("System Admin (User.access='ADMIN') is always authorized — short-circuits without a DB query", async () => {
    const session = makeSession({ access: "ADMIN" });

    const ok = await canManageWebhookConfig(session, 99);

    expect(ok).toBe(true);
    expect(mockGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns false when session has no user id", async () => {
    const session = { user: { access: "USER" } } as unknown as Session;

    const ok = await canManageWebhookConfig(session, 42);

    expect(ok).toBe(false);
    expect(mockGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("authorizes the project creator", async () => {
    mockProjectsFindFirst.mockResolvedValue({ id: 42 });

    const ok = await canManageWebhookConfig(
      makeSession({ id: "creator-id" }),
      42
    );

    expect(ok).toBe(true);
    const where = mockProjectsFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe(42);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ createdBy: "creator-id" }])
    );
  });

  it("authorizes a user with SPECIFIC_ROLE='Project Admin' on the project", async () => {
    mockProjectsFindFirst.mockResolvedValue({ id: 42 });

    const ok = await canManageWebhookConfig(
      makeSession({ id: "role-admin" }),
      42
    );

    expect(ok).toBe(true);
    const where = mockProjectsFindFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        {
          userPermissions: {
            some: {
              userId: "role-admin",
              accessType: "SPECIFIC_ROLE",
              role: { name: "Project Admin" },
            },
          },
        },
      ])
    );
  });

  it("PROJECTADMIN tier user only authorized on projects they're assigned to (assignedUsers branch is included in the OR)", async () => {
    mockProjectsFindFirst.mockResolvedValue({ id: 42 });

    const ok = await canManageWebhookConfig(
      makeSession({ id: "pa-1", access: "PROJECTADMIN" }),
      42
    );

    expect(ok).toBe(true);
    const where = mockProjectsFindFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { assignedUsers: { some: { userId: "pa-1" } } },
      ])
    );
  });

  it("non-admin tier (e.g., access='USER') does NOT include the assignedUsers branch in the OR", async () => {
    mockProjectsFindFirst.mockResolvedValue(null);

    await canManageWebhookConfig(makeSession({ access: "USER" }), 42);

    const where = mockProjectsFindFirst.mock.calls[0][0].where;
    const hasAssignedUsersBranch = where.OR.some(
      (clause: Record<string, unknown>) => "assignedUsers" in clause
    );
    expect(hasAssignedUsersBranch).toBe(false);
  });

  it("returns false when the enhanced query returns no project (user is not creator, not Project Admin role, and not assigned)", async () => {
    mockProjectsFindFirst.mockResolvedValue(null);

    const ok = await canManageWebhookConfig(
      makeSession({ id: "outsider", access: "USER" }),
      42
    );

    expect(ok).toBe(false);
  });
});
