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

// Keep RefNotFoundError real so the route's instanceof check holds; stub the
// two operations the route drives.
vi.mock("~/lib/services/impact/compareService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/lib/services/impact/compareService")
    >();
  return {
    ...actual,
    resolveRefToSha: vi.fn(),
    getOrComputeCompare: vi.fn(),
  };
});

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {},
}));

import { getServerSession } from "next-auth";
import {
  getOrComputeCompare,
  RefNotFoundError,
  resolveRefToSha,
} from "~/lib/services/impact/compareService";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const session = { user: { id: "user-1" } };

const adapter = { kind: "adapter" };
const loaded = {
  config: {
    id: 5,
    projectId: 1,
    purpose: "IMPACT",
    branch: "main",
    cacheEnabled: true,
    repositoryId: 9,
    repository: { id: 9, name: "acme/app", provider: "github", settings: null },
  },
  adapter,
};

function makeRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/code-repositories/9/compare");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function makeParams(id = "9") {
  return { params: Promise.resolve({ id }) };
}

const compareResult = {
  baseSha: SHA_A,
  headSha: SHA_B,
  files: [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      isBinary: false,
    },
  ],
  commits: [],
  truncated: false,
};

describe("GET /api/code-repositories/[id]/compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);
    (resolveRefToSha as any).mockImplementation(
      async (_a: unknown, ref: string) => (ref === "main" ? SHA_A : SHA_B)
    );
    (getOrComputeCompare as any).mockResolvedValue({
      result: compareResult,
      cached: false,
    });
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
    const badId = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams("abc")
    );
    expect(badId.status).toBe(400);

    const missingConfig = await GET(
      makeRequest({ base: "main", head: "feature" }),
      makeParams()
    );
    expect(missingConfig.status).toBe(400);
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 400 when base or head is missing or malformed", async () => {
    const missingHead = await GET(
      makeRequest({ configId: "5", base: "main" }),
      makeParams()
    );
    expect(missingHead.status).toBe(400);
    expect(await missingHead.json()).toMatchObject({ error: "Invalid query" });

    const spacey = await GET(
      makeRequest({ configId: "5", base: "main", head: "my branch" }),
      makeParams()
    );
    expect(spacey.status).toBe(400);
    expect(resolveRefToSha).not.toHaveBeenCalled();
  });

  it("returns 404 when the config is not visible to the caller", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(loadRepoConfigForUser).toHaveBeenCalledWith(session, 5, {
      repositoryId: 9,
    });
    expect(resolveRefToSha).not.toHaveBeenCalled();
  });

  it("returns 400 when base and head resolve to the same commit", async () => {
    (resolveRefToSha as any).mockResolvedValue(SHA_A);

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "also-main" }),
      makeParams()
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Base and head resolve to the same commit",
    });
    expect(getOrComputeCompare).not.toHaveBeenCalled();
  });

  it("returns 404 when a ref cannot be resolved", async () => {
    (resolveRefToSha as any).mockImplementation(
      async (_a: unknown, ref: string) => {
        if (ref === "ghost") throw new RefNotFoundError(ref);
        return SHA_A;
      }
    );

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "ghost" }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Ref not found: ghost" });
  });

  it("returns 502 with the provider message on a provider failure", async () => {
    (getOrComputeCompare as any).mockRejectedValue(
      new Error("GitHub API error: 403 rate limit exceeded, retry in 30s")
    );

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "GitHub API error: 403 rate limit exceeded, retry in 30s",
    });
  });

  it("returns 200 with the compare result, the refs, and the cached flag", async () => {
    (getOrComputeCompare as any).mockResolvedValue({
      result: compareResult,
      cached: true,
    });

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...compareResult,
      baseRef: "main",
      headRef: "feature",
      cached: true,
    });
    expect(resolveRefToSha).toHaveBeenCalledWith(adapter, "main");
    expect(resolveRefToSha).toHaveBeenCalledWith(adapter, "feature");
    expect(getOrComputeCompare).toHaveBeenCalledWith({
      configId: 5,
      cacheEnabled: true,
      adapter,
      baseSha: SHA_A,
      headSha: SHA_B,
    });
  });

  it("passes cacheEnabled=false through for privacy-mode configs", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue({
      ...loaded,
      config: { ...loaded.config, cacheEnabled: false },
    });

    const res = await GET(
      makeRequest({ configId: "5", base: "main", head: "feature" }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect((await res.json()).cached).toBe(false);
    expect(getOrComputeCompare).toHaveBeenCalledWith(
      expect.objectContaining({ cacheEnabled: false })
    );
  });
});
