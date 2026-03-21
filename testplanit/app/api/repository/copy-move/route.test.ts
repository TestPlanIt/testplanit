import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockGetServerSession,
  mockEnhance,
  mockPrismaUserFindUnique,
  mockGetCopyMoveQueue,
  mockGetCurrentTenantId,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockEnhance: vi.fn(),
  mockPrismaUserFindUnique: vi.fn(),
  mockGetCopyMoveQueue: vi.fn(),
  mockGetCurrentTenantId: vi.fn(),
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
  },
}));

// ─── Mock server/db and server/auth ──────────────────────────────────────────

vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

// ─── Mock queues ──────────────────────────────────────────────────────────────

vi.mock("~/lib/queues", () => ({
  getCopyMoveQueue: (...args: any[]) => mockGetCopyMoveQueue(...args),
}));

// ─── Mock multiTenantPrisma ───────────────────────────────────────────────────

vi.mock("@/lib/multiTenantPrisma", () => ({
  getCurrentTenantId: (...args: any[]) => mockGetCurrentTenantId(...args),
}));

// ─── Mock queue add ───────────────────────────────────────────────────────────

const mockQueueAdd = vi.fn();
const mockQueue = { add: mockQueueAdd };

// ─── Mock enhanced DB ─────────────────────────────────────────────────────────

const mockEnhancedDb = {
  projects: { findFirst: vi.fn() },
  repositoryCases: { findFirst: vi.fn(), findMany: vi.fn() },
  templateProjectAssignment: { findMany: vi.fn(), create: vi.fn() },
  projectWorkflowAssignment: { findMany: vi.fn() },
  repositories: { findFirst: vi.fn() },
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseSession = { user: { id: "user-1" } };

const baseUser = {
  id: "user-1",
  access: "ADMIN",
  role: { rolePermissions: [] },
};

const validBody = {
  operation: "copy",
  caseIds: [1, 2],
  sourceProjectId: 10,
  targetProjectId: 20,
  targetFolderId: 5,
  conflictResolution: "skip",
  sharedStepGroupResolution: "reuse",
  autoAssignTemplates: false,
};

const baseTargetTemplateAssignments = [{ templateId: 10, projectId: 20 }];

const baseTargetWorkflowAssignments = [
  {
    workflowId: 100,
    workflow: { id: 100, name: "Not Started", isDefault: true },
  },
];

const baseTargetRepository = { id: 200 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/repository/copy-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupDefaultMocks(opts?: { userAccess?: string }) {
  mockGetServerSession.mockResolvedValue(baseSession);
  mockPrismaUserFindUnique.mockResolvedValue({
    ...baseUser,
    access: opts?.userAccess ?? "ADMIN",
  });
  mockEnhance.mockReturnValue(mockEnhancedDb);
  mockGetCopyMoveQueue.mockReturnValue(mockQueue);
  mockGetCurrentTenantId.mockReturnValue("tenant-1");
  mockQueueAdd.mockResolvedValue({ id: "job-123" });

  // source and target project access
  mockEnhancedDb.projects.findFirst
    .mockResolvedValueOnce({ id: 10 }) // source
    .mockResolvedValueOnce({ id: 20 }); // target

  // move delete check (not called for copy)
  mockEnhancedDb.repositoryCases.findFirst.mockResolvedValue({ id: 1 });

  // repositoryCases.findMany for source case template IDs (auto-assign logic)
  mockEnhancedDb.repositoryCases.findMany.mockResolvedValue([
    { templateId: 10 },
  ]);

  // templateProjectAssignment
  mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue(
    baseTargetTemplateAssignments,
  );
  mockEnhancedDb.templateProjectAssignment.create.mockResolvedValue({});

  // workflow assignments
  mockEnhancedDb.projectWorkflowAssignment.findMany.mockResolvedValue(
    baseTargetWorkflowAssignments,
  );

  // repository
  mockEnhancedDb.repositories.findFirst.mockResolvedValue(baseTargetRepository);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/repository/copy-move", () => {
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
  it("returns 400 when request body fails Zod validation (missing required fields)", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ operation: "copy" })); // missing required fields
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  // Test 3
  it("returns 400 when conflictResolution is 'overwrite' (not accepted by schema)", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ ...validBody, conflictResolution: "overwrite" }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  // Test 4
  it("returns 503 when queue is unavailable", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockGetCopyMoveQueue.mockReturnValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toMatch(/queue/i);
  });

  // Test 5
  it("returns 403 when user cannot read source project", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockPrismaUserFindUnique.mockResolvedValue(baseUser);
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockGetCopyMoveQueue.mockReturnValue(mockQueue);
    mockEnhancedDb.projects.findFirst.mockResolvedValue(null); // source not found
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/source/i);
  });

  // Test 6
  it("returns 403 when user cannot access target project", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    mockPrismaUserFindUnique.mockResolvedValue(baseUser);
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockGetCopyMoveQueue.mockReturnValue(mockQueue);
    mockEnhancedDb.projects.findFirst
      .mockResolvedValueOnce({ id: 10 }) // source found
      .mockResolvedValueOnce(null); // target not found
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/target/i);
  });

  // Test 7
  it("returns 403 when move operation and user lacks source update access", async () => {
    mockGetServerSession.mockResolvedValue(baseSession);
    // User without canAddEdit on TestCaseRepository
    mockPrismaUserFindUnique.mockResolvedValue({
      ...baseUser,
      access: "USER",
      role: { rolePermissions: [{ area: "TestCaseRepository", canAddEdit: false, canDelete: false, canClose: false }] },
    });
    mockEnhance.mockReturnValue(mockEnhancedDb);
    mockGetCopyMoveQueue.mockReturnValue(mockQueue);
    mockEnhancedDb.projects.findFirst
      .mockResolvedValueOnce({ id: 10 }) // source
      .mockResolvedValueOnce({ id: 20 }); // target
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ ...validBody, operation: "move" }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/update/i);
  });

  // Test 8
  it("creates TemplateProjectAssignment records when autoAssignTemplates=true and user.access === ADMIN", async () => {
    setupDefaultMocks({ userAccess: "ADMIN" });
    // Source cases use templateId 99, not in target
    mockEnhancedDb.repositoryCases.findMany.mockResolvedValue([
      { templateId: 99 },
    ]);
    // First findMany call returns [] (no existing assignments), second call (resolve targetTemplateId) also returns []
    // Provide targetTemplateId in body to bypass the resolve step
    mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue([]);
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...validBody,
        autoAssignTemplates: true,
        targetTemplateId: 99,
        targetRepositoryId: 200,
        targetDefaultWorkflowStateId: 100,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockEnhancedDb.templateProjectAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateId: 99,
          projectId: 20,
        }),
      }),
    );
    const data = await res.json();
    expect(data.jobId).toBe("job-123");
  });

  // Test 9
  it("creates TemplateProjectAssignment records when autoAssignTemplates=true and user.access === PROJECTADMIN", async () => {
    setupDefaultMocks({ userAccess: "PROJECTADMIN" });
    mockEnhancedDb.repositoryCases.findMany.mockResolvedValue([
      { templateId: 88 },
    ]);
    mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue([]);
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...validBody,
        autoAssignTemplates: true,
        targetTemplateId: 88,
        targetRepositoryId: 200,
        targetDefaultWorkflowStateId: 100,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockEnhancedDb.templateProjectAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateId: 88,
          projectId: 20,
        }),
      }),
    );
  });

  // Test 10
  it("does NOT create TemplateProjectAssignment when user has no admin role (regular user - silently skips)", async () => {
    setupDefaultMocks({ userAccess: "USER" });
    mockEnhancedDb.repositoryCases.findMany.mockResolvedValue([
      { templateId: 77 },
    ]);
    mockEnhancedDb.templateProjectAssignment.findMany.mockResolvedValue([]);
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        ...validBody,
        autoAssignTemplates: true,
        targetTemplateId: 77,
        targetRepositoryId: 200,
        targetDefaultWorkflowStateId: 100,
      }),
    );
    expect(res.status).toBe(200);
    expect(
      mockEnhancedDb.templateProjectAssignment.create,
    ).not.toHaveBeenCalled();
    const data = await res.json();
    expect(data.jobId).toBeDefined();
  });

  // Test 11
  it("resolves targetRepositoryId from target project's active repository when not provided", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    // body does NOT include targetRepositoryId
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockEnhancedDb.repositories.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 20,
          isActive: true,
          isDeleted: false,
        }),
      }),
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "copy-move",
      expect.objectContaining({ targetRepositoryId: 200 }),
    );
  });

  // Test 12
  it("resolves targetDefaultWorkflowStateId from target project's default workflow when not provided", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "copy-move",
      expect.objectContaining({ targetDefaultWorkflowStateId: 100 }),
    );
  });

  // Test 13
  it("resolves targetTemplateId from target project's first template assignment when not provided", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "copy-move",
      expect.objectContaining({ targetTemplateId: 10 }),
    );
  });

  // Test 14
  it("enqueues job with correct CopyMoveJobData shape including userId and tenantId", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "copy-move",
      expect.objectContaining({
        operation: "copy",
        caseIds: [1, 2],
        sourceProjectId: 10,
        targetProjectId: 20,
        targetFolderId: 5,
        conflictResolution: "skip",
        sharedStepGroupResolution: "reuse",
        userId: "user-1",
        tenantId: "tenant-1",
        targetRepositoryId: 200,
        targetDefaultWorkflowStateId: 100,
        targetTemplateId: 10,
      }),
    );
  });

  // Test 15
  it("returns { jobId: '...' } on success", async () => {
    setupDefaultMocks();
    const { POST } = await import("./route");
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.jobId).toBe("job-123");
  });
});
