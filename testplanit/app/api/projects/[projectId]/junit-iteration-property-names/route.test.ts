/**
 * Unit tests for the PUT
 * /api/projects/[projectId]/junit-iteration-property-names route.
 *
 * The route is a thin layer over Prisma + Zod; tests cover:
 *   - Validation: array length cap (16), per-name length (64),
 *     whitespace rejection, empty string rejection, prototype-pollution
 *     defense (T-06-01-05).
 *   - Authorization: anonymous → 401, non-admin → 403, admin / project
 *     admin → 200.
 *   - Happy path: round-trips the propertyNames array.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    projects: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";
import { PUT } from "./route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("PUT /api/projects/[projectId]/junit-iteration-property-names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.projects.findFirst as any).mockResolvedValue({ id: 1 });
    (prisma.projects.update as any).mockImplementation(
      async (args: any) => ({
        id: 1,
        junitIterationPropertyNames: args.data.junitIterationPropertyNames,
      })
    );
  });

  it("returns 401 when no session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is not admin / project-admin", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "VIEWER" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(403);
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
    expect(prisma.projects.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { junitIterationPropertyNames: ["iteration", "iterationIndex"] },
      select: { id: true, junitIterationPropertyNames: true },
    });
  });

  it("returns 200 for PROJECTADMIN with a passing project lookup", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "PROJECTADMIN" },
    });
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 when project lookup fails (no access)", async () => {
    (getServerSession as any).mockResolvedValue({
      user: { id: "u1", access: "PROJECTADMIN" },
    });
    (prisma.projects.findFirst as any).mockResolvedValue(null);
    const res = await PUT(
      makeRequest({ propertyNames: ["iteration"] }),
      makeParams("1")
    );
    expect(res.status).toBe(403);
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
    const res = await PUT(
      makeRequest({ propertyNames: [] }),
      makeParams("1")
    );
    expect(res.status).toBe(200);
  });
});
