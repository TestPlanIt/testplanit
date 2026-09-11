// Route tests for traceability snapshot capture. Harness mirrors the
// sibling requirement routes (same session/audit mocks); the capture
// service is stubbed so the assertions are about the GATE ORDER and the
// exact input the route hands the service — the service's own tests
// cover what gets written.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));
vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));
vi.mock("~/lib/services/areaPermission", () => ({
  userHasAreaPermission: vi.fn(),
}));
vi.mock("~/lib/services/requirementTraceabilitySnapshot", () => ({
  captureRequirementTraceabilitySnapshot: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
// Unmocked on purpose: the scope fold is the seam under test, so the route
// must agree with the real shared parser, not with a stub of it.
import {
  MAX_EXECUTION_SCOPE_IDS,
  toExecutionScope,
} from "~/lib/services/executionScopeParam";
import { captureRequirementTraceabilitySnapshot } from "~/lib/services/requirementTraceabilitySnapshot";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedPermission = userHasAreaPermission as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCapture =
  captureRequirementTraceabilitySnapshot as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/requirements/snapshots",
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

const params = (projectId = "5") => ({
  params: Promise.resolve({ projectId }),
});

const capturedHeader = {
  id: 42,
  projectId: 5,
  name: "Release 2.4 sign-off",
  note: null,
  capturedById: "user-1",
  capturedAt: new Date("2026-09-01T12:00:00.000Z"),
  scopeRequirementIds: [],
  requirementCount: 3,
  passedCount: 1,
  failedCount: 0,
  notRunCount: 1,
  uncoveredCount: 1,
  caseLinkCount: 4,
};

describe("POST /api/projects/[projectId]/requirements/snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    mockedScope.mockResolvedValue([5, 6]);
    mockedPermission.mockResolvedValue(true);
    mockedCapture.mockResolvedValue(capturedHeader);
  });

  it("401s without a session before anything else", async () => {
    mockedSession.mockResolvedValue(null);
    const response = await POST(makeRequest({ name: "x" }), params());
    expect(response.status).toBe(401);
    expect(mockedScope).not.toHaveBeenCalled();
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("400s a non-numeric project id", async () => {
    const response = await POST(makeRequest({ name: "x" }), params("abc"));
    expect(response.status).toBe(400);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("400s a body without a name, a blank name, or unknown keys", async () => {
    expect((await POST(makeRequest({}), params())).status).toBe(400);
    expect((await POST(makeRequest({ name: "   " }), params())).status).toBe(
      400
    );
    expect(
      (await POST(makeRequest({ name: "ok", extra: 1 }), params())).status
    ).toBe(400);
    expect((await POST(makeRequest(), params())).status).toBe(400);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("403s when the viewer's project scope excludes the project", async () => {
    mockedScope.mockResolvedValue([6]);
    const response = await POST(makeRequest({ name: "x" }), params());
    expect(response.status).toBe(403);
    expect(mockedPermission).not.toHaveBeenCalled();
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("403s without Reporting add/edit on the project", async () => {
    mockedPermission.mockResolvedValue(false);
    const response = await POST(makeRequest({ name: "x" }), params());
    expect(response.status).toBe(403);
    expect(mockedPermission).toHaveBeenCalledWith(
      "user-1",
      5,
      "Reporting",
      "canAddEdit"
    );
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("captures under the SAME resolved scope it gated on and returns 201 with the header", async () => {
    const response = await POST(
      makeRequest({ name: "  Release 2.4 sign-off  ", note: "  evidence " }),
      params()
    );
    expect(response.status).toBe(201);
    expect(mockedCapture).toHaveBeenCalledWith(
      {
        projectId: 5,
        name: "Release 2.4 sign-off",
        note: "  evidence ",
        rootIds: undefined,
        capturedById: "user-1",
      },
      { accessibleProjectIds: [5, 6] }
    );
    const json = await response.json();
    expect(json).toMatchObject({ id: 42, name: "Release 2.4 sign-off" });
  });

  it("passes a non-empty requirementIds scope as rootIds and treats null/empty as whole-project", async () => {
    await POST(
      makeRequest({ name: "x", requirementIds: [4451, 12] }),
      params()
    );
    expect(mockedCapture.mock.calls[0][0].rootIds).toEqual([4451, 12]);

    mockedCapture.mockClear();
    await POST(makeRequest({ name: "x", requirementIds: [] }), params());
    expect(mockedCapture.mock.calls[0][0].rootIds).toBeUndefined();

    mockedCapture.mockClear();
    await POST(makeRequest({ name: "x", requirementIds: null }), params());
    expect(mockedCapture.mock.calls[0][0].rootIds).toBeUndefined();
  });

  it("lets an unrestricted (ADMIN) scope through as null", async () => {
    mockedScope.mockResolvedValue(null);
    const response = await POST(makeRequest({ name: "x" }), params());
    expect(response.status).toBe(201);
    expect(mockedCapture.mock.calls[0][1]).toEqual({
      accessibleProjectIds: null,
    });
  });

  it("500s with a generic body when the capture throws", async () => {
    mockedCapture.mockRejectedValue(new Error("boom"));
    const response = await POST(makeRequest({ name: "x" }), params());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to capture requirement traceability snapshot",
    });
  });
});

// ---------------------------------------------------------------------------
// Execution scope (milestone/configuration). The route folds the two body
// keys through the shared `toExecutionScope`, so the frame a capture freezes
// is parsed by exactly the module every other coverage route parses with.
// ---------------------------------------------------------------------------

describe("POST snapshots — execution scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    mockedScope.mockResolvedValue([5, 6]);
    mockedPermission.mockResolvedValue(true);
    mockedCapture.mockResolvedValue(capturedHeader);
  });

  it("threads both axes into the capture as one executionScope", async () => {
    const response = await POST(
      makeRequest({ name: "x", milestoneIds: [9, 2], configIds: [4] }),
      params()
    );

    expect(response.status).toBe(201);
    expect(mockedCapture.mock.calls[0][0].executionScope).toEqual({
      milestoneIds: [9, 2],
      configIds: [4],
    });
  });

  it("carries one active axis beside an empty one, which every consumer reads as inactive", async () => {
    const body = { milestoneIds: [9], configIds: [] };
    await POST(makeRequest({ name: "x", ...body }), params());

    // The zod path does NOT normalize an explicit `[]` to undefined the way
    // the imperative parser does; both are inert downstream
    // (`isExecutionScopeActive` / `latestCaseResultsCte` gate on length, and
    // the stored column is `?? []` either way), so the contract asserted
    // here is "whatever the shared fold produces", never a second copy of it.
    expect(mockedCapture.mock.calls[0][0].executionScope).toEqual(
      toExecutionScope(body)
    );
    expect(mockedCapture.mock.calls[0][0].executionScope.milestoneIds).toEqual([
      9,
    ]);
  });

  it.each([
    ["no scope keys at all", {}],
    ["both axes empty", { milestoneIds: [], configIds: [] }],
    ["both axes explicitly null", { milestoneIds: null, configIds: null }],
  ])("captures with NO scope when %s", async (_label, scopeKeys) => {
    const response = await POST(
      makeRequest({ name: "x", ...scopeKeys }),
      params()
    );

    expect(response.status).toBe(201);
    // Undefined, never `{ milestoneIds: [], configIds: [] }` — an empty
    // shell would mark the stored snapshot as scoped and break the changes
    // report's "same frame" check against an unscoped baseline.
    expect(mockedCapture.mock.calls[0][0].executionScope).toBeUndefined();
  });

  it.each([
    ["a bare string", { milestoneIds: "9" }],
    ["a fractional id", { milestoneIds: [1.5] }],
    ["a zero id", { configIds: [0] }],
    ["a negative id", { configIds: [-3] }],
    ["a non-numeric id", { milestoneIds: ["nine"] }],
    ["a null element", { configIds: [null] }],
  ])("400s %s on a scope axis, before the capture", async (_label, body) => {
    const response = await POST(makeRequest({ name: "x", ...body }), params());

    expect(response.status).toBe(400);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("400s an axis past the shared per-axis cap but accepts one at it", async () => {
    const atCap = Array.from(
      { length: MAX_EXECUTION_SCOPE_IDS },
      (_, i) => i + 1
    );

    const ok = await POST(
      makeRequest({ name: "x", milestoneIds: atCap }),
      params()
    );
    expect(ok.status).toBe(201);
    expect(mockedCapture.mock.calls[0][0].executionScope).toEqual({
      milestoneIds: atCap,
      configIds: undefined,
    });

    mockedCapture.mockClear();
    const tooBig = await POST(
      makeRequest({
        name: "x",
        configIds: [...atCap, MAX_EXECUTION_SCOPE_IDS + 1],
      }),
      params()
    );
    expect(tooBig.status).toBe(400);
    expect(mockedCapture).not.toHaveBeenCalled();
  });

  it("rejects a malformed scope BEFORE resolving the viewer's project scope", async () => {
    const response = await POST(
      makeRequest({ name: "x", milestoneIds: [0] }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockedScope).not.toHaveBeenCalled();
    expect(mockedPermission).not.toHaveBeenCalled();
  });

  it("folds the wire body exactly as the shared parser does", async () => {
    // Not a re-implementation of the fold: the assertion is that the route
    // hands the service whatever `toExecutionScope` says, so the snapshot's
    // frame can never drift from the reports' frame.
    const body = { milestoneIds: [9, 2], configIds: null };
    await POST(makeRequest({ name: "x", ...body }), params());

    expect(mockedCapture.mock.calls[0][0].executionScope).toEqual(
      toExecutionScope(body)
    );
  });
});
