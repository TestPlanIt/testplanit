import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServerAuthSession } from "~/server/auth";
import { searchAuditLogUsers } from "./searchAuditLogUsers";

// The action issues one raw query via Kysely sql`...`.execute(baseDb.$qb).
// Mock $qb as a capturing executor: compileQuery passes the raw node through
// (so tests can inspect its SQL fragments / bound values) and executeQuery
// returns the { rows } shape the action reads.
const { qbCompileQuery, qbExecuteQuery } = vi.hoisted(() => ({
  qbCompileQuery: vi.fn((node: unknown) => node),
  qbExecuteQuery: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
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

function mockSession(user: { id: string; access: string | null } | null) {
  vi.mocked(getServerAuthSession).mockResolvedValue(
    user ? ({ user } as never) : (null as never)
  );
}

/** Stub the single query: actor rows, each carrying the windowed total. */
function mockQueryResults(
  rows: Array<{
    userId: string;
    userName: string | null;
    userEmail: string | null;
    total: number;
  }>
) {
  qbExecuteQuery.mockResolvedValueOnce({ rows } as never);
}

// Collect bound values from a Kysely raw node in source order (ValueNodes),
// recursing into nested sql`` fragments.
function boundValues(node: any, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  if (node.kind === "ValueNode") out.push(node.value);
  if (Array.isArray(node.parameters))
    for (const p of node.parameters) boundValues(p, out);
  return out;
}

describe("searchAuditLogUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbCompileQuery.mockImplementation((node: unknown) => node);
    qbExecuteQuery.mockResolvedValue({ rows: [] });
  });

  describe("authorization — must not leak audit actors", () => {
    it("returns empty for an unauthenticated caller and never touches the DB", async () => {
      mockSession(null);

      const result = await searchAuditLogUsers("", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a plain USER without querying the audit log", async () => {
      mockSession({ id: "user-1", access: "USER" });

      const result = await searchAuditLogUsers("", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a PROJECTADMIN — the global list is ADMIN-only", async () => {
      mockSession({ id: "padmin-1", access: "PROJECTADMIN" });

      const result = await searchAuditLogUsers("", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });
  });

  describe("authorized access", () => {
    beforeEach(() => {
      mockSession({ id: "admin-1", access: "ADMIN" });
    });

    it("returns actor options with the windowed total stripped from each row", async () => {
      mockQueryResults([
        {
          userId: "u-1",
          userName: "Alice",
          userEmail: "alice@example.com",
          total: 7,
        },
        {
          userId: "u-2",
          userName: null,
          userEmail: "bob@example.com",
          total: 7,
        },
      ]);

      const result = await searchAuditLogUsers("", 0, 25);

      expect(result.total).toBe(7);
      expect(result.results).toEqual([
        { userId: "u-1", userName: "Alice", userEmail: "alice@example.com" },
        { userId: "u-2", userName: null, userEmail: "bob@example.com" },
      ]);
      expect(qbExecuteQuery).toHaveBeenCalledTimes(1);
    });

    it("returns total 0 when no rows match", async () => {
      mockQueryResults([]);

      const result = await searchAuditLogUsers("nobody", 0, 25);

      expect(result).toEqual({ results: [], total: 0 });
    });
  });

  describe("query shape", () => {
    beforeEach(() => {
      mockSession({ id: "admin-1", access: "ADMIN" });
    });

    it("binds clamped take and skip in order when there is no search", async () => {
      mockQueryResults([]);

      await searchAuditLogUsers("   ", 0, 25);

      // [take, skip] — a blank/whitespace query adds no values.
      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toEqual([25, 0]);
    });

    it("clamps pageSize to 100 and computes skip from the page", async () => {
      mockQueryResults([]);

      await searchAuditLogUsers("", 2, 500);

      // take clamped 500 -> 100; skip = page(2) * take(100) = 200.
      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toEqual([100, 200]);
    });

    it("adds case-insensitive name/email match terms when a query is provided", async () => {
      mockQueryResults([]);

      await searchAuditLogUsers("alice", 0, 25);

      expect(boundValues(qbCompileQuery.mock.calls[0][0])).toContain("%alice%");
    });
  });

  it("fails closed (empty) when the query throws", async () => {
    mockSession({ id: "admin-1", access: "ADMIN" });
    qbExecuteQuery.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchAuditLogUsers("", 0, 25);

    expect(result).toEqual({ results: [], total: 0 });
    errorSpy.mockRestore();
  });
});
