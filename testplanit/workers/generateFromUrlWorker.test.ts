import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockRedisGet,
  mockRedisDel,
  mockRedisSet,
  mockUpdateProgress,
  mockExtendLock,
  mockCreateNotification,
  mockSsrfSafeFetch,
  mockExtractContent,
  mockExtractLinks,
  mockNormalizeUrl,
  mockHashContent,
  mockFetchRobots,
  mockGetDbClientForJob,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockRedisSet: vi.fn(),
  mockUpdateProgress: vi.fn(),
  mockExtendLock: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockSsrfSafeFetch: vi.fn(),
  mockExtractContent: vi.fn(),
  mockExtractLinks: vi.fn(),
  mockNormalizeUrl: vi.fn(),
  mockHashContent: vi.fn(),
  mockFetchRobots: vi.fn(),
  mockGetDbClientForJob: vi.fn(),
}));

const mockRedisClient = {
  get: (...args: any[]) => mockRedisGet(...args),
  del: (...args: any[]) => mockRedisDel(...args),
  set: (...args: any[]) => mockRedisSet(...args),
};

// ─── Mock bullmq Worker ───────────────────────────────────────────────────────

vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      client = Promise.resolve(mockRedisClient);
      on = vi.fn();
      close = vi.fn();
      constructor() {}
    },
  };
});

vi.mock("../lib/valkey", () => ({
  default: { status: "ready" },
}));

// ─── Mock multiTenantDb ───────────────────────────────────────────────────

const mockDb = {
  projects: { findUnique: vi.fn() },
  $disconnect: vi.fn(),
};

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: (...args: any[]) => mockGetDbClientForJob(...args),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// ─── Mock notification service ────────────────────────────────────────────────

vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {
    createNotification: (...args: any[]) => mockCreateNotification(...args),
  },
}));

// ─── Mock crawl utilities ─────────────────────────────────────────────────────

vi.mock("../lib/utils/ssrf", () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
  SsrfError: class SsrfError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("../lib/utils/contentExtractor", () => ({
  extractContent: (...args: any[]) => mockExtractContent(...args),
}));

vi.mock("../lib/utils/crawl", () => ({
  extractLinks: (...args: any[]) => mockExtractLinks(...args),
  normalizeUrl: (...args: any[]) => mockNormalizeUrl(...args),
  hashContent: (...args: any[]) => mockHashContent(...args),
  fetchRobots: (...args: any[]) => mockFetchRobots(...args),
}));

// ─── Mock queue names ─────────────────────────────────────────────────────────

vi.mock("../lib/queueNames", () => ({
  GENERATE_FROM_URL_QUEUE_NAME: "test-generate-from-url-queue",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseJobData = {
  projectId: 42,
  userId: "user-abc",
  url: "https://example.com/docs",
  mode: "application" as const,
  options: {
    followLinks: false,
    maxDepth: 2,
    maxPages: 10,
  },
  tenantId: "tenant-1",
};

function makeMockJob(
  overrides: Partial<{
    id: string;
    data: Partial<
      typeof baseJobData & {
        templateId?: number;
        folderId?: number;
        userNotes?: string;
        quantity?: string;
        autoGenerateTags?: boolean;
      }
    >;
  }> = {}
): unknown {
  return {
    id: overrides.id ?? "job-1",
    data: { ...baseJobData, ...(overrides.data ?? {}) },
    updateProgress: mockUpdateProgress,
    extendLock: mockExtendLock,
  };
}

async function loadWorker() {
  const mod = await import("./generateFromUrlWorker");
  mod.startGenerateFromUrlWorker();
  return mod;
}

// ─── Default mock setup helpers ───────────────────────────────────────────────

function setupDefaultMocks() {
  // normalizeUrl just returns its input
  mockNormalizeUrl.mockImplementation((url: string) => url);

  // fetchRobots returns null (no robots.txt restrictions)
  mockFetchRobots.mockResolvedValue(null);

  // ssrfSafeFetch returns minimal body + finalUrl
  mockSsrfSafeFetch.mockResolvedValue({
    body: "<html><h1>Docs Page</h1><p>Content here.</p></html>",
    finalUrl: "https://example.com/docs",
  });

  // extractContent returns markdown
  mockExtractContent.mockReturnValue({
    markdown: "# Docs Page\n\nContent here.",
    spaWarning: false,
  });

  // hashContent returns unique hash per call
  mockHashContent.mockReturnValue("hash-abc123");

  // extractLinks returns empty (no follow)
  mockExtractLinks.mockReturnValue([]);

  // getDbClientForJob returns mock db
  mockGetDbClientForJob.mockReturnValue(mockDb);

  // projects.findUnique returns project name for notifications
  mockDb.projects.findUnique.mockResolvedValue({ name: "Test Project" });

  // No notification errors
  mockCreateNotification.mockResolvedValue("notif-job-1");

  // Redis: no cancellation, set succeeds
  mockRedisGet.mockResolvedValue(null);
  mockRedisDel.mockResolvedValue(1);
  mockRedisSet.mockResolvedValue("OK");

  // Progress + lock extensions succeed
  mockUpdateProgress.mockResolvedValue(undefined);
  mockExtendLock.mockResolvedValue(undefined);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GenerateFromUrlWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setupDefaultMocks();
  });

  describe("crawl result shape", () => {
    it("should return crawlOnly: true", async () => {
      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.crawlOnly).toBe(true);
    });

    it("should return crawledPages array with url, title, and spaWarning per page", async () => {
      mockExtractContent.mockReturnValue({
        markdown: "# My Page Title\n\nContent.",
        spaWarning: false,
      });

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.crawledPages).toBeDefined();
      expect(result.crawledPages).toHaveLength(1);
      expect(result.crawledPages[0]).toMatchObject({
        url: "https://example.com/docs",
        spaWarning: false,
      });
    });

    it("should extract page title from first h1 in markdown", async () => {
      mockExtractContent.mockReturnValue({
        markdown: "# My Extracted Title\n\nContent.",
        spaWarning: false,
      });

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.crawledPages[0].title).toBe("My Extracted Title");
    });

    it("should include spaWarning: true for SPA pages in crawledPages", async () => {
      mockExtractContent.mockReturnValue({
        markdown: "# SPA Page\n\nDynamic content.",
        spaWarning: true,
      });

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.crawledPages[0].spaWarning).toBe(true);
    });

    it("should include urlsCrawled and pagesProcessed in result", async () => {
      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.urlsCrawled).toContain("https://example.com/docs");
      expect(result.pagesProcessed).toBe(1);
    });

    it("should include templateId and selectedFieldIds from job data", async () => {
      const jobData = {
        ...baseJobData,
        templateId: 5,
        selectedFieldIds: [10, 20, 30],
      };
      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      expect(result.templateId).toBe(5);
      expect(result.selectedFieldIds).toEqual([10, 20, 30]);
    });
  });

  describe("Redis page storage", () => {
    it("should store crawled page content in Redis with 7-day TTL", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-redis-1" }) as Job);

      expect(mockRedisSet).toHaveBeenCalledWith(
        "generate-from-url:pages:job-redis-1",
        expect.any(String),
        { EX: 604800 }
      );
    });

    it("should include markdown in stored Redis content", async () => {
      mockExtractContent.mockReturnValue({
        markdown: "# Page\n\nMarkdown content here.",
        spaWarning: false,
      });

      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-redis-2" }) as Job);

      const storedJson = mockRedisSet.mock.calls[0][1];
      const storedPages = JSON.parse(storedJson);
      expect(storedPages).toHaveLength(1);
      expect(storedPages[0].markdown).toBe("# Page\n\nMarkdown content here.");
    });
  });

  describe("multi-page crawling", () => {
    it("should follow links when followLinks is enabled", async () => {
      const jobData = {
        ...baseJobData,
        options: { followLinks: true, maxDepth: 2, maxPages: 10 },
      };

      mockSsrfSafeFetch
        .mockResolvedValueOnce({
          body: "<html>p1</html>",
          finalUrl: "https://example.com/docs",
        })
        .mockResolvedValueOnce({
          body: "<html>p2</html>",
          finalUrl: "https://example.com/page2",
        });

      mockExtractContent
        .mockReturnValueOnce({ markdown: "# Page 1", spaWarning: false })
        .mockReturnValueOnce({ markdown: "# Page 2", spaWarning: false });

      mockHashContent
        .mockReturnValueOnce("hash-1")
        .mockReturnValueOnce("hash-2");

      mockExtractLinks
        .mockReturnValueOnce(["https://example.com/page2"])
        .mockReturnValue([]);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      expect(result.pagesProcessed).toBe(2);
      expect(result.urlsCrawled).toContain("https://example.com/docs");
      expect(result.urlsCrawled).toContain("https://example.com/page2");
    });

    it("should deduplicate pages by content hash", async () => {
      const jobData = {
        ...baseJobData,
        options: { followLinks: true, maxDepth: 2, maxPages: 10 },
      };

      mockSsrfSafeFetch
        .mockResolvedValueOnce({
          body: "<html>p1</html>",
          finalUrl: "https://example.com/docs",
        })
        .mockResolvedValueOnce({
          body: "<html>p2</html>",
          finalUrl: "https://example.com/page2",
        });

      mockExtractContent.mockReturnValue({
        markdown: "# Same content",
        spaWarning: false,
      });

      // Same hash = duplicate
      mockHashContent.mockReturnValue("same-hash");

      mockExtractLinks
        .mockReturnValueOnce(["https://example.com/page2"])
        .mockReturnValue([]);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      // Only 1 page because second was a duplicate
      expect(result.pagesProcessed).toBe(1);
    });

    it("should respect maxPages limit", async () => {
      const jobData = {
        ...baseJobData,
        options: { followLinks: true, maxDepth: 2, maxPages: 1 },
      };

      mockExtractLinks.mockReturnValue(["https://example.com/page2"]);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      expect(result.pagesProcessed).toBe(1);
    });

    it("should update hostname from first page redirect", async () => {
      // Seed URL redirects to www subdomain
      mockSsrfSafeFetch.mockResolvedValue({
        body: "<html>redirected</html>",
        finalUrl: "https://www.example.com/docs",
      });

      mockExtractContent.mockReturnValue({
        markdown: "# Redirected",
        spaWarning: false,
      });

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob() as Job);

      expect(result.urlsCrawled).toContain("https://www.example.com/docs");
    });
  });

  describe("robots.txt", () => {
    it("should skip URLs disallowed by robots.txt (except seed URL)", async () => {
      const jobData = {
        ...baseJobData,
        options: { followLinks: true, maxDepth: 2, maxPages: 10 },
      };

      const mockRobotsParser = {
        isAllowed: vi.fn((url: string) => !url.includes("/private")),
      };
      mockFetchRobots.mockResolvedValue(mockRobotsParser);

      mockSsrfSafeFetch
        .mockResolvedValueOnce({
          body: "<html>p1</html>",
          finalUrl: "https://example.com/docs",
        })
        .mockResolvedValueOnce({
          body: "<html>p2</html>",
          finalUrl: "https://example.com/public",
        });

      mockExtractContent.mockReturnValue({
        markdown: "# Page",
        spaWarning: false,
      });
      mockHashContent.mockReturnValueOnce("h1").mockReturnValueOnce("h2");

      mockExtractLinks
        .mockReturnValueOnce([
          "https://example.com/private",
          "https://example.com/public",
        ])
        .mockReturnValue([]);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      expect(result.robotsSkipped).toBe(1);
      expect(result.urlsCrawled).not.toContain("https://example.com/private");
    });
  });

  describe("notifications", () => {
    it("should not send notifications on success (wizard handles status via polling)", async () => {
      const { processor } = await loadWorker();
      await processor(makeMockJob({ id: "job-success-1" }) as Job);

      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should not send notifications on failure (wizard handles errors via polling)", async () => {
      mockSsrfSafeFetch.mockRejectedValue(new Error("Connection refused"));

      const { processor } = await loadWorker();
      await expect(
        processor(makeMockJob({ id: "job-fail-1" }) as Job)
      ).rejects.toThrow();

      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it("should still throw on error so BullMQ marks job as failed", async () => {
      mockSsrfSafeFetch.mockRejectedValue(new Error("Connection refused"));

      const { processor } = await loadWorker();
      await expect(
        processor(makeMockJob({ id: "job-fail-2" }) as Job)
      ).rejects.toThrow();
    });
  });

  describe("cancellation", () => {
    it("should throw 'Job cancelled by user' when pre-start cancellation key exists", async () => {
      mockRedisGet.mockResolvedValue("1");

      const { processor } = await loadWorker();
      await expect(
        processor(makeMockJob({ id: "job-cancel-1" }) as Job)
      ).rejects.toThrow("Job cancelled by user");
    });

    it("should stop crawling when cancellation detected mid-crawl", async () => {
      const jobData = {
        ...baseJobData,
        options: { followLinks: true, maxDepth: 2, maxPages: 5 },
      };

      mockExtractLinks.mockReturnValue(["https://example.com/page2"]);
      mockHashContent.mockReturnValue("hash-unique");

      mockRedisGet
        .mockResolvedValueOnce(null) // pre-start: not cancelled
        .mockResolvedValueOnce(null) // first BFS iteration check
        .mockResolvedValueOnce("1"); // second BFS iteration: cancel signal

      const { processor } = await loadWorker();
      // Should complete with partial results (1 page), not throw
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      expect(result.pagesProcessed).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should throw when no content could be extracted", async () => {
      mockSsrfSafeFetch.mockRejectedValue(new Error("Network error"));

      const { processor } = await loadWorker();
      await expect(processor(makeMockJob() as Job)).rejects.toThrow(
        "No content could be extracted"
      );
    });

    it("should skip non-fetchable pages and continue crawling", async () => {
      const jobData = {
        ...baseJobData,
        options: { followLinks: true, maxDepth: 2, maxPages: 10 },
      };

      mockSsrfSafeFetch
        .mockResolvedValueOnce({
          body: "<html>p1</html>",
          finalUrl: "https://example.com/docs",
        })
        .mockRejectedValueOnce(new Error("404"))
        .mockResolvedValueOnce({
          body: "<html>p3</html>",
          finalUrl: "https://example.com/page3",
        });

      mockExtractContent.mockReturnValue({
        markdown: "# Page",
        spaWarning: false,
      });
      mockHashContent.mockReturnValueOnce("h1").mockReturnValueOnce("h3");

      mockExtractLinks
        .mockReturnValueOnce([
          "https://example.com/page2",
          "https://example.com/page3",
        ])
        .mockReturnValue([]);

      const { processor } = await loadWorker();
      const result = await processor(makeMockJob({ data: jobData }) as Job);

      // Page 2 failed but page 1 and 3 succeeded
      expect(result.pagesProcessed).toBe(2);
    });
  });
});
