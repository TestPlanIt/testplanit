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

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {
    getRefList: vi.fn(),
    setRefList: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const session = { user: { id: "user-1" } };

function makeCommit(sha: string) {
  return {
    sha,
    message: `Fix the widget (${sha})`,
    authorName: "ada",
    authoredAt: "2026-09-01T10:00:00Z",
    url: `https://example.com/commit/${sha}`,
  };
}

let listCommits: ReturnType<typeof vi.fn>;
let getDefaultBranch: ReturnType<typeof vi.fn>;

function makeLoaded(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      id: 5,
      projectId: 1,
      purpose: "IMPACT",
      branch: "main",
      cacheEnabled: true,
      repositoryId: 9,
      repository: { id: 9, name: "acme/app", provider: "github" },
      ...overrides,
    },
    adapter: { listCommits, getDefaultBranch },
  };
}

function makeRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/code-repositories/9/commits");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function makeParams(id = "9") {
  return { params: Promise.resolve({ id }) };
}

function get(query: Record<string, string> = {}, id?: string) {
  return GET(makeRequest({ configId: "5", ...query }), makeParams(id));
}

/** The cache key the route derived for this query. */
async function cacheKey(query: Record<string, string>) {
  (repoFileCache.getRefList as any).mockClear();
  await get(query);
  return (repoFileCache.getRefList as any).mock.calls[0][2] as string;
}

describe("GET /api/code-repositories/[id]/commits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCommits = vi
      .fn()
      .mockResolvedValue({ commits: [makeCommit("aaa")], hasMore: false });
    getDefaultBranch = vi.fn().mockResolvedValue("trunk");
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded());
    (repoFileCache.getRefList as any).mockResolvedValue(null);
    (repoFileCache.setRefList as any).mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await get();

    expect(res.status).toBe(401);
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 400 when the repository id or configId is not an integer", async () => {
    expect((await get({}, "abc")).status).toBe(400);
    expect((await get({ configId: "nope" })).status).toBe(400);
    expect(listCommits).not.toHaveBeenCalled();
  });

  it("returns 404 when the config is not visible to this user", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    expect((await get()).status).toBe(404);
  });

  it("defaults to the config branch, the first page, and 30 per page", async () => {
    const res = await get();

    expect(listCommits).toHaveBeenCalledWith("main", {
      page: 1,
      perPage: 30,
      path: undefined,
    });
    await expect(res.json()).resolves.toMatchObject({
      ref: "main",
      page: 1,
      perPage: 30,
      commits: [expect.objectContaining({ sha: "aaa" })],
      hasMore: false,
    });
  });

  it("falls back to the repository default branch when the config has none", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(
      makeLoaded({ branch: null })
    );

    const res = await get();

    expect(getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(listCommits).toHaveBeenCalledWith("trunk", expect.anything());
    await expect(res.json()).resolves.toMatchObject({ ref: "trunk" });
  });

  it("passes the requested ref, page, size and path through", async () => {
    await get({
      ref: "release/v1.1",
      page: "3",
      perPage: "10",
      path: "lib/auth.ts",
    });

    expect(listCommits).toHaveBeenCalledWith("release/v1.1", {
      page: 3,
      perPage: 10,
      path: "lib/auth.ts",
    });
  });

  it("caps perPage at 100", async () => {
    expect((await get({ perPage: "500" })).status).toBe(400);
    expect(listCommits).not.toHaveBeenCalled();
  });

  describe("path safety", () => {
    beforeEach(() => {
      // No branch, so even resolving the default ref would reach the provider.
      (loadRepoConfigForUser as any).mockResolvedValue(
        makeLoaded({ branch: null })
      );
    });

    it.each([
      ["parent traversal", "../../etc/passwd"],
      ["traversal below a directory", "lib/../../secrets.env"],
      ["an absolute path", "/etc/passwd"],
      ["a windows separator", "lib\\auth.ts"],
      ["an empty segment", "lib//auth.ts"],
    ])("rejects %s before any provider call", async (_label, path) => {
      const res = await get({ path });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: "Invalid path" });
      expect(getDefaultBranch).not.toHaveBeenCalled();
      expect(listCommits).not.toHaveBeenCalled();
      expect(repoFileCache.getRefList).not.toHaveBeenCalled();
    });

    it("allows an ordinary repo-relative path", async () => {
      expect((await get({ path: "lib/services/auth.ts" })).status).toBe(200);
    });
  });

  describe("caching", () => {
    it("serves a cached page without calling the provider", async () => {
      (repoFileCache.getRefList as any).mockResolvedValue({
        commits: [makeCommit("cached")],
        hasMore: true,
      });

      const res = await get();

      expect(listCommits).not.toHaveBeenCalled();
      expect(repoFileCache.setRefList).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toMatchObject({ hasMore: true });
    });

    it("writes what the provider returned under the same key it read", async () => {
      await get();

      const readKey = (repoFileCache.getRefList as any).mock.calls[0];
      const writeKey = (repoFileCache.setRefList as any).mock.calls[0];
      expect(readKey.slice(0, 3)).toEqual([9, "commits", expect.any(String)]);
      expect(writeKey.slice(0, 3)).toEqual(readKey.slice(0, 3));
      expect(writeKey[3]).toEqual({
        commits: [expect.objectContaining({ sha: "aaa" })],
        hasMore: false,
      });
    });

    it("varies the key with the ref, the page, the page size and the path", async () => {
      const base = await cacheKey({});
      const byRef = await cacheKey({ ref: "develop" });
      const byPage = await cacheKey({ page: "2" });
      const byPerPage = await cacheKey({ perPage: "31" });
      const byPath = await cacheKey({ path: "lib/auth.ts" });

      expect(new Set([base, byRef, byPage, byPerPage, byPath]).size).toBe(5);
      await expect(cacheKey({})).resolves.toBe(base);
    });

    it("does not confuse an explicit ref with the same branch by default", async () => {
      const implicit = await cacheKey({});
      const explicit = await cacheKey({ ref: "main" });

      expect(explicit).toBe(implicit);
    });

    it("neither reads nor writes the cache when the project turned caching off", async () => {
      (loadRepoConfigForUser as any).mockResolvedValue(
        makeLoaded({ cacheEnabled: false })
      );

      const res = await get();

      expect(repoFileCache.getRefList).not.toHaveBeenCalled();
      expect(repoFileCache.setRefList).not.toHaveBeenCalled();
      expect(listCommits).toHaveBeenCalled();
      expect(res.status).toBe(200);
    });
  });

  describe("provider failures", () => {
    it("answers 404 when the ref does not exist", async () => {
      listCommits.mockRejectedValue(
        new Error("HTTP 404 Not Found: no such ref")
      );

      const res = await get({ ref: "nope" });

      expect(res.status).toBe(404);
      expect(repoFileCache.setRefList).not.toHaveBeenCalled();
    });

    it("answers 502 on any other provider failure", async () => {
      listCommits.mockRejectedValue(
        new Error("HTTP 500 Internal Server Error")
      );

      const res = await get();

      expect(res.status).toBe(502);
    });
  });
});
