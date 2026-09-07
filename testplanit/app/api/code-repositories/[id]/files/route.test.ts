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
    getFiles: vi.fn(),
    getMeta: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const session = { user: { id: "user-1" } };

const cachedFiles = [
  { path: "src/a.ts", type: "file", size: 10 },
  { path: "src/b.ts", type: "file", size: 20 },
];
const liveFiles = [{ path: "live/only.ts", type: "file", size: 5 }];

function makeLoaded(
  over: Partial<{ branch: string | null; cacheEnabled: boolean }> = {}
) {
  return {
    config: {
      id: 5,
      projectId: 1,
      purpose: "IMPACT",
      branch: "main",
      cacheEnabled: true,
      repositoryId: 9,
      repository: {
        id: 9,
        name: "acme/app",
        provider: "github",
        settings: null,
      },
      ...over,
    },
    adapter: {
      getDefaultBranch: vi.fn().mockResolvedValue("develop"),
      listAllFiles: vi
        .fn()
        .mockResolvedValue({ files: liveFiles, truncated: false }),
    },
  };
}

function makeRequest(configId?: string) {
  const url = new URL("http://localhost/api/code-repositories/9/files");
  if (configId !== undefined) url.searchParams.set("configId", configId);
  return new NextRequest(url);
}

const params = { params: Promise.resolve({ id: "9" }) };

describe("GET /api/code-repositories/[id]/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded());
    (repoFileCache.getFiles as any).mockResolvedValue(cachedFiles);
    (repoFileCache.getMeta as any).mockResolvedValue({
      status: "success",
      truncated: false,
      lastUpdated: "2026-09-01T00:00:00.000Z",
    });
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(401);
  });

  it("returns 400 when configId is missing", async () => {
    const res = await GET(makeRequest(), params);

    expect(res.status).toBe(400);
  });

  it("returns 404 when the config is not visible", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(404);
    expect(repoFileCache.getFiles).not.toHaveBeenCalled();
  });

  it("returns 409 cache_empty (with the meta) when nothing is cached", async () => {
    (repoFileCache.getFiles as any).mockResolvedValue(null);
    (repoFileCache.getMeta as any).mockResolvedValue({
      status: "error",
      error: "rate limited",
    });

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "cache_empty",
      meta: { status: "error", error: "rate limited" },
    });
  });

  it("returns 200 from the cache with source 'cache'", async () => {
    const loaded = makeLoaded();
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: cachedFiles,
      meta: {
        status: "success",
        truncated: false,
        lastUpdated: "2026-09-01T00:00:00.000Z",
      },
      truncated: false,
      source: "cache",
    });
    expect(repoFileCache.getFiles).toHaveBeenCalledWith(5);
    expect(repoFileCache.getMeta).toHaveBeenCalledWith(5);
    expect(loaded.adapter.listAllFiles).not.toHaveBeenCalled();
  });

  it("reflects a truncated cache listing", async () => {
    (repoFileCache.getMeta as any).mockResolvedValue({
      status: "success",
      truncated: true,
    });

    const res = await GET(makeRequest("5"), params);

    expect((await res.json()).truncated).toBe(true);
  });

  it("lists live from the provider when cacheEnabled is false", async () => {
    const loaded = makeLoaded({ cacheEnabled: false });
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: liveFiles,
      meta: null,
      truncated: false,
      source: "live",
    });
    expect(loaded.adapter.listAllFiles).toHaveBeenCalledWith("main");
    expect(loaded.adapter.getDefaultBranch).not.toHaveBeenCalled();
    expect(repoFileCache.getFiles).not.toHaveBeenCalled();
    expect(repoFileCache.getMeta).not.toHaveBeenCalled();
  });

  it("lists live from the default branch when the privacy-mode config has no branch", async () => {
    const loaded = makeLoaded({ cacheEnabled: false, branch: null });
    loaded.adapter.listAllFiles.mockResolvedValue({
      files: liveFiles,
      truncated: true,
    });
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(200);
    expect((await res.json()).truncated).toBe(true);
    expect(loaded.adapter.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(loaded.adapter.listAllFiles).toHaveBeenCalledWith("develop");
  });

  it("returns 502 when the live listing fails", async () => {
    const loaded = makeLoaded({ cacheEnabled: false });
    loaded.adapter.listAllFiles.mockRejectedValue(
      new Error("Bitbucket API error: 429 Too Many Requests")
    );
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);

    const res = await GET(makeRequest("5"), params);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Bitbucket API error: 429 Too Many Requests",
    });
  });
});
