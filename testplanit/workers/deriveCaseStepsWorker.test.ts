import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseStepsFromLlmResponse } from "./deriveCaseStepsWorker";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockResolveIntegration,
  mockChat,
  mockCreateNotification,
  mockTipTapDoc,
} = vi.hoisted(() => ({
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
    updateMany: vi.fn(),
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

vi.mock("../lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class {
    resolve = vi.fn(async () => ({
      systemPrompt: "Derive readable steps.",
      userPrompt:
        "Test: {{TEST_NAME}} / {{CLASS_NAME}} / {{FAILURE}} / {{SYSTEM_OUT}}",
      temperature: 0.3,
      maxOutputTokens: 1024,
      source: "fallback" as const,
    }));
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
    mockPrisma.steps.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.testRuns.findUnique.mockResolvedValue({ name: "CI Run 42" });
    mockTipTapDoc.mockImplementation((t: string) => `tiptap:${t}`);
  });

  it("is inert when no LLM provider is configured (LLM-01)", async () => {
    mockResolveIntegration.mockResolvedValue(null);

    const { processor } = await loadWorker();
    await processor(makeJob());

    // feature FIRST, projectId SECOND
    expect(mockResolveIntegration).toHaveBeenCalledWith(
      "derive_case_steps",
      10
    );
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

  it("overwrite:true re-derives a case that already has steps (soft-delete + rewrite)", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat.mockResolvedValue({ content: STEPS_JSON });
    mockPrisma.steps.count.mockResolvedValue(4); // already has steps

    const { processor } = await loadWorker();
    await processor(makeJob({ overwrite: true } as never));

    // existing steps soft-deleted, then the re-derived set written
    expect(mockPrisma.steps.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.steps.updateMany.mock.calls[0][0]).toMatchObject({
      where: { testCaseId: 1, isDeleted: false },
      data: { isDeleted: true },
    });
    expect(mockPrisma.steps.createMany).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });

  it("overwrite:true never clears existing steps when the LLM yields zero rows", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 5 });
    mockChat.mockResolvedValue({ content: "no array here" }); // 0 parsed rows
    mockPrisma.steps.count.mockResolvedValue(4);

    const { processor } = await loadWorker();
    await processor(makeJob({ overwrite: true } as never));

    expect(mockPrisma.steps.updateMany).not.toHaveBeenCalled();
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

describe("parseStepsFromLlmResponse", () => {
  it("parses a clean JSON array of {step, expectedResult}", () => {
    expect(
      parseStepsFromLlmResponse(
        '[{"step":"Open the app","expectedResult":"Home screen shows"}]'
      )
    ).toEqual([{ step: "Open the app", expectedResult: "Home screen shows" }]);
  });

  it("extracts the array from surrounding prose (real LLM output)", () => {
    const content =
      'Sure! Here are the steps:\n[{"step":"Log in","expectedResult":"Dashboard"}]\nHope that helps.';
    expect(parseStepsFromLlmResponse(content)).toEqual([
      { step: "Log in", expectedResult: "Dashboard" },
    ]);
  });

  it("extracts the array from a fenced ```json block", () => {
    const content =
      '```json\n[{"step":"Click submit","expectedResult":"Form saved"}]\n```';
    expect(parseStepsFromLlmResponse(content)).toEqual([
      { step: "Click submit", expectedResult: "Form saved" },
    ]);
  });

  it("coerces a missing or non-string expectedResult to an empty string", () => {
    expect(
      parseStepsFromLlmResponse(
        '[{"step":"A"},{"step":"B","expectedResult":42},{"step":"C","expectedResult":"ok"}]'
      )
    ).toEqual([
      { step: "A", expectedResult: "" },
      { step: "B", expectedResult: "" },
      { step: "C", expectedResult: "ok" },
    ]);
  });

  it("drops entries without a non-empty string step", () => {
    expect(
      parseStepsFromLlmResponse(
        '[{"step":""},{"expectedResult":"x"},{"step":"   "},{"step":"Real step"},null,"bogus",{"step":7}]'
      )
    ).toEqual([{ step: "Real step", expectedResult: "" }]);
  });

  it("trims whitespace around step and expectedResult", () => {
    expect(
      parseStepsFromLlmResponse(
        '[{"step":"  padded  ","expectedResult":"  result  "}]'
      )
    ).toEqual([{ step: "padded", expectedResult: "result" }]);
  });

  it("returns [] for malformed JSON, no array, empty, or a non-array", () => {
    expect(parseStepsFromLlmResponse('[{"step": "x"')).toEqual([]); // malformed
    expect(parseStepsFromLlmResponse("I cannot help with that.")).toEqual([]); // no array
    expect(parseStepsFromLlmResponse("")).toEqual([]); // empty
    expect(parseStepsFromLlmResponse('{"step":"x"}')).toEqual([]); // object, not array
  });
});
