import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServerAuthSession } from "~/server/auth";
import { getAuditLogActions } from "./getAuditLogActions";

// The action issues one raw query via Kysely sql`...`.execute(baseDb.$qb).
// Mock $qb as a pass-through executor returning the { rows } shape it reads.
const { qbExecuteQuery } = vi.hoisted(() => ({
  qbExecuteQuery: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    $qb: {
      getExecutor: () => ({
        transformQuery: (n: unknown) => n,
        compileQuery: (n: unknown) => n,
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

describe("getAuditLogActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbExecuteQuery.mockResolvedValue({ rows: [] });
  });

  describe("authorization — the audit log is ADMIN-only", () => {
    it("returns empty for an unauthenticated caller and never touches the DB", async () => {
      mockSession(null);

      expect(await getAuditLogActions()).toEqual([]);
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("returns empty for a non-ADMIN without querying the audit log", async () => {
      mockSession({ id: "user-1", access: "PROJECTADMIN" });

      expect(await getAuditLogActions()).toEqual([]);
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });
  });

  it("returns the distinct actions sorted alphabetically for an ADMIN", async () => {
    mockSession({ id: "admin-1", access: "ADMIN" });
    // The skip-scan yields enum-definition order; the action re-sorts.
    qbExecuteQuery.mockResolvedValueOnce({
      rows: [{ action: "UPDATE" }, { action: "CREATE" }, { action: "DELETE" }],
    } as never);

    expect(await getAuditLogActions()).toEqual(["CREATE", "DELETE", "UPDATE"]);
    expect(qbExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it("returns empty when the audit log has no rows", async () => {
    mockSession({ id: "admin-1", access: "ADMIN" });

    expect(await getAuditLogActions()).toEqual([]);
  });

  it("fails closed (empty) when the query throws", async () => {
    mockSession({ id: "admin-1", access: "ADMIN" });
    qbExecuteQuery.mockRejectedValueOnce(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await getAuditLogActions()).toEqual([]);
    errorSpy.mockRestore();
  });
});
