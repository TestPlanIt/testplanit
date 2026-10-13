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
import { PullRequestsUnsupportedError } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const session = { user: { id: "user-1" } };

function makePr(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: `Fix the widget ${number}`,
    state: "open",
    authorName: "ada",
    sourceBranch: `feature-${number}`,
    targetBranch: "main",
    headSha: `head${number}`,
    baseSha: `base${number}`,
    url: `https://example.com/pull/${number}`,
    updatedAt: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

let listPullRequests: ReturnType<typeof vi.fn>;

function makeLoaded(cacheEnabled = true) {
  return {
    config: {
      id: 5,
      projectId: 1,
      purpose: "IMPACT",
      branch: "main",
      cacheEnabled,
      repositoryId: 9,
      repository: { id: 9, name: "acme/app", provider: "github" },
    },
    adapter: { listPullRequests },
  };
}

function makeRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/code-repositories/9/pull-requests");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function makeParams(id = "9") {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/code-repositories/[id]/pull-requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPullRequests = vi
      .fn()
      .mockResolvedValue({ pullRequests: [makePr(1)], hasMore: false });
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded());
    (repoFileCache.getRefList as any).mockResolvedValue(null);
    (repoFileCache.setRefList as any).mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await GET(makeRequest({ configId: "5" }), makeParams());

    expect(res.status).toBe(401);
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 400 when the repository id or configId is not an integer", async () => {
    const badId = await GET(makeRequest({ configId: "5" }), makeParams("abc"));
    expect(badId.status).toBe(400);

    const badConfig = await GET(
      makeRequest({ configId: "nope" }),
      makeParams()
    );
    expect(badConfig.status).toBe(400);
  });

  it("returns 404 when the config is not visible to this user", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await GET(makeRequest({ configId: "5" }), makeParams());

    expect(res.status).toBe(404);
  });

  it("rejects a state the contract does not define", async () => {
    const res = await GET(
      makeRequest({ configId: "5", state: "sideways" }),
      makeParams()
    );

    expect(res.status).toBe(400);
    expect(listPullRequests).not.toHaveBeenCalled();
  });

  it("defaults to all states, the first page, and 50 per page", async () => {
    await GET(makeRequest({ configId: "5" }), makeParams());

    expect(listPullRequests).toHaveBeenCalledWith({
      state: "all",
      page: 1,
      perPage: 50,
    });
  });

  it("passes the requested state and page through", async () => {
    const res = await GET(
      makeRequest({ configId: "5", state: "merged", page: "3", perPage: "10" }),
      makeParams()
    );

    expect(listPullRequests).toHaveBeenCalledWith({
      state: "merged",
      page: 3,
      perPage: 10,
    });
    await expect(res.json()).resolves.toMatchObject({
      state: "merged",
      page: 3,
      perPage: 10,
    });
  });

  it("caps perPage at 100", async () => {
    const res = await GET(
      makeRequest({ configId: "5", perPage: "500" }),
      makeParams()
    );

    expect(res.status).toBe(400);
  });

  it("returns 501 when the provider has no pull requests, so the picker can hide the mode", async () => {
    listPullRequests.mockRejectedValue(
      new PullRequestsUnsupportedError("SomeAdapter")
    );

    const res = await GET(makeRequest({ configId: "5" }), makeParams());

    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({ code: "unsupported" });
  });

  it("returns 502 with the provider message on any other failure", async () => {
    listPullRequests.mockRejectedValue(
      new Error("HTTP 500 Internal Server Error: upstream exploded")
    );

    const res = await GET(makeRequest({ configId: "5" }), makeParams());

    expect(res.status).toBe(502);
  });

  describe("search", () => {
    beforeEach(() => {
      listPullRequests.mockResolvedValue({
        pullRequests: [
          makePr(1, { title: "Checkout rewrite", authorName: "ada" }),
          makePr(22, { title: "Docs typo", authorName: "grace" }),
          makePr(3, {
            title: "Unrelated",
            authorName: "linus",
            sourceBranch: "fix/checkout-total",
          }),
        ],
        hasMore: false,
      });
    });

    async function search(term: string) {
      const res = await GET(
        makeRequest({ configId: "5", search: term }),
        makeParams()
      );
      const body = (await res.json()) as { pullRequests: { number: number }[] };
      return body.pullRequests.map((pr) => pr.number);
    }

    it("matches the title, case-insensitively", async () => {
      await expect(search("checkout")).resolves.toEqual([1, 3]);
    });

    it("matches the author", async () => {
      await expect(search("grace")).resolves.toEqual([22]);
    });

    it("matches the source branch", async () => {
      await expect(search("fix/")).resolves.toEqual([3]);
    });

    it("matches the number", async () => {
      await expect(search("22")).resolves.toEqual([22]);
    });

    it("filters after the provider call, so the search term stays out of the request", async () => {
      await search("checkout");

      expect(listPullRequests).toHaveBeenCalledWith({
        state: "all",
        page: 1,
        perPage: 50,
      });
    });
  });

  describe("caching", () => {
    it("serves a cached page without calling the provider", async () => {
      (repoFileCache.getRefList as any).mockResolvedValue({
        pullRequests: [makePr(7)],
        hasMore: true,
      });

      const res = await GET(makeRequest({ configId: "5" }), makeParams());

      expect(listPullRequests).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toMatchObject({ hasMore: true });
    });

    it("caches by state and page, so one filter does not serve another", async () => {
      await GET(makeRequest({ configId: "5", state: "open" }), makeParams());
      await GET(makeRequest({ configId: "5", state: "closed" }), makeParams());

      const [openKey] = (repoFileCache.setRefList as any).mock.calls[0].slice(
        2
      );
      const [closedKey] = (repoFileCache.setRefList as any).mock.calls[1].slice(
        2
      );
      expect(openKey).not.toBe(closedKey);
    });

    it("keeps the search term out of the cache key, so one fetch serves every keystroke", async () => {
      await GET(
        makeRequest({ configId: "5", state: "open", search: "checkout" }),
        makeParams()
      );
      await GET(
        makeRequest({ configId: "5", state: "open", search: "docs" }),
        makeParams()
      );

      const first = (repoFileCache.getRefList as any).mock.calls[0][2];
      const second = (repoFileCache.getRefList as any).mock.calls[1][2];
      expect(first).toBe(second);
    });

    it("neither reads nor writes the cache when the project turned caching off", async () => {
      (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded(false));

      await GET(makeRequest({ configId: "5" }), makeParams());

      expect(repoFileCache.getRefList).not.toHaveBeenCalled();
      expect(repoFileCache.setRefList).not.toHaveBeenCalled();
      expect(listPullRequests).toHaveBeenCalled();
    });
  });
});
