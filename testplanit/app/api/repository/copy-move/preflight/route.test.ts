import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockGetServerSession,
  mockEnhance,
  mockDbUserFindUnique,
  mockDbRepositoryCasesFindMany,
  mockDbProjectsFindFirst,
  mockDbTemplateProjectAssignmentFindMany,
  mockDbTemplatesFindMany,
  mockDbProjectWorkflowAssignmentFindMany,
  mockDbRepositoriesFindFirst,
  mockDbWorkflowsFindMany,
  mockDbAppConfigFindUnique,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockEnhance: vi.fn(),
  mockDbUserFindUnique: vi.fn(),
  mockDbRepositoryCasesFindMany: vi.fn(),
  mockDbProjectsFindFirst: vi.fn(),
  mockDbTemplateProjectAssignmentFindMany: vi.fn(),
  mockDbTemplatesFindMany: vi.fn(),
  mockDbProjectWorkflowAssignmentFindMany: vi.fn(),
  mockDbRepositoriesFindFirst: vi.fn(),
  mockDbWorkflowsFindMany: vi.fn(),
  mockDbAppConfigFindUnique: vi.fn(),
}));

// ─── Mock next-auth ───────────────────────────────────────────────────────────

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// ─── Mock ZenStack getAuthDb ────────────────────────────────────────────────────

vi.mock("~/lib/zenstack", () => ({
  getAuthDb: (...args: any[]) => mockEnhance(...args),
}));

// ─── Mock baseDb ──────────────────────────────────────────────────────────────

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: {
      findUnique: (...args: any[]) => mockDbUserFindUnique(...args),
    },
    projects: {
      findFirst: (...args: any[]) => mockDbProjectsFindFirst(...args),
    },
    repositoryCases: {
      findMany: (...args: any[]) => mockDbRepositoryCasesFindMany(...args),
    },
    templateProjectAssignment: {
      findMany: (...args: any[]) =>
        mockDbTemplateProjectAssignmentFindMany(...args),
    },
    templates: {
      findMany: (...args: any[]) => mockDbTemplatesFindMany(...args),
    },
    projectWorkflowAssignment: {
      findMany: (...args: any[]) =>
        mockDbProjectWorkflowAssignmentFindMany(...args),
    },
    repositories: {
      findFirst: (...args: any[]) => mockDbRepositoriesFindFirst(...args),
    },
    // Source-state name resolution reads the workflows table directly.
    workflows: {
      findMany: (...args: any[]) => mockDbWorkflowsFindMany(...args),
    },
    // Review-gate feature flag (default-off in tests).
    appConfig: {
      findUnique: (...args: any[]) => mockDbAppConfigFindUnique(...args),
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
  workflows: { findMany: vi.fn() },
  appConfig: { findUnique: vi.fn() },
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

const baseSourceWorkflowStates = [{ id: 100, name: "Not Started" }];

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
  mockDbUserFindUnique.mockResolvedValue(baseUser);
  mockEnhance.mockReturnValue(mockEnhancedDb);

  // Admin path uses raw baseDb; non-admin uses enhancedDb. Seed both so
  // tests work regardless of which user.access the test sets.
  mockDbProjectsFindFirst
    .mockResolvedValueOnce({ id: 10 }) // source
    .mockResolvedValueOnce({ id: 20 }); // target
  mockEnhancedDb.projects.findFirst
    .mockResolvedValueOnce({ id: 10 })
    .mockResolvedValueOnce({ id: 20 });

  // Source cases first, then collision check (both via reader).
  mockDbRepositoryCasesFindMany
    .mockResolvedValueOnce(baseSourceCases)
    .mockResolvedValueOnce([]);
  mockEnhancedDb.repositoryCases.findMany
    .mockResolvedValueOnce(baseSourceCases)
    .mockResolvedValueOnce([]);

  mockDbTemplateProjectAssignmentFindMany.mockResolvedValue(
    baseTargetTemplateAssignments
  );
  mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue(
    baseTargetTemplateAssignments
  );

  mockDbProjectWorkflowAssignmentFindMany.mockResolvedValue(
    baseTargetWorkflowAssignments
  );
  mockEnhancedDb.projectWorkflowAssignment.findMany.mockResolvedValue(
    baseTargetWorkflowAssignments
  );

  mockDbRepositoriesFindFirst.mockResolvedValue(baseTargetRepository);
  mockEnhancedDb.repositories.findFirst.mockResolvedValue(baseTargetRepository);

  mockDbTemplatesFindMany.mockResolvedValue([]);
  mockEnhancedDb.templates.findMany.mockResolvedValue([]);

  // Source-state names resolve from the workflows table by id.
  mockDbWorkflowsFindMany.mockResolvedValue(baseSourceWorkflowStates);
  mockEnhancedDb.workflows.findMany.mockResolvedValue(baseSourceWorkflowStates);
  // Review feature flag row absent -> gate disabled.
  mockDbAppConfigFindUnique.mockResolvedValue(null);
  mockEnhancedDb.appConfig.findUnique.mockResolvedValue(null);
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
  it("returns 403 when user cannot read source project (non-admin)", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockDbUserFindUnique.mockResolvedValue({ ...baseUser, access: "USER" });
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockEnhancedDb.projects.findFirst.mockResolvedValue(null); // source not found
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/source/i);
  });

  // Test 4
  it("returns 403 when user cannot access target project (non-admin)", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockDbUserFindUnique.mockResolvedValue({ ...baseUser, access: "USER" });
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

  // Test 3b — admin path uses raw baseDb; verify same denial behaviour.
  it("returns 403 when admin source project missing/deleted", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockDbUserFindUnique.mockResolvedValue(baseUser); // ADMIN
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockDbProjectsFindFirst.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/source/i);
  });

  // Test 5
  it("returns templateMismatch=true and missingTemplates array when source template not assigned to target", async () => {
    setupDefaultMocks();
    // Override: source case uses templateId 99 which is not in target assignments
    mockDbRepositoryCasesFindMany
      .mockReset()
      .mockResolvedValueOnce([{ ...baseSourceCases[0], templateId: 99 }])
      .mockResolvedValueOnce([]); // collision check
    mockDbTemplateProjectAssignmentFindMany.mockResolvedValue([
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
    mockDbUserFindUnique.mockResolvedValue({
      ...baseUser,
      access: "ADMIN",
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canAutoAssignTemplates).toBe(true);
  });

  // Test 8
  it("returns canAutoAssignTemplates=true when user.access === PROJECTADMIN", async () => {
    setupDefaultMocks();
    mockDbUserFindUnique.mockResolvedValue({
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
    mockDbUserFindUnique.mockResolvedValue({ ...baseUser, access: "USER" });
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
      (m: any) => m.sourceStateId === 100
    );
    expect(mapping).toBeDefined();
    expect(mapping.targetStateId).toBe(100);
    expect(mapping.isDefaultFallback).toBe(false);
  });

  // Test 11
  it("returns workflowMappings with isDefaultFallback=true when state name not found in target", async () => {
    setupDefaultMocks();
    // Source case has a state "Custom State" (id=999) not in target workflow
    mockDbRepositoryCasesFindMany
      .mockReset()
      .mockResolvedValueOnce([{ ...baseSourceCases[0], stateId: 999 }])
      .mockResolvedValueOnce([]); // collision check

    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    const mapping = data.workflowMappings.find(
      (m: any) => m.sourceStateId === 999
    );
    expect(mapping).toBeDefined();
    expect(mapping.isDefaultFallback).toBe(true);
  });

  // Test 12
  it("returns unmappedStates list for states that fell back to default", async () => {
    setupDefaultMocks();
    mockDbRepositoryCasesFindMany
      .mockReset()
      .mockResolvedValueOnce([{ ...baseSourceCases[0], stateId: 999 }])
      .mockResolvedValueOnce([]); // collision check

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
    // Admin path: both source cases and collision check go through baseDb.
    mockDbRepositoryCasesFindMany
      .mockReset()
      .mockResolvedValueOnce(baseSourceCases) // source cases
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

  it("SELF-COLLISION: same-project move short-circuits with nothing to report", async () => {
    // A same-project move only relocates rows, so preflight has nothing to
    // preview: no collision query, no template/workflow warnings, and no
    // target repository/template/state context (a relocation reads none of
    // it). A case cannot conflict with itself.
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        operation: "move",
        caseIds: [1, 2],
        sourceProjectId: 10,
        targetProjectId: 10,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.collisions).toHaveLength(0);
    expect(data.workflowMappings).toHaveLength(0);
    expect(data.templateMismatch).toBe(false);
    expect(data.targetRepositoryId).toBeUndefined();
    expect(data.targetDefaultWorkflowStateId).toBeUndefined();
    expect(data.targetTemplateId).toBeUndefined();

    // The short-circuit answers before any case rows are read.
    expect(mockDbRepositoryCasesFindMany).not.toHaveBeenCalled();
  });

  it("SELF-COLLISION: does NOT scope the collision query out of source ids on copy", async () => {
    // For copy the source rows are real collision targets — the unique
    // (projectId, name, className, source) constraint would block.
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);

    const collisionCall = mockDbRepositoryCasesFindMany.mock.calls[1]?.[0];
    expect(collisionCall?.where?.id).toBeUndefined();
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
    mockDbUserFindUnique.mockResolvedValue({
      id: "user-1",
      access: "USER",
      role: {
        rolePermissions: [
          {
            area: "TestCaseRepository",
            canAddEdit: false,
            canDelete: false,
            canClose: false,
          },
        ],
      },
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ ...validBody, operation: "move" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasSourceUpdateAccess).toBe(false);
  });
});
