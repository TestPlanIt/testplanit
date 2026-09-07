import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  baseDb: {
    codeRepository: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/integrations/adapters/GitRepoAdapter", () => ({
  createGitRepoAdapter: vi.fn(),
}));

vi.mock("~/lib/integrations/credentials", () => ({
  resolveStoredCredentials: vi.fn(),
}));

import { baseDb } from "@/lib/db";
import type { Session } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { resolveStoredCredentials } from "~/lib/integrations/credentials";
import {
  findImpactConfigId,
  loadRepoConfigForUser,
  loadRepoConfigForWorker,
} from "./repoAccess";

const session = { user: { id: "user-1" } } as unknown as Session;

const configRow = {
  id: 11,
  projectId: 4,
  purpose: "IMPACT" as const,
  branch: "main",
  cacheEnabled: true,
  repositoryId: 22,
  repository: {
    id: 22,
    name: "acme/app",
    provider: "github",
    settings: { owner: "acme", repo: "app" },
    isDeleted: false,
  },
};

const fakeAdapter = { kind: "fake-adapter" };

function makeEnhancedDb(row: unknown) {
  return {
    projectCodeRepositoryConfig: {
      findFirst: vi.fn().mockResolvedValue(row),
    },
  };
}

describe("loadRepoConfigForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (baseDb.codeRepository.findUnique as any).mockResolvedValue({
      credentials: "encrypted-blob",
    });
    (resolveStoredCredentials as any).mockResolvedValue({ token: "t0k" });
    (createGitRepoAdapter as any).mockReturnValue(fakeAdapter);
  });

  it("returns null when the enhanced client finds no config", async () => {
    const db = makeEnhancedDb(null);
    (getEnhancedDb as any).mockResolvedValue(db);

    await expect(loadRepoConfigForUser(session, 11)).resolves.toBeNull();
    expect(getEnhancedDb).toHaveBeenCalledWith(session);
    expect(baseDb.codeRepository.findUnique).not.toHaveBeenCalled();
    expect(createGitRepoAdapter).not.toHaveBeenCalled();
  });

  it("returns null when the repository is soft-deleted", async () => {
    const db = makeEnhancedDb({
      ...configRow,
      repository: { ...configRow.repository, isDeleted: true },
    });
    (getEnhancedDb as any).mockResolvedValue(db);

    await expect(loadRepoConfigForUser(session, 11)).resolves.toBeNull();
    expect(baseDb.codeRepository.findUnique).not.toHaveBeenCalled();
    expect(createGitRepoAdapter).not.toHaveBeenCalled();
  });

  it("builds the adapter from credentials read via baseDb and resolveStoredCredentials", async () => {
    const db = makeEnhancedDb(configRow);
    (getEnhancedDb as any).mockResolvedValue(db);

    const loaded = await loadRepoConfigForUser(session, 11);

    expect(loaded).not.toBeNull();
    expect(loaded!.adapter).toBe(fakeAdapter);
    expect(loaded!.config).toEqual({
      id: 11,
      projectId: 4,
      purpose: "IMPACT",
      branch: "main",
      cacheEnabled: true,
      repositoryId: 22,
      repository: {
        id: 22,
        name: "acme/app",
        provider: "github",
        settings: { owner: "acme", repo: "app" },
      },
    });
    // isDeleted never leaks onto the loaded config.
    expect(loaded!.config.repository).not.toHaveProperty("isDeleted");

    // Credentials are read through the un-policed client, by repository id.
    expect(baseDb.codeRepository.findUnique).toHaveBeenCalledWith({
      where: { id: 22 },
      select: { credentials: true },
    });
    expect(resolveStoredCredentials).toHaveBeenCalledWith(
      "encrypted-blob",
      "github"
    );
    expect(createGitRepoAdapter).toHaveBeenCalledWith(
      "github",
      { token: "t0k" },
      { owner: "acme", repo: "app" }
    );
  });

  it("passes null settings to the adapter factory when the repository has none", async () => {
    const db = makeEnhancedDb({
      ...configRow,
      repository: { ...configRow.repository, settings: null },
    });
    (getEnhancedDb as any).mockResolvedValue(db);

    await loadRepoConfigForUser(session, 11);

    expect(createGitRepoAdapter).toHaveBeenCalledWith(
      "github",
      { token: "t0k" },
      null
    );
  });

  it("resolves credentials as undefined when the repository row is missing", async () => {
    const db = makeEnhancedDb(configRow);
    (getEnhancedDb as any).mockResolvedValue(db);
    (baseDb.codeRepository.findUnique as any).mockResolvedValue(null);

    await loadRepoConfigForUser(session, 11);

    expect(resolveStoredCredentials).toHaveBeenCalledWith(undefined, "github");
  });

  it("queries only by id when no options are given", async () => {
    const db = makeEnhancedDb(configRow);
    (getEnhancedDb as any).mockResolvedValue(db);

    await loadRepoConfigForUser(session, 11);

    const args = db.projectCodeRepositoryConfig.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: 11 });
    expect(args.select.repository.select.isDeleted).toBe(true);
  });

  it("passes purpose and repositoryId into the where clause", async () => {
    const db = makeEnhancedDb(configRow);
    (getEnhancedDb as any).mockResolvedValue(db);

    await loadRepoConfigForUser(session, 11, {
      purpose: "IMPACT",
      repositoryId: 22,
    });

    const args = db.projectCodeRepositoryConfig.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({
      id: 11,
      purpose: "IMPACT",
      repositoryId: 22,
    });
  });

  it("passes only repositoryId when purpose is omitted", async () => {
    const db = makeEnhancedDb(configRow);
    (getEnhancedDb as any).mockResolvedValue(db);

    await loadRepoConfigForUser(session, 11, { repositoryId: 22 });

    const args = db.projectCodeRepositoryConfig.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: 11, repositoryId: 22 });
  });

  it("propagates a credential resolution failure instead of building a blind adapter", async () => {
    const db = makeEnhancedDb(configRow);
    (getEnhancedDb as any).mockResolvedValue(db);
    (resolveStoredCredentials as any).mockRejectedValue(
      new Error("credentials corrupt")
    );

    await expect(loadRepoConfigForUser(session, 11)).rejects.toThrow(
      "credentials corrupt"
    );
    expect(createGitRepoAdapter).not.toHaveBeenCalled();
  });
});

describe("loadRepoConfigForWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (baseDb.codeRepository.findUnique as any).mockResolvedValue({
      credentials: { token: "raw" },
    });
    (resolveStoredCredentials as any).mockResolvedValue({ token: "raw" });
    (createGitRepoAdapter as any).mockReturnValue(fakeAdapter);
  });

  it("uses the supplied client (not getEnhancedDb) and honors purpose", async () => {
    const db = makeEnhancedDb(configRow);

    const loaded = await loadRepoConfigForWorker(db, 11, { purpose: "IMPACT" });

    expect(loaded?.config.id).toBe(11);
    expect(getEnhancedDb).not.toHaveBeenCalled();
    const args = db.projectCodeRepositoryConfig.findFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: 11, purpose: "IMPACT" });
  });

  it("returns null when the supplied client finds nothing", async () => {
    const db = makeEnhancedDb(null);

    await expect(loadRepoConfigForWorker(db, 11)).resolves.toBeNull();
  });
});

describe("findImpactConfigId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters on purpose IMPACT for the project and returns the id", async () => {
    const db = makeEnhancedDb({ id: 99 });

    await expect(findImpactConfigId(db, 4)).resolves.toBe(99);
    expect(db.projectCodeRepositoryConfig.findFirst).toHaveBeenCalledWith({
      where: { projectId: 4, purpose: "IMPACT" },
      select: { id: true },
    });
  });

  it("returns null when the project has no Impact config", async () => {
    const db = makeEnhancedDb(null);

    await expect(findImpactConfigId(db, 4)).resolves.toBeNull();
  });
});
