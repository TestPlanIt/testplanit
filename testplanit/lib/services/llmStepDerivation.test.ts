import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveIntegration, mockQueueAdd, mockGetQueue } = vi.hoisted(
  () => ({
    mockResolveIntegration: vi.fn(),
    mockQueueAdd: vi.fn(),
    mockGetQueue: vi.fn(),
  })
);

vi.mock("~/lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    getInstance: vi.fn(() => ({
      resolveIntegration: mockResolveIntegration,
    })),
  },
}));

vi.mock("~/lib/queues", () => ({
  getDeriveCaseStepsQueue: () => mockGetQueue(),
}));

vi.mock("~/lib/multiTenantDb", () => ({
  getCurrentTenantId: () => "tenant-x",
}));

import {
  enqueueDeriveCaseSteps,
  isLlmStepDerivationEligible,
} from "./llmStepDerivation";

const fakePrisma = {} as any;
const cases = [
  {
    testCaseId: 1,
    name: "stepless test",
    className: null,
    failure: null,
    systemOut: null,
  },
];

describe("isLlmStepDerivationEligible", () => {
  it("is true only for low-structure AND stepless cases (D-02, CORE-01)", () => {
    expect(isLlmStepDerivationEligible(0, 0)).toBe(true); // eligible
    expect(isLlmStepDerivationEligible(3, 0)).toBe(false); // structured (has automation steps)
    expect(isLlmStepDerivationEligible(0, 5)).toBe(false); // already has steps
    expect(isLlmStepDerivationEligible(2, 2)).toBe(false);
  });
});

describe("enqueueDeriveCaseSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQueue.mockReturnValue({ add: mockQueueAdd });
  });

  it("enqueues exactly one job when a provider resolves (LLM-02/03, D-06)", async () => {
    mockResolveIntegration.mockResolvedValue({ integrationId: 7 });

    const enqueued = await enqueueDeriveCaseSteps({
      baseDb: fakePrisma,
      projectId: 10,
      testRunId: 99,
      userId: "user-1",
      cases,
    });

    expect(enqueued).toBe(true);
    // feature FIRST, projectId SECOND
    expect(mockResolveIntegration).toHaveBeenCalledWith(
      "derive_case_steps",
      10
    );
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    const [, payload] = mockQueueAdd.mock.calls[0];
    expect(payload).toMatchObject({
      projectId: 10,
      testRunId: 99,
      userId: "user-1",
      tenantId: "tenant-x",
      cases,
    });
  });

  it("is inert (no enqueue) when no provider is configured (LLM-01)", async () => {
    mockResolveIntegration.mockResolvedValue(null);

    const enqueued = await enqueueDeriveCaseSteps({
      baseDb: fakePrisma,
      projectId: 10,
      testRunId: 99,
      userId: "user-1",
      cases,
    });

    expect(enqueued).toBe(false);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("does not resolve or enqueue when there are no eligible cases", async () => {
    const enqueued = await enqueueDeriveCaseSteps({
      baseDb: fakePrisma,
      projectId: 10,
      testRunId: 99,
      userId: "user-1",
      cases: [],
    });

    expect(enqueued).toBe(false);
    expect(mockResolveIntegration).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
