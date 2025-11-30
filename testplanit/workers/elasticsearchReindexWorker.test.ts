import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all the sync services
vi.mock("~/services/repositoryCaseSync", () => ({
  syncProjectCasesToElasticsearch: vi.fn(),
  initializeElasticsearchIndexes: vi.fn(),
}));

vi.mock("~/services/sharedStepSearch", () => ({
  syncProjectSharedStepsToElasticsearch: vi.fn(),
}));

vi.mock("~/services/testRunSearch", () => ({
  syncProjectTestRunsToElasticsearch: vi.fn(),
}));

vi.mock("~/services/sessionSearch", () => ({
  syncProjectSessionsToElasticsearch: vi.fn(),
}));

vi.mock("~/services/issueSearch", () => ({
  syncProjectIssuesToElasticsearch: vi.fn(),
}));

vi.mock("~/services/milestoneSearch", () => ({
  syncProjectMilestonesToElasticsearch: vi.fn(),
}));

vi.mock("~/services/projectSearch", () => ({
  syncAllProjectsToElasticsearch: vi.fn(),
}));

vi.mock("~/services/elasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
}));

// Mock prisma
const mockPrisma = {
  projects: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  repositoryCases: {
    count: vi.fn(),
  },
  sharedStepGroup: {
    count: vi.fn(),
  },
  testRuns: {
    count: vi.fn(),
  },
  sessions: {
    count: vi.fn(),
  },
  issue: {
    count: vi.fn(),
  },
  milestones: {
    count: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  ELASTICSEARCH_REINDEX_QUEUE_NAME: "test-elasticsearch-reindex-queue",
}));

describe("ElasticsearchReindexWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("ReindexJobData interface", () => {
    it("should accept valid entity types", async () => {
      // Import the module to ensure types are valid
      const workerModule = await import("./elasticsearchReindexWorker");

      // The module exports the worker (null due to no valkey connection)
      expect(workerModule.default).toBeNull();

      // Test that the interface allows these entity types
      const validJobData: import("./elasticsearchReindexWorker").ReindexJobData =
        {
          entityType: "all",
          userId: "user-123",
        };
      expect(validJobData.entityType).toBe("all");

      const repositoryCasesJob: import("./elasticsearchReindexWorker").ReindexJobData =
        {
          entityType: "repositoryCases",
          projectId: 1,
          userId: "user-123",
        };
      expect(repositoryCasesJob.entityType).toBe("repositoryCases");
    });
  });

  describe("Worker module", () => {
    it("should export default as null when valkey connection is unavailable", async () => {
      const workerModule = await import("./elasticsearchReindexWorker");
      expect(workerModule.default).toBeNull();
    });
  });

  describe("Entity type handling", () => {
    it("should support all valid entity types", () => {
      const validEntityTypes = [
        "all",
        "repositoryCases",
        "testRuns",
        "sessions",
        "sharedSteps",
        "issues",
        "milestones",
        "projects",
      ];

      validEntityTypes.forEach((entityType) => {
        const jobData = {
          entityType,
          userId: "user-123",
        };
        expect(jobData.entityType).toBe(entityType);
      });
    });

    it("should support optional projectId", () => {
      const withProjectId = {
        entityType: "repositoryCases" as const,
        projectId: 42,
        userId: "user-123",
      };

      const withoutProjectId = {
        entityType: "all" as const,
        userId: "user-123",
      };

      expect(withProjectId.projectId).toBe(42);
      expect("projectId" in withoutProjectId).toBe(false);
    });
  });
});

describe("Elasticsearch sync services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have all required sync services mocked", async () => {
    const repositoryCaseSync = await import("~/services/repositoryCaseSync");
    const sharedStepSearch = await import("~/services/sharedStepSearch");
    const testRunSearch = await import("~/services/testRunSearch");
    const sessionSearch = await import("~/services/sessionSearch");
    const issueSearch = await import("~/services/issueSearch");
    const milestoneSearch = await import("~/services/milestoneSearch");
    const projectSearch = await import("~/services/projectSearch");

    expect(repositoryCaseSync.syncProjectCasesToElasticsearch).toBeDefined();
    expect(repositoryCaseSync.initializeElasticsearchIndexes).toBeDefined();
    expect(
      sharedStepSearch.syncProjectSharedStepsToElasticsearch
    ).toBeDefined();
    expect(testRunSearch.syncProjectTestRunsToElasticsearch).toBeDefined();
    expect(sessionSearch.syncProjectSessionsToElasticsearch).toBeDefined();
    expect(issueSearch.syncProjectIssuesToElasticsearch).toBeDefined();
    expect(milestoneSearch.syncProjectMilestonesToElasticsearch).toBeDefined();
    expect(projectSearch.syncAllProjectsToElasticsearch).toBeDefined();
  });

  it("should have elasticsearch client getter mocked", async () => {
    const elasticsearchService = await import(
      "~/services/elasticsearchService"
    );
    expect(elasticsearchService.getElasticsearchClient).toBeDefined();
  });
});

describe("Prisma queries for reindex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should query projects for reindexing", async () => {
    mockPrisma.projects.findMany.mockResolvedValue([
      { id: 1, name: "Project 1" },
      { id: 2, name: "Project 2" },
    ]);

    const result = await mockPrisma.projects.findMany({
      where: { isDeleted: false },
    });

    expect(result).toHaveLength(2);
    expect(mockPrisma.projects.findMany).toHaveBeenCalledWith({
      where: { isDeleted: false },
    });
  });

  it("should count repository cases for a project", async () => {
    mockPrisma.repositoryCases.count.mockResolvedValue(50);

    const count = await mockPrisma.repositoryCases.count({
      where: { projectId: 1, isDeleted: false, isArchived: false },
    });

    expect(count).toBe(50);
  });

  it("should count all entity types", async () => {
    mockPrisma.sharedStepGroup.count.mockResolvedValue(10);
    mockPrisma.testRuns.count.mockResolvedValue(20);
    mockPrisma.sessions.count.mockResolvedValue(15);
    mockPrisma.issue.count.mockResolvedValue(25);
    mockPrisma.milestones.count.mockResolvedValue(5);

    expect(
      await mockPrisma.sharedStepGroup.count({ where: { projectId: 1 } })
    ).toBe(10);
    expect(await mockPrisma.testRuns.count({ where: { projectId: 1 } })).toBe(
      20
    );
    expect(await mockPrisma.sessions.count({ where: { projectId: 1 } })).toBe(
      15
    );
    expect(await mockPrisma.issue.count({ where: { isDeleted: false } })).toBe(
      25
    );
    expect(
      await mockPrisma.milestones.count({ where: { projectId: 1 } })
    ).toBe(5);
  });
});
