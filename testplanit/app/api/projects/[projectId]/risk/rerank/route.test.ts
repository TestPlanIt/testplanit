import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getEnhancedDb: vi.fn(),
  findFirst: vi.fn(),
  getInstance: vi.fn(),
  resolveIntegration: vi.fn(),
  getRiskScoreQueue: vi.fn(),
  add: vi.fn(),
  getCurrentTenantId: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: mocks.getEnhancedDb }));
vi.mock("~/lib/db", () => ({ baseDb: {} }));
vi.mock("~/lib/llm/services/llm-manager.service", () => ({
  LlmManager: { getInstance: mocks.getInstance },
}));
vi.mock("~/lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class {
    async resolve() {
      return { systemPrompt: "s", userPrompt: "u" };
    }
  },
}));
vi.mock("~/lib/queues", () => ({
  getRiskScoreQueue: mocks.getRiskScoreQueue,
}));
vi.mock("@/lib/multiTenantDb", () => ({
  getCurrentTenantId: mocks.getCurrentTenantId,
}));

import { LLM_FEATURES } from "~/lib/llm/constants";
import { JOB_RISK_RERANK } from "~/lib/queueNames";
import { RERANK_MAX_CANDIDATES } from "~/lib/services/risk/rerank";

import { POST } from "./route";

const session = { user: { id: "user-1" } };

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/projects/5/risk/rerank", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = (projectId = "5") => ({
  params: Promise.resolve({ projectId }),
});

const body = {
  caseIds: [1, 2, 3],
  runContext: { name: "Release 4.2", description: "payments" },
};

describe("POST /api/projects/[projectId]/risk/rerank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(session);
    mocks.getEnhancedDb.mockResolvedValue({
      projects: { findFirst: mocks.findFirst },
    });
    mocks.findFirst.mockResolvedValue({ riskScoringEnabled: true });
    mocks.getInstance.mockReturnValue({
      resolveIntegration: mocks.resolveIntegration,
    });
    mocks.resolveIntegration.mockResolvedValue({ integrationId: 3 });
    mocks.add.mockResolvedValue({ id: "job-1" });
    mocks.getRiskScoreQueue.mockReturnValue({ add: mocks.add });
    mocks.getCurrentTenantId.mockReturnValue(undefined);
  });

  it("queues the job and returns its id", async () => {
    const response = await POST(request(body), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: "job-1" });
    const [name, data, options] = mocks.add.mock.calls[0];
    expect(name).toBe(JOB_RISK_RERANK);
    expect(data).toMatchObject({
      projectId: 5,
      caseIds: [1, 2, 3],
      userId: "user-1",
    });
    // No priority: BullMQ serves unprioritized jobs BEFORE prioritized ones,
    // so setting one would put the job someone is waiting for last.
    expect(options?.priority).toBeUndefined();
    // Resolved with the prompt, exactly as the worker resolves it.
    expect(mocks.resolveIntegration).toHaveBeenCalledWith(
      LLM_FEATURES.RISK_RERANK,
      5,
      expect.objectContaining({ systemPrompt: "s" })
    );
  });

  it("flattens a rich-text description into words the prompt can carry", async () => {
    await POST(
      request({
        ...body,
        runContext: {
          name: "Release 4.2",
          description: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Stripe webhook retries" }],
              },
            ],
          },
        },
      }),
      params()
    );

    expect(mocks.add.mock.calls[0][1].runContext.description).toBe(
      "Stripe webhook retries"
    );
  });

  it("refuses without a session", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await POST(request(body), params())).status).toBe(401);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("reports a project the caller cannot read as missing", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect((await POST(request(body), params())).status).toBe(404);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("refuses when the project has risk scoring switched off", async () => {
    mocks.findFirst.mockResolvedValue({ riskScoringEnabled: false });
    expect((await POST(request(body), params())).status).toBe(400);
    expect(mocks.resolveIntegration).not.toHaveBeenCalled();
  });

  it("answers 409 when no model is configured for the feature", async () => {
    mocks.resolveIntegration.mockResolvedValue(null);
    expect((await POST(request(body), params())).status).toBe(409);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("answers 503 when the queue is unavailable", async () => {
    mocks.getRiskScoreQueue.mockReturnValue(null);
    expect((await POST(request(body), params())).status).toBe(503);
  });

  it("rejects an empty or oversized candidate list", async () => {
    expect(
      (await POST(request({ ...body, caseIds: [] }), params())).status
    ).toBe(400);
    const many = Array.from(
      { length: RERANK_MAX_CANDIDATES + 1 },
      (_, i) => i + 1
    );
    expect(
      (await POST(request({ ...body, caseIds: many }), params())).status
    ).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("rejects a malformed project id", async () => {
    expect((await POST(request(body), params("nope"))).status).toBe(400);
  });
});
