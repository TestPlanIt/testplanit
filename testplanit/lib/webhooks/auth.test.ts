import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

const mockAuthorize = vi.fn();
vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: (...args: unknown[]) =>
    mockAuthorize(...args),
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
  });

  it("System Admin (User.access='ADMIN') is always authorized — short-circuits without the ladder", async () => {
    const ok = await canManageWebhookConfig(
      makeSession({ access: "ADMIN" }),
      99
    );

    expect(ok).toBe(true);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("returns false when session has no user id", async () => {
    const session = { user: { access: "USER" } } as unknown as Session;

    const ok = await canManageWebhookConfig(session, 42);

    expect(ok).toBe(false);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("delegates to the shared project-admin gate for everyone else", async () => {
    mockAuthorize.mockResolvedValue({ ok: true, status: 200, projectId: 42 });
    const session = makeSession({ id: "role-admin" });

    const ok = await canManageWebhookConfig(session, 42);

    expect(ok).toBe(true);
    expect(mockAuthorize).toHaveBeenCalledWith(session, 42);
  });

  it("returns false when the gate refuses (not creator, no Settings-bit role, not an assigned PROJECTADMIN)", async () => {
    mockAuthorize.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const ok = await canManageWebhookConfig(
      makeSession({ id: "outsider", access: "USER" }),
      42
    );

    expect(ok).toBe(false);
  });
});
