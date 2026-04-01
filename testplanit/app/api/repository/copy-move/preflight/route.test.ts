import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockGetServerSession,
  mockEnhance,
  mockPrismaUserFindUnique,
  mockPrismaRepositoryCasesFindMany,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockEnhance: vi.fn(),
  mockPrismaUserFindUnique: vi.fn(),
  mockPrismaRepositoryCasesFindMany: vi.fn(),
}));

// ─── Mock next-auth ───────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ─── Mock ZenStack enhance ────────────────────────────────────────────────────

vi.mock("@zenstackhq/runtime", () => ({
  enhance: (...args: any[]) => mockEnhance(...args),
}));

// ─── Mock prisma ──────────────────────────────────────────────────────────────

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: any[]) => mockPrismaUserFindUnique(...args),
    },
    repositoryCases: {
      findMany: (...args: any[]) => mockPrismaRepositoryCasesFindMany(...args),
    },
  },
}));

// ─── Mock server/db and server/auth ──────────────────────────────────────────

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

// ─── Mock enhanced DB ─────────────────────────────────────────────────────────

const mockEnhancedDb = {
  projects: { findFirst: vi.fn() },
  templateProjectAssignment: { findMany: vi.fn() },
  repositoryCases: { findMany: vi.fn(), findFirst: vi.fn() },
  projectWorkflowAssignment: { findMany: vi.fn() },
  repositories: { findFirst: vi.fn() },
  templates: { findMany: vi.fn() },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseSession = { user: { id: "user-1" } };

const baseUser = {
  id: "user-1",
  access: "ADMIN",
  role: { rolePermissions: [] },
};

const baseSourceCases = [
  {
    id: 1,
    name: "Test Case 1",
    className: null,
    source: "MANUAL",
    templateId: 10,
    stateId: 100,
  },
];

const baseTargetTemplateAssignments = [
  { templateId: 10, template: { id: 10, name: "Default Template" } },
];

const baseTargetWorkflowAssignments = [
  {
    workflowId: 100,
    workflow: { id: 100, name: "Not Started", isDefault: true },
  },
  {
    workflowId: 101,
    workflow: { id: 101, name: "In Progress", isDefault: false },
  },
];

const _baseSourceWorkflowStates = [
  { id: 100, name: "Not Started" },
];

const baseTargetRepository = { id: 200 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/repository/copy-move/preflight", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  operation: "copy",
  caseIds: [1],
  sourceProjectId: 10,
  targetProjectId: 20,
};

function setupDefaultMocks() {
  mockGetServerSession.mockResolvedValue(baseSession);
  mockPrismaUserFindUnique.mockResolvedValue(baseUser);
  mockEnhance.mockReturnValue(mockEnhancedDb);

  mockEnhancedDb.projects.findFirst
    .mockResolvedValueOnce({ id: 10 }) // source
    .mockResolvedValueOnce({ id: 20 }); // target

  mockEnhancedDb.repositoryCases.findMany
    .mockResolvedValueOnce(baseSourceCases); // source cases (via enhancedDb)

  mockPrismaRepositoryCasesFindMany
    .mockResolvedValueOnce([]); // collision check (via prisma, no collisions by default)

  mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue(
    baseTargetTemplateAssignments,
  );

  mockEnhancedDb.projectWorkflowAssignment.findMany.mockResolvedValue(
    baseTargetWorkflowAssignments,
  );

  mockEnhancedDb.repositories.findFirst.mockResolvedValue(
    baseTargetRepository,
  );

  mockEnhancedDb.templates.findMany.mockResolvedValue([]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/repository/copy-move/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1
  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  // Test 2
  it("returns 400 when request body fails Zod validation", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ operation: "copy" })); // missing caseIds, sourceProjectId, targetProjectId
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  // Test 3
  it("returns 403 when user cannot read source project", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockPrismaUserFindUnique.mockResolvedValue(baseUser);
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockEnhancedDb.projects.findFirst.mockResolvedValue(null); // source not found
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/source/i);
  });

  // Test 4
  it("returns 403 when user cannot access target project", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockPrismaUserFindUnique.mockResolvedValue(baseUser);
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockEnhancedDb.projects.findFirst
      .mockResolvedValueOnce({ id: 10 }) // source found
      .mockResolvedValueOnce(null); // target not found
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/target/i);
  });

  // Test 5
  it("returns templateMismatch=true and missingTemplates array when source template not assigned to target", async () => {
    setupDefaultMocks();
    // Override: source case uses templateId 99 which is not in target assignments
    mockEnhancedDb.repositoryCases.findMany
      .mockReset()
      .mockResolvedValue([
        { ...baseSourceCases[0], templateId: 99 },
      ]);
    mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue([
      { templateId: 10, template: { id: 10, name: "Default Template" } },
    ]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templateMismatch).toBe(true);
    expect(data.missingTemplates.length).toBeGreaterThan(0);
  });

  // Test 6
  it("returns templateMismatch=false when all source templates are assigned to target", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templateMismatch).toBe(false);
    expect(data.missingTemplates).toHaveLength(0);
  });

  // Test 7
  it("returns canAutoAssignTemplates=true when user.access === ADMIN", async () => {
    setupDefaultMocks();
    mockPrismaUserFindUnique.mockResolvedValue({ ...baseUser, access: "ADMIN" });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canAutoAssignTemplates).toBe(true);
  });

  // Test 8
  it("returns canAutoAssignTemplates=true when user.access === PROJECTADMIN", async () => {
    setupDefaultMocks();
    mockPrismaUserFindUnique.mockResolvedValue({
      ...baseUser,
      access: "PROJECTADMIN",
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canAutoAssignTemplates).toBe(true);
  });

  // Test 9
  it("returns canAutoAssignTemplates=false when user.access is USER", async () => {
    setupDefaultMocks();
    mockPrismaUserFindUnique.mockResolvedValue({ ...baseUser, access: "USER" });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canAutoAssignTemplates).toBe(false);
  });

  // Test 10
  it("returns workflowMappings with name-matched targetStateId when target has same-name state", async () => {
    setupDefaultMocks();
    // Source case uses stateId 100 "Not Started", target also has "Not Started" id=100
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    const mapping = data.workflowMappings.find(
      (m: any) => m.sourceStateId === 100,
    );
    expect(mapping).toBeDefined();
    expect(mapping.targetStateId).toBe(100);
    expect(mapping.isDefaultFallback).toBe(false);
  });

  // Test 11
  it("returns workflowMappings with isDefaultFallback=true when state name not found in target", async () => {
    setupDefaultMocks();
    // Source case has a state "Custom State" (id=999) not in target workflow
    mockEnhancedDb.repositoryCases.findMany
      .mockReset()
      .mockResolvedValue([
        { ...baseSourceCases[0], stateId: 999 },
      ]);

    // We need to also mock to return workflow state name for source
    // The route fetches source workflow states separately — let's provide that info
    // via source cases: we need a way to get state names. Let's check what the route does.
    // Per plan: route uses projectWorkflowAssignment for target, and needs source state names.
    // Source state names need to come from somewhere — the route queries source workflow states.
    // For this test, we'll need projectWorkflowAssignment for source project too.

    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    const mapping = data.workflowMappings.find(
      (m: any) => m.sourceStateId === 999,
    );
    expect(mapping).toBeDefined();
    expect(mapping.isDefaultFallback).toBe(true);
  });

  // Test 12
  it("returns unmappedStates list for states that fell back to default", async () => {
    setupDefaultMocks();
    mockEnhancedDb.repositoryCases.findMany
      .mockReset()
      .mockResolvedValue([
        { ...baseSourceCases[0], stateId: 999 },
      ]);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unmappedStates.length).toBeGreaterThan(0);
    const unmapped = data.unmappedStates.find((s: any) => s.id === 999);
    expect(unmapped).toBeDefined();
  });

  // Test 13
  it("returns collisions array when target has cases with matching name/className/source", async () => {
    setupDefaultMocks();
    // Override: source cases via enhancedDb, collision check via prisma
    mockEnhancedDb.repositoryCases.findMany
      .mockReset()
      .mockResolvedValueOnce(baseSourceCases); // source cases
    mockPrismaRepositoryCasesFindMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: 99,
          name: "Test Case 1",
          className: null,
          source: "MANUAL",
        },
      ]); // collision check

    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.collisions).toHaveLength(1);
    expect(data.collisions[0].caseName).toBe("Test Case 1");
    expect(data.collisions[0].caseId).toBe(99);
  });

  // Test 14
  it("returns empty collisions when no name conflicts", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.collisions).toHaveLength(0);
  });

  // Test 15
  it("returns targetRepositoryId resolved from active repository in target project", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.targetRepositoryId).toBe(200);
  });

  // Test 16
  it("checks hasSourceUpdateAccess for move operation — non-admin without canAddEdit", async () => {
    setupDefaultMocks();
    // User without canAddEdit on TestCaseRepository
    mockPrismaUserFindUnique.mockResolvedValue({
      id: "user-1",
      access: "USER",
      role: { rolePermissions: [{ area: "TestCaseRepository", canAddEdit: false, canDelete: false, canClose: false }] },
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ ...validBody, operation: "move" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasSourceUpdateAccess).toBe(false);
  });
});
