import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const { mockResolveIntegration, mockChat, mockCreateNotification, mockTipTapDoc } =
  vi.hoisted(() => ({
    mockResolveIntegration: vi.fn(),
    mockChat: vi.fn(),
    mockCreateNotification: vi.fn(),
    mockTipTapDoc: vi.fn((t: string) => `tiptap:${t}`),
  }));

// Minimal bullmq Worker mock (the processor under test does not use it).
vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      on = vi.fn();
      close = vi.fn();
      constructor() {}
    },
  };
});

vi.mock("../lib/valkey", () => ({ default: { status: "ready" } }));

// ─── Mock prisma (tenant-scoped client returned by getPrismaClientForJob) ─────

const mockPrisma = {
  steps: {
    count: vi.fn(),
    createMany: vi.fn(),
  },
  testRuns: {
    findUnique: vi.fn(),
  },
};

vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

vi.mock("../lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    createForWorker: vi.fn(() => ({
      resolveIntegration: mockResolveIntegration,
      chat: mockChat,
    })),
  },
}));

vi.mock("@testplanit/api", () => ({
  tipTapDoc: (t: string) => mockTipTapDoc(t),
}));

vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {
    createNotification: (...args: any[]) => mockCreateNotification(...args),
  },
}));

vi.mock("../lib/queueNames", () => ({
  DERIVE_CASE_STEPS_QUEUE_NAME: "test-derive-case-steps-queue",
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const baseCase = {
  testCaseId: 1,
  name: "should log a user in with valid credentials",
  className: "auth/login.spec.ts",
  failure: null,
  systemOut: null,
};

const baseJobData = {
  tenantId: "tenant-a",
  projectId: 10,
  testRunId: 99,
  userId: "user-1",
  cases: [baseCase],
};

function makeJob(overrides: Partial<typeof baseJobData> = {}): Job {
  return {
    id: "job-1",
    name: "derive-case-steps",
    data: { ...baseJobData, ...overrides },
  } as unknown as Job;
}

async function loadWorker() {
  return import("./deriveCaseStepsWorker");
}

const STEPS_JSON =
  '[{"step":"Open the login page","expectedResult":"The login form is shown"},' +
  '{"step":"Submit valid credentials","expectedResult":"The dashboard appears"}]';

describe("deriveCaseStepsWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockPrisma.steps.count.mockResolvedValue(0);
    mockPrisma.steps.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.testRuns.findUnique.mockResolvedValue({ name: "CI Run 42" });
    mockTipTapDoc.mockImplementation((t: string) => `tiptap:${t}`);
  });

  it("is inert when no LLM provider is configured (LLM-01)", async () => {
    mockResolveIntegration.mockResolvedValue(null);

    const { processor } = await loadWorker();
    await processor(makeJob());

    // feature FIRST, projectId SECOND
    expect(mockResolveIntegration).toHaveBeenCalledWith("derive_case_steps", 10);
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockPrisma.steps.createMany).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("derives, writes tipTapDoc steps, and sends one notification (LLM-02, LLM-04, D-12)", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat.mockResolvedValue({ content: STEPS_JSON });

    const { processor } = await loadWorker();
    await processor(makeJob());

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockPrisma.steps.createMany).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.steps.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(2);
    expect(createArg.data[0]).toMatchObject({
      testCaseId: 1,
      order: 0,
      step: "tiptap:Open the login page",
      expectedResult: "tiptap:The login form is shown",
    });

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const notif = mockCreateNotification.mock.calls[0][0];
    expect(notif.type).toBe("AI_STEPS_DERIVED");
    expect(notif.userId).toBe("user-1");
    expect(notif.tenantId).toBe("tenant-a");
    expect(notif.data).toMatchObject({
      projectId: 10,
      testRunId: 99,
      derivedCount: 1,
    });
  });

  it("re-checks CORE-01 and skips a case that gained steps after import (D-09)", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat.mockResolvedValue({ content: STEPS_JSON });
    mockPrisma.steps.count.mockResolvedValue(3); // no longer stepless

    const { processor } = await loadWorker();
    await processor(makeJob());

    expect(mockPrisma.steps.createMany).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("sends no notification when the batch yields zero written cases (D-05, D-11)", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat.mockResolvedValue({ content: "Sorry, I cannot help with that." }); // unparseable

    const { processor } = await loadWorker();
    await processor(makeJob());

    expect(mockPrisma.steps.createMany).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("skips a failing case and continues the rest, one notification (D-11)", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat
      .mockRejectedValueOnce(new Error("LLM timeout")) // case 1 throws
      .mockResolvedValueOnce({ content: STEPS_JSON }); // case 2 succeeds

    const { processor } = await loadWorker();
    await processor(
      makeJob({
        cases: [
          { ...baseCase, testCaseId: 1 },
          { ...baseCase, testCaseId: 2, name: "another stepless test" },
        ],
      })
    );

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockPrisma.steps.createMany).toHaveBeenCalledTimes(1);
    const createArg = mockPrisma.steps.createMany.mock.calls[0][0];
    expect(createArg.data[0].testCaseId).toBe(2);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification.mock.calls[0][0].data.derivedCount).toBe(1);
  });

  it("treats unparseable LLM content as zero rows without throwing", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat.mockResolvedValue({ content: "no json array here at all" });

    const { processor } = await loadWorker();
    await expect(processor(makeJob())).resolves.toBeUndefined();
    expect(mockPrisma.steps.createMany).not.toHaveBeenCalled();
  });
});
