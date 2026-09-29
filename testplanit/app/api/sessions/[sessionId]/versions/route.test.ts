import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  userCanAddEditArea: vi.fn(),
  sessionsFindFirst: vi.fn(),
  projectsFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  createVersion: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/auditContext", () => ({ updateAuditContext: vi.fn() }));
vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: mocks.userCanAddEditArea,
}));
vi.mock("~/lib/project-access", () => ({
  buildProjectAccessWhere: vi.fn(() => ({})),
}));
vi.mock("~/lib/db", () => ({
  baseDb: {
    sessions: { findFirst: mocks.sessionsFindFirst },
    projects: { findFirst: mocks.projectsFindFirst },
    user: { findUnique: mocks.userFindUnique },
  },
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock("~/lib/services/sessionVersionService", () => ({
  createSessionVersionInTransaction: mocks.createVersion,
}));

import { POST } from "./route";

const call = (body: unknown = {}) =>
  (POST as any)(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId: "8" }) }
  );

describe("POST /api/sessions/[sessionId]/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateRequest.mockResolvedValue({
      authenticated: true,
      user: { userId: "token-user", access: "USER" },
    });
    mocks.sessionsFindFirst.mockResolvedValue({ projectId: 3 });
    mocks.projectsFindFirst.mockResolvedValue({ id: 3 });
    mocks.userCanAddEditArea.mockResolvedValue(true);
    mocks.userFindUnique.mockResolvedValue({ name: "Agent", email: "a@x" });
    mocks.createVersion.mockResolvedValue({ id: 40, version: 2 });
  });

  it("records a bumped snapshot for an API token", async () => {
    const res = await call({ bumpVersion: true });

    expect(res.status).toBe(200);
    expect((await res.json()).version).toEqual({ id: 40, version: 2 });
    expect(mocks.createVersion).toHaveBeenCalledWith({}, 8, {
      bumpVersion: true,
      actor: { id: "token-user", name: "Agent" },
    });
  });

  it("requires add/edit on sessions", async () => {
    mocks.userCanAddEditArea.mockResolvedValue(false);
    const res = await call();

    expect(res.status).toBe(403);
    expect(mocks.userCanAddEditArea).toHaveBeenCalledWith(
      "token-user",
      3,
      "Sessions",
      "USER"
    );
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });

  it("answers 404 for a session the caller cannot see or that is trashed", async () => {
    mocks.sessionsFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(mocks.createVersion).not.toHaveBeenCalled();
  });
});
