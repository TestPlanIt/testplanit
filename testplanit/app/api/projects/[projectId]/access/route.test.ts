import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const authorizeMock = vi.fn();
vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: (...args: unknown[]) =>
    authorizeMock(...args),
}));

const rosterMock = vi.fn();
vi.mock("~/lib/services/projectAccessRoster", () => ({
  getProjectAccessRoster: (...args: unknown[]) => rosterMock(...args),
}));

import { getServerSession } from "next-auth";

import { GET } from "./route";

const session = { user: { id: "user-1", access: "USER" } };

function call(projectId: string) {
  return GET(
    new NextRequest(`http://localhost/api/projects/${projectId}/access`),
    {
      params: Promise.resolve({ projectId }),
    }
  );
}

describe("GET /api/projects/[projectId]/access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(session);
    authorizeMock.mockResolvedValue({ ok: true, status: 200, projectId: 12 });
    rosterMock.mockResolvedValue([{ userId: "u-1" }]);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await call("12");
    expect(res.status).toBe(401);
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric project id", async () => {
    const res = await call("abc");
    expect(res.status).toBe(400);
    expect(authorizeMock).not.toHaveBeenCalled();
  });

  it("relays the authorizer's refusal", async () => {
    authorizeMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const res = await call("12");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it("returns the roster for a project admin", async () => {
    const res = await call("12");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ users: [{ userId: "u-1" }] });
    expect(authorizeMock).toHaveBeenCalledWith(session, 12);
    expect(rosterMock).toHaveBeenCalledWith(12);
  });

  it("returns 500 when the roster fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rosterMock.mockRejectedValue(new Error("boom"));
    const res = await call("12");
    expect(res.status).toBe(500);
  });
});
