/**
 * Unit tests for the PUT
 * /api/projects/[projectId]/junit-iteration-property-names route.
 *
 * The route is a thin layer over Prisma + Zod; tests cover:
 *   - Validation: array length cap (16), per-name length (64),
 *     whitespace rejection, empty string rejection, prototype-pollution
 *     defense (T-06-01-05).
 *   - Authorization: anonymous → 401, non-project-admin → 403, project
 *     admin (per `authorizeProjectAdminForProject`) → 200.
 *   - Happy path: round-trips the propertyNames array.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: {
      update: vi.fn(),
    },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { PUT } from "./route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    // The route is wrapped in withAuditContext, which reads req.headers via
    // extractAuditContextFromHeaders. Provide a real Headers instance so the
    // wrapper's .get() calls resolve instead of throwing on undefined.
    headers: new Headers(),
  } as unknown as NextRequest;
}

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("PUT /api/projects/[projectId]/junit-iteration-property-names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (authorizeProjectAdminForProject as any).mockResolvedValue({
      ok: true,
      status: 200,
      projectId: 1,
    });
    (baseDb.projects.update as any).mockImplementation(async (args: any) => ({
      id: 1,
      junitIterationPropertyNames: args.data.junitIterationPropertyNames,
    }));
  });

  it("returns 401 when no session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not a project admin", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "USER" },
    });
    (authorizeProjectAdminForProject as any).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(403);
    expect(authorizeProjectAdminForProject).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: "u1", access: "USER" } }),
      1
    );
  });

  it("returns 400 when projectId is not a number", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("not-a-number")
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 and updates the row for ADMIN", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration", "iterationIndex"] }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.propertyNames).toEqual(["iteration", "iterationIndex"]);
    expect(baseDb.projects.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { junitIterationPropertyNames: ["iteration", "iterationIndex"] },
      select: { id: true, junitIterationPropertyNames: true },
    });
  });

  it("returns 200 for a USER the project-admin gate admits (e.g. a role with Settings canAddEdit)", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "USER" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 when the project-admin gate refuses a PROJECTADMIN (not assigned / project missing)", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "PROJECTADMIN" },
    });
    (authorizeProjectAdminForProject as any).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(403);
    expect(baseDb.projects.update).not.toHaveBeenCalled();
  });

  it("returns 400 when propertyNames array exceeds 16 entries", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const tooMany = Array.from({ length: 17 }, (_, i) => `name${i}`);
    const res = await PUT(
      makeRequest({ propertyNames: tooMany }),
      makeParams("1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when any name contains whitespace", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration", "data row"] }),
      makeParams("1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when any name is empty / whitespace-only", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration", "   "] }),
      makeParams("1")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when any name exceeds 64 characters", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const long = "a".repeat(65);
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration", long] }),
      makeParams("1")
    );
    expect(res.status).toBe(400);
  });

  it("rejects __proto__ / constructor / prototype (T-06-01-05 defense)", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    for (const reserved of ["__proto__", "constructor", "prototype"]) {
      const res = await PUT(
        makeRequest({ propertyNames: [reserved] }),
        makeParams("1")
      );
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 when propertyNames is missing or not an array", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const res1 = await PUT(makeRequest({}), makeParams("1"));
    expect(res1.status).toBe(400);
    const res2 = await PUT(
      makeRequest({ propertyNames: "not-an-array" }),
      makeParams("1")
    );
    expect(res2.status).toBe(400);
  });

  it("returns 200 for an empty array (clears the configured names)", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "ADMIN" },
    });
    const res = await PUT(makeRequest({ propertyNames: [] }), makeParams("1"));
    expect(res.status).toBe(200);
  });
});
