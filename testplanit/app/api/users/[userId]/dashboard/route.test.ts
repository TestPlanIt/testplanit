import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockStatusFindFirst,
  mockUserFindUnique,
  mockQueryRaw,
  mockResolveAccessibleProjectIds,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockStatusFindFirst: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockResolveAccessibleProjectIds: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/db", () => ({
  baseDb: {
    status: {
      findFirst: (...args: any[]) => mockStatusFindFirst(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
  },
}));

vi.mock("~/lib/authContext", () => ({
  resolveAccessibleProjectIds: (...args: any[]) =>
    mockResolveAccessibleProjectIds(...args),
}));

import { GET } from "./route";

const TARGET_USER_ID = "target-user";

const runCaseRow = (projectId: number, id: number) => ({
  id,
  repositoryCaseId: id,
  testRunId: 100 + projectId,
  latestResultStatusId: null,
  latestResultIsCompleted: null,
  caseName: `Case ${id}`,
  caseEstimate: 60,
  caseForecastManual: null,
  caseForecastAutomated: null,
  runName: `Run ${projectId}`,
  runIsCompleted: false,
  runForecastManual: null,
  runForecastAutomated: null,
  projectId,
  projectName: `Project ${projectId}`,
});

const sessionRow = (projectId: number, id: number) => ({
  id,
  name: `Session ${id}`,
  estimate: 3600,
  forecastManual: null,
  forecastAutomated: null,
  projectId,
  projectName: `Project ${projectId}`,
  totalElapsed: 600,
});

function callRoute(userId = TARGET_USER_ID) {
  return GET({} as NextRequest, { params: Promise.resolve({ userId }) });
}

describe("GET /api/users/[userId]/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusFindFirst.mockResolvedValue({ id: 10 });
    mockQueryRaw
      .mockResolvedValueOnce([runCaseRow(1, 1), runCaseRow(2, 2)])
      .mockResolvedValueOnce([sessionRow(1, 7), sessionRow(2, 8)]);
  });

  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await callRoute();

    expect(res.status).toBe(401);
  });

  it("returns 403 when a regular user requests someone else's dashboard", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "viewer" } });
    mockUserFindUnique.mockResolvedValue({ access: "USER", roleId: 1 });

    const res = await callRoute();

    expect(res.status).toBe(403);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("returns full data for the user's own dashboard without a viewer lookup", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: TARGET_USER_ID } });

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(body.testRunCasesAssigned).toHaveLength(2);
    expect(body.assignedSessions).toHaveLength(2);
  });

  it("returns full data to an ADMIN viewer", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "admin-viewer" } });
    mockUserFindUnique.mockResolvedValue({ access: "ADMIN", roleId: 1 });

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResolveAccessibleProjectIds).not.toHaveBeenCalled();
    expect(body.testRunCasesAssigned).toHaveLength(2);
    expect(body.assignedSessions).toHaveLength(2);
  });

  it("scopes a PROJECTADMIN viewer to their accessible projects", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "pa-viewer" } });
    mockUserFindUnique.mockResolvedValue({ access: "PROJECTADMIN", roleId: 2 });
    mockResolveAccessibleProjectIds.mockResolvedValue([1]);

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResolveAccessibleProjectIds).toHaveBeenCalledWith({
      id: "pa-viewer",
      access: "PROJECTADMIN",
      roleId: 2,
    });
    expect(body.testRunCasesAssigned).toHaveLength(1);
    expect(body.testRunCasesAssigned[0].projectId).toBe(1);
    expect(body.assignedSessions).toHaveLength(1);
    expect(body.assignedSessions[0].projectId).toBe(1);
  });

  it("returns empty lists for a PROJECTADMIN with no shared projects", async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: "pa-viewer" } });
    mockUserFindUnique.mockResolvedValue({ access: "PROJECTADMIN", roleId: 2 });
    mockResolveAccessibleProjectIds.mockResolvedValue([]);

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.testRunCasesAssigned).toHaveLength(0);
    expect(body.assignedSessions).toHaveLength(0);
  });
});
