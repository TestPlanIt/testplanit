import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { searchProjectAuditLogUsers } from "./searchProjectAuditLogUsers";

// The action issues its two raw queries via Kysely sql`...`.execute(prisma.$qb).
// Mock $qb as a capturing executor: compileQuery passes the raw node through (so
// tests can inspect its SQL fragments / bound project id) and executeQuery
// returns the { rows } shape the action reads.
const { qbCompileQuery, qbExecuteQuery } = vi.hoisted(() => ({
  qbCompileQuery: vi.fn((node: unknown) => node),
  qbExecuteQuery: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    projectAssignment: { count: vi.fn() },
    $qb: {
      getExecutor: () => ({
        transformQuery: (n: unknown) => n,
        compileQuery: qbCompileQuery,
        executeQuery: qbExecuteQuery,
      }),
    },
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

const PROJECT_ID = 42;

function mockSession(user: { id: string; access: string | null } | null) {
  vi.mocked(getServerAuthSession).mockResolvedValue(
    user ? ({ user } as never) : (null as never)
  );
}

/** Stub the two raw queries: distinct actors, then the COUNT. */
function mockQueryResults(
  rows: Array<{
    userId: string;
    userName: string | null;
    userEmail: string | null;
  }>,
  total: number
) {
  qbExecuteQuery
    .mockResolvedValueOnce({ rows } as never)
    .mockResolvedValueOnce({ rows: [{ count: total }] } as never);
}

// Collect bound values from a Kysely raw node in source order (ValueNodes),
// recursing into nested sql`` fragments. Replaces the v2 Prisma `Sql.values`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function boundValues(node: any, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  if (node.kind === "ValueNode") out.push(node.value);
  if (Array.isArray(node.parameters))
    for (const p of node.parameters) boundValues(p, out);
  return out;
}

describe("searchProjectAuditLogUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbCompileQuery.mockImplementation((node: unknown) => node);
    qbExecuteQuery.mockResolvedValue({ rows: [] });
  });

  describe("authorization — must not leak a project's audit actors", () => {
    it("returns empty for an unauthenticated caller and never touches the DB", async () => {
      mockSession(null);

      const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(prisma.projectAssignment.count).not.toHaveBeenCalled();
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a plain USER without querying the audit log", async () => {
      mockSession({ id: "user-1", access: "USER" });

      const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(prisma.projectAssignment.count).not.toHaveBeenCalled();
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a NONE-access caller without querying the audit log", async () => {
      mockSession({ id: "user-1", access: "NONE" });

      const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a PROJECTADMIN NOT assigned to the project", async () => {
      mockSession({ id: "padmin-1", access: "PROJECTADMIN" });
      vi.mocked(prisma.projectAssignment.count).mockResolvedValue(0 as never);

      const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      // The assignment check is scoped to this caller + this project...
      expect(prisma.projectAssignment.count).toHaveBeenCalledWith({
        where: { userId: "padmin-1", projectId: PROJECT_ID },
      });
      // ...and the actor query is never run when the check fails.
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a non-integer projectId without querying the DB", async () => {
      mockSession({ id: "admin-1", access: "ADMIN" });

      const result = await searchProjectAuditLogUsers(NaN, "", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(prisma.projectAssignment.count).not.toHaveBeenCalled();
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });
  });

  describe("authorized access", () => {
    it("lets a PROJECTADMIN assigned to the project read its actors, scoped to that project", async () => {
      mockSession({ id: "padmin-1", access: "PROJECTADMIN" });
      vi.mocked(prisma.projectAssignment.count).mockResolvedValue(1 as never);
      mockQueryResults(
        [{ userId: "u-1", userName: "Alice", userEmail: "alice@example.com" }],
        1
      );

      const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

      expect(prisma.projectAssignment.count).toHaveBeenCalledWith({
        where: { userId: "padmin-1", projectId: PROJECT_ID },
      });
      expect(result.total).toBe(1);
      expect(result.results).toEqual([
        { userId: "u-1", userName: "Alice", userEmail: "alice@example.com" },
      ]);

      // Both raw queries bind the project id, proving the scan can't reach
      // another project's rows.
      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toContain(
        PROJECT_ID
      );
      expect(boundValues(qbCompileQuery.mock.calls[1][0])).toContain(
        PROJECT_ID
      );
    });

    it("lets a system ADMIN read without an assignment check", async () => {
      mockSession({ id: "admin-1", access: "ADMIN" });
      mockQueryResults(
        [{ userId: "u-2", userName: "Bob", userEmail: "bob@example.com" }],
        1
      );

      const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

      expect(prisma.projectAssignment.count).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("query shape", () => {
    beforeEach(() => {
      mockSession({ id: "admin-1", access: "ADMIN" });
    });

    it("binds projectId, clamped take, and skip in order when there is no search", async () => {
      mockQueryResults([], 0);

      await searchProjectAuditLogUsers(PROJECT_ID, "   ", 0, 25);

      // [projectId, take, skip] — a blank/whitespace query adds no values.
      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toEqual([
        PROJECT_ID, 25, 0,
      ]);
    });

    it("clamps pageSize to 100 and computes skip from the page", async () => {
      mockQueryResults([], 0);

      await searchProjectAuditLogUsers(PROJECT_ID, "", 2, 500);

      // take clamped 500 -> 100; skip = page(2) * take(100) = 200.
      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toEqual([
        PROJECT_ID, 100, 200,
      ]);
    });

    it("adds case-insensitive name/email match terms when a query is provided", async () => {
      mockQueryResults([], 0);

      await searchProjectAuditLogUsers(PROJECT_ID, "alice", 0, 25);

      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toContain("%alice%");
    });
  });

  it("fails closed (empty) when the query throws", async () => {
    mockSession({ id: "admin-1", access: "ADMIN" });
    qbExecuteQuery.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchProjectAuditLogUsers(PROJECT_ID, "", 0, 25);

    expect(result).toEqual({ results: [], total: 0 });
    errorSpy.mockRestore();
  });
});
