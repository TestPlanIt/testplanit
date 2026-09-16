import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    codeRepository: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/integrations/adapters/GitRepoAdapter", () => ({
  createGitRepoAdapter: vi.fn(),
}));
vi.mock("~/utils/ssrf", () => ({ isSsrfSafe: vi.fn().mockReturnValue(true) }));

import { getServerSession } from "next-auth/next";
import { baseDb } from "@/lib/db";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { encrypt } from "@/utils/encryption";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/code-repositories/test-connection", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    })
  );
}

let testConnection: ReturnType<typeof vi.fn>;

describe("POST /api/code-repositories/test-connection", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "admin-1" } });
    (baseDb.user.findUnique as any).mockResolvedValue({ access: "ADMIN" });
    (baseDb.codeRepository.update as any).mockResolvedValue({});
    testConnection = vi.fn().mockResolvedValue({ success: true });
    (createGitRepoAdapter as any).mockReturnValue({ testConnection });
  });

  it("refuses anonymous and non-admin callers", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await post({ provider: "GITHUB", credentials: {} })).status).toBe(
      401
    );

    (getServerSession as any).mockResolvedValue({ user: { id: "u" } });
    (baseDb.user.findUnique as any).mockResolvedValue({ access: "USER" });
    expect((await post({ provider: "GITHUB", credentials: {} })).status).toBe(
      403
    );
    expect(createGitRepoAdapter).not.toHaveBeenCalled();
  });

  it("tests the credentials typed into a new repository form as they are", async () => {
    const res = await post({
      provider: "GITHUB",
      credentials: { personalAccessToken: "ghp_new" },
      settings: { owner: "o", repo: "r" },
    });

    expect(res.status).toBe(200);
    expect(createGitRepoAdapter).toHaveBeenCalledWith(
      "GITHUB",
      { personalAccessToken: "ghp_new" },
      { owner: "o", repo: "r" }
    );
    expect(baseDb.codeRepository.findUnique).not.toHaveBeenCalled();
    expect(baseDb.codeRepository.update).not.toHaveBeenCalled();
  });

  it("merges retyped secrets over the stored, encrypted ones and ignores blanks", async () => {
    (baseDb.codeRepository.findUnique as any).mockResolvedValue({
      provider: "BITBUCKET",
      settings: { workspace: "w", repoSlug: "s" },
      credentials: {
        encrypted: await encrypt(
          JSON.stringify({ email: "a@b.c", apiToken: "old" })
        ),
      },
    });

    const res = await post({
      repositoryId: "9",
      provider: "BITBUCKET",
      credentials: { email: "", apiToken: "new" },
      settings: { workspace: "w", repoSlug: "s" },
    });

    expect(res.status).toBe(200);
    expect(createGitRepoAdapter).toHaveBeenCalledWith(
      "BITBUCKET",
      { email: "a@b.c", apiToken: "new" },
      { workspace: "w", repoSlug: "s" }
    );
    expect(baseDb.codeRepository.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { lastTestedAt: expect.any(Date), status: "ACTIVE" },
    });
  });

  it("falls back to the stored provider and settings, and reads legacy plaintext rows", async () => {
    (baseDb.codeRepository.findUnique as any).mockResolvedValue({
      provider: "GITHUB",
      settings: { owner: "o", repo: "r" },
      credentials: { personalAccessToken: "plain" },
    });

    await post({ repositoryId: 4 });

    expect(createGitRepoAdapter).toHaveBeenCalledWith(
      "GITHUB",
      { personalAccessToken: "plain" },
      { owner: "o", repo: "r" }
    );
  });

  it("marks the repository ERROR when the test fails, and 404s an unknown one", async () => {
    testConnection.mockResolvedValue({ success: false, error: "bad token" });
    (baseDb.codeRepository.findUnique as any).mockResolvedValue({
      provider: "GITHUB",
      settings: null,
      credentials: { personalAccessToken: "x" },
    });

    const res = await post({ repositoryId: "4" });
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "bad token",
    });
    expect(baseDb.codeRepository.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { status: "ERROR" },
    });

    (baseDb.codeRepository.findUnique as any).mockResolvedValue(null);
    expect((await post({ repositoryId: "99" })).status).toBe(404);
  });
});
