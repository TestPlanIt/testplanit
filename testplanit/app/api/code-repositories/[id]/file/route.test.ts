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

vi.mock("~/lib/services/impact/compareService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/lib/services/impact/compareService")
    >();
  return { ...actual, resolveRefToSha: vi.fn() };
});

// isSafeRepoPath and FileTooLargeError stay real; only the read is stubbed.
vi.mock("~/lib/services/impact/fileAtCommit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/impact/fileAtCommit")>();
  return { ...actual, getFileAtCommit: vi.fn() };
});

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {},
}));

import { getServerSession } from "next-auth";
import {
  RefNotFoundError,
  resolveRefToSha,
} from "~/lib/services/impact/compareService";
import {
  FileTooLargeError,
  getFileAtCommit,
} from "~/lib/services/impact/fileAtCommit";
import { loadRepoConfigForUser } from "~/lib/services/impact/repoAccess";
import { GET } from "./route";

const SHA = "d".repeat(40);
const session = { user: { id: "user-1" } };

function makeAdapter() {
  return { getDefaultBranch: vi.fn().mockResolvedValue("develop") };
}

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
    adapter: makeAdapter(),
  };
}

function makeRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/code-repositories/9/file");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

const params = { params: Promise.resolve({ id: "9" }) };

describe("GET /api/code-repositories/[id]/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(session);
    (loadRepoConfigForUser as any).mockResolvedValue(makeLoaded());
    (resolveRefToSha as any).mockResolvedValue(SHA);
    (getFileAtCommit as any).mockResolvedValue({
      content: "export const a = 1;\n",
      cached: false,
    });
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts" }),
      params
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 when the config is not visible", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts" }),
      params
    );

    expect(res.status).toBe(404);
    expect(loadRepoConfigForUser).toHaveBeenCalledWith(session, 5, {
      repositoryId: 9,
    });
  });

  it("returns 400 when path is missing", async () => {
    const res = await GET(makeRequest({ configId: "5" }), params);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid query" });
    expect(resolveRefToSha).not.toHaveBeenCalled();
  });

  it.each(["../etc/passwd", "/etc/passwd", "src\\a.ts", "src//a.ts"])(
    "returns 400 for the unsafe path %s",
    async (path) => {
      const res = await GET(makeRequest({ configId: "5", path }), params);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid query" });
      expect(getFileAtCommit).not.toHaveBeenCalled();
    }
  );

  it("returns 413 when the file exceeds the size cap", async () => {
    (getFileAtCommit as any).mockRejectedValue(
      new FileTooLargeError("src/big.bin", 2_000_000)
    );

    const res = await GET(
      makeRequest({ configId: "5", path: "src/big.bin" }),
      params
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "File too large: src/big.bin (2000000 bytes)",
    });
  });

  it("returns 404 'File not found' for a 404 provider error", async () => {
    (getFileAtCommit as any).mockRejectedValue(
      new Error("GitHub API error: 404 Not Found")
    );

    const res = await GET(
      makeRequest({ configId: "5", path: "src/gone.ts" }),
      params
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "File not found" });
  });

  it("returns 404 when the ref cannot be resolved", async () => {
    (resolveRefToSha as any).mockRejectedValue(new RefNotFoundError("ghost"));

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts", ref: "ghost" }),
      params
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Ref not found: ghost" });
  });

  it("returns 502 for any other provider failure", async () => {
    (getFileAtCommit as any).mockRejectedValue(
      new Error("GitLab API error: 500 Internal Server Error")
    );

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts" }),
      params
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "GitLab API error: 500 Internal Server Error",
    });
  });

  it("returns 200 with { path, ref, sha, content, cached } using the config branch by default", async () => {
    const loaded = makeLoaded();
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);
    (getFileAtCommit as any).mockResolvedValue({
      content: "body",
      cached: true,
    });

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts" }),
      params
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: "src/a.ts",
      ref: "main",
      sha: SHA,
      content: "body",
      cached: true,
    });
    expect(resolveRefToSha).toHaveBeenCalledWith(loaded.adapter, "main");
    expect(getFileAtCommit).toHaveBeenCalledWith({
      configId: 5,
      cacheEnabled: true,
      adapter: loaded.adapter,
      path: "src/a.ts",
      sha: SHA,
    });
    expect(loaded.adapter.getDefaultBranch).not.toHaveBeenCalled();
  });

  it("uses the explicit ref when one is given", async () => {
    const loaded = makeLoaded();
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts", ref: "release/2" }),
      params
    );

    expect(res.status).toBe(200);
    expect((await res.json()).ref).toBe("release/2");
    expect(resolveRefToSha).toHaveBeenCalledWith(loaded.adapter, "release/2");
  });

  it("falls back to the repository default branch when the config has none", async () => {
    const loaded = makeLoaded({ branch: null });
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);

    const res = await GET(
      makeRequest({ configId: "5", path: "src/a.ts" }),
      params
    );

    expect(res.status).toBe(200);
    expect((await res.json()).ref).toBe("develop");
    expect(loaded.adapter.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(resolveRefToSha).toHaveBeenCalledWith(loaded.adapter, "develop");
  });
});
