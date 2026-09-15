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
import { MAX_BRANCHES } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const session = { user: { id: "user-1" } };

function branch(name: string, isDefault = false) {
  return { name, sha: `sha-${name}`, isDefault };
}

let listBranches: ReturnType<typeof vi.fn>;
let searchBranches: ReturnType<typeof vi.fn>;

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
    adapter: { listBranches, searchBranches },
  };
}

function get(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/code-repositories/9/branches");
  url.searchParams.set("configId", "5");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new NextRequest(url), { params: Promise.resolve({ id: "9" }) });
}

const capped = Array.from({ length: MAX_BRANCHES }, (_, i) =>
  branch(i === 0 ? "main" : `feature/${i}`, i === 0)
);

describe("GET /api/code-repositories/[id]/branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBranches = vi
      .fn()
      .mockResolvedValue([branch("main", true), branch("release/1.0")]);
    searchBranches = vi.fn().mockResolvedValue([]);
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded());
    (repoFileCache.getRefList as any).mockResolvedValue(null);
    (repoFileCache.setRefList as any).mockResolvedValue(undefined);
  });

  it("lists the branches, the default, and the configured branch", async () => {
    const res = await get();

    await expect(res.json()).resolves.toMatchObject({
      branches: [branch("main", true), branch("release/1.0")],
      defaultBranch: "main",
      configuredBranch: "main",
      truncated: false,
      query: "",
    });
    expect(repoFileCache.setRefList).toHaveBeenCalledWith(
      9,
      "branches",
      "all",
      expect.objectContaining({ defaultBranch: "main" })
    );
  });

  it("filters a complete list locally without asking the provider", async () => {
    const res = await get({ q: "REL" });

    await expect(res.json()).resolves.toMatchObject({
      branches: [branch("release/1.0")],
      truncated: false,
      query: "REL",
    });
    expect(searchBranches).not.toHaveBeenCalled();
  });

  it("flags a capped list as truncated", async () => {
    listBranches.mockResolvedValue(capped);

    await expect((await get()).json()).resolves.toMatchObject({
      truncated: true,
    });
  });

  it("merges local matches with what the provider finds for a capped list", async () => {
    listBranches.mockResolvedValue(capped);
    searchBranches.mockResolvedValue([
      branch("feature/1"),
      branch("release/9.0"),
    ]);

    const res = await get({ q: "1" });
    const body = await res.json();

    expect(searchBranches).toHaveBeenCalledWith("1");
    const names = body.branches.map((b: { name: string }) => b.name);
    expect(names[0]).toBe("feature/1");
    expect(names.filter((n: string) => n === "feature/1")).toHaveLength(1);
    expect(names.at(-1)).toBe("release/9.0");
    expect(repoFileCache.setRefList).toHaveBeenCalledWith(
      9,
      "branches",
      "q:1",
      expect.any(Array)
    );
  });

  it("serves a cached search without asking the provider again", async () => {
    listBranches.mockResolvedValue(capped);
    (repoFileCache.getRefList as any).mockImplementation(
      async (_id: number, _kind: string, key: string) =>
        key === "q:zzz" ? [branch("zzz/1")] : null
    );

    const res = await get({ q: "zzz" });

    await expect(res.json()).resolves.toMatchObject({
      branches: [branch("zzz/1")],
    });
    expect(searchBranches).not.toHaveBeenCalled();
  });

  it("skips the cache when file caching is off", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(
      makeLoaded({ cacheEnabled: false })
    );

    await get({ q: "main" });

    expect(repoFileCache.getRefList).not.toHaveBeenCalled();
    expect(repoFileCache.setRefList).not.toHaveBeenCalled();
  });
});
