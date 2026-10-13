import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/services/impact/repoAccess", () => ({
  loadRepoConfigForUser: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const MERGE_BASE = "m".repeat(40);
const session = { user: { id: "user-1" } };

let getMergeBase: ReturnType<typeof vi.fn>;

function makeLoaded() {
  return {
    config: {
      id: 5,
      projectId: 1,
      purpose: "IMPACT",
      branch: "main",
      cacheEnabled: true,
      repositoryId: 9,
      repository: { id: 9, name: "acme/app", provider: "github" },
    },
    adapter: { getMergeBase },
  };
}

function makeRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/code-repositories/9/merge-base");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function makeParams(id = "9") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/code-repositories/[id]/merge-base", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMergeBase = vi.fn().mockResolvedValue(MERGE_BASE);
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded());
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(401);
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 400 when the repository id or configId is not an integer", async () => {
    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams("abc")
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 when the config is not visible to this user", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(404);
  });

  it("requires both refs", async () => {
    const noHead = await GET(
      makeRequest({ configId: "5", base: "main" }),
      makeParams()
    );
    expect(noHead.status).toBe(400);

    const noBase = await GET(
      makeRequest({ configId: "5", head: "feature" }),
      makeParams()
    );
    expect(noBase.status).toBe(400);

    expect(getMergeBase).not.toHaveBeenCalled();
  });

  it("rejects a blank ref rather than asking the provider for it", async () => {
    const res = await GET(
      makeRequest({ configId: "5", base: "   ", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(400);
    expect(getMergeBase).not.toHaveBeenCalled();
  });

  it("returns the sha the provider names", async () => {
    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(getMergeBase).toHaveBeenCalledWith("main", "feature");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sha: MERGE_BASE });
  });

  it("trims the refs before handing them to the provider", async () => {
    await GET(
      makeRequest({ configId: "5", base: " main ", head: " feature " }),
      makeParams()
    );

    expect(getMergeBase).toHaveBeenCalledWith("main", "feature");
  });

  it("answers null when the provider cannot supply one, so the caller keeps its own base", async () => {
    getMergeBase.mockResolvedValue(null);

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sha: null });
  });

  it("returns 404 when the provider reports one of the refs missing", async () => {
    getMergeBase.mockRejectedValue(
      new Error("HTTP 404 Not Found: no such ref")
    );

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "ghost" }),
      makeParams()
    );

    expect(res.status).toBe(404);
  });

  it("returns 502 with the provider message on any other failure", async () => {
    getMergeBase.mockRejectedValue(
      new Error("Rate limit exceeded. Retry in 30s")
    );

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Rate limit exceeded. Retry in 30s",
    });
  });
});
