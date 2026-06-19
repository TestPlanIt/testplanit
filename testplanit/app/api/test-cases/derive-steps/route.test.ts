import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  extractBearerToken: vi.fn(),
  authenticateApiToken: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    repositoryCases: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/llmStepDerivation", () => ({
  enqueueDeriveCaseSteps: vi.fn(),
}));

import { extractBearerToken, authenticateApiToken } from "~/lib/api-token-auth";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { enqueueDeriveCaseSteps } from "~/lib/services/llmStepDerivation";

const mockSession = { user: { id: "user-123" } };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test-cases/derive-steps", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  projectId: 10,
  testRunId: 99,
  cases: [
    { testCaseId: 1, name: "should log in" },
    { testCaseId: 2, name: "should log out" },
  ],
};

describe("POST /api/test-cases/derive-steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerAuthSession).mockResolvedValue(mockSession as never);
    vi.mocked(enqueueDeriveCaseSteps).mockResolvedValue(true);
    // Both cases belong to the project by default.
    vi.mocked(prisma.repositoryCases.findMany).mockResolvedValue([
      { id: 1 },
      { id: 2 },
    ] as never);
  });

  it("enqueues derivation for project-owned cases (session auth)", async () => {
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enqueued: true });

    expect(enqueueDeriveCaseSteps).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(enqueueDeriveCaseSteps).mock.calls[0][0];
    expect(arg).toMatchObject({
      projectId: 10,
      testRunId: 99,
      userId: "user-123",
      overwrite: false,
    });
    expect(arg.cases).toHaveLength(2);
  });

  it("passes captured commands through to the worker", async () => {
    const res = await POST(
      makeRequest({
        projectId: 10,
        testRunId: 99,
        cases: [
          {
            testCaseId: 1,
            name: "should log in",
            commands: ['navigateTo {"url":"/login"}', "elementClick"],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    const arg = vi.mocked(enqueueDeriveCaseSteps).mock.calls[0][0];
    expect(arg.cases[0]).toMatchObject({
      testCaseId: 1,
      commands: ['navigateTo {"url":"/login"}', "elementClick"],
    });
  });

  it("authenticates via API token when there is no session", async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null as never);
    vi.mocked(extractBearerToken).mockReturnValue("tpi_xxx");
    vi.mocked(authenticateApiToken).mockResolvedValue({
      authenticated: true,
      userId: "token-user",
    } as never);

    const res = await POST(makeRequest({ ...validBody, overwrite: true }));
    expect(res.status).toBe(200);
    const arg = vi.mocked(enqueueDeriveCaseSteps).mock.calls[0][0];
    expect(arg.userId).toBe("token-user");
    expect(arg.overwrite).toBe(true);
  });

  it("drops cases that do not belong to the project (cross-project guard)", async () => {
    vi.mocked(prisma.repositoryCases.findMany).mockResolvedValue([
      { id: 1 },
    ] as never); // only case 1 is owned

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const arg = vi.mocked(enqueueDeriveCaseSteps).mock.calls[0][0];
    expect(arg.cases.map((c: { testCaseId: number }) => c.testCaseId)).toEqual([
      1,
    ]);
  });

  it("returns enqueued:false (no enqueue) when no case belongs to the project", async () => {
    vi.mocked(prisma.repositoryCases.findMany).mockResolvedValue([] as never);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enqueued: false });
    expect(enqueueDeriveCaseSteps).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue(null as never);
    vi.mocked(extractBearerToken).mockReturnValue(undefined as never);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
    expect(enqueueDeriveCaseSteps).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await POST(makeRequest({ projectId: 10 })); // missing testRunId + cases
    expect(res.status).toBe(400);
    expect(enqueueDeriveCaseSteps).not.toHaveBeenCalled();
  });
});
