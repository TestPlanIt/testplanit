import { describe, expect, it, vi } from "vitest";
import type { RepoCommit } from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  walkCommits,
  type CommitWalkCache,
  type CommitWalkStore,
} from "./commitWalk";

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: { getRefList: vi.fn(), setRefList: vi.fn() },
}));

const now = new Date("2026-09-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function commit(n: number, daysAgo = n): RepoCommit {
  const sha = n.toString(16).padStart(40, "0");
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message: `commit ${n}`,
    authorName: "dev",
    authoredAt: new Date(now.getTime() - daysAgo * DAY).toISOString(),
    parents: [(n + 1).toString(16).padStart(40, "0")],
  };
}

/** A branch whose history is commit(1) (newest) … commit(total). */
function branch(total: number, perPage = 100) {
  const all = Array.from({ length: total }, (_, i) => commit(i + 1));
  const bySha = new Map(all.map((c, i) => [c.sha, i]));
  const listCommits = vi.fn(
    async (ref: string, opts: { page?: number; perPage?: number } = {}) => {
      const start = ref === "main" ? 0 : (bySha.get(ref) ?? -1);
      if (start < 0) return { commits: [], hasMore: false };
      const size = opts.perPage ?? perPage;
      const from = start + ((opts.page ?? 1) - 1) * size;
      const commits = all.slice(from, from + size);
      return { commits, hasMore: from + size < all.length };
    }
  );
  return { all, listCommits };
}

function memoryStore(initial: CommitWalkCache | null = null) {
  let value = initial;
  const store: CommitWalkStore & { value: () => CommitWalkCache | null } = {
    load: vi.fn(async () => value),
    save: vi.fn(async (cache: CommitWalkCache) => {
      value = cache;
    }),
    value: () => value,
  };
  return store;
}

describe("walkCommits", () => {
  it("walks the whole branch when there is no cache and saves it complete", async () => {
    const repo = branch(250);
    const store = memoryStore();

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      store,
      now,
    });

    expect(result.commits).toHaveLength(250);
    expect(result).toMatchObject({
      truncated: false,
      complete: true,
      fromCache: 0,
    });
    expect(repo.listCommits).toHaveBeenCalledTimes(3);
    expect(store.value()).toMatchObject({
      branch: "main",
      tipSha: repo.all[0].sha,
      complete: true,
    });
    expect(store.value()?.commits).toHaveLength(250);
  });

  it("stops at the cap, saves an incomplete cache, and reports truncation", async () => {
    const repo = branch(250);
    const store = memoryStore();

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 120,
      store,
      now,
    });

    expect(result.commits).toHaveLength(120);
    expect(result).toMatchObject({ truncated: true, complete: false });
    expect(store.value()).toMatchObject({ complete: false });
    expect(store.value()?.commits).toHaveLength(120);
  });

  it("reads only the commits newer than the cached tip and joins the rest from the cache", async () => {
    const repo = branch(250);
    // The cache knows commits 5..250 (the tip has moved on by four commits).
    const store = memoryStore({
      branch: "main",
      tipSha: repo.all[4].sha,
      complete: true,
      walkedAt: now.toISOString(),
      commits: repo.all.slice(4),
    });

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      store,
      now,
    });

    expect(result.commits.map((c) => c.sha)).toEqual(
      repo.all.map((c) => c.sha)
    );
    expect(result).toMatchObject({
      complete: true,
      truncated: false,
      fromCache: 246,
    });
    expect(repo.listCommits).toHaveBeenCalledTimes(1);
    expect(store.value()?.tipSha).toBe(repo.all[0].sha);
  });

  it("resumes a full walk from the oldest cached commit instead of starting over", async () => {
    const repo = branch(250);
    const store = memoryStore({
      branch: "main",
      tipSha: repo.all[0].sha,
      complete: false,
      walkedAt: now.toISOString(),
      commits: repo.all.slice(0, 100),
    });

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      continueFromCache: true,
      store,
      now,
    });

    expect(result.commits).toHaveLength(250);
    expect(result).toMatchObject({
      complete: true,
      truncated: false,
      fromCache: 100,
    });
    // One page from the tip (hits the cache at once), then pages from the
    // oldest cached commit onward.
    const refs = repo.listCommits.mock.calls.map(([ref]) => ref);
    expect(refs[0]).toBe("main");
    expect(refs.slice(1).every((ref) => ref === repo.all[99].sha)).toBe(true);
    expect(store.value()).toMatchObject({ complete: true });
    expect(store.value()?.commits).toHaveLength(250);
  });

  it("a resumed walk still honours the cap and keeps the cache growing", async () => {
    const repo = branch(250);
    const store = memoryStore({
      branch: "main",
      tipSha: repo.all[0].sha,
      complete: false,
      walkedAt: now.toISOString(),
      commits: repo.all.slice(0, 100),
    });

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 180,
      continueFromCache: true,
      store,
      now,
    });

    expect(result.commits).toHaveLength(180);
    expect(result).toMatchObject({ truncated: true, complete: false });
    expect(store.value()?.commits).toHaveLength(180);
    expect(store.value()).toMatchObject({ complete: false });
  });

  it("does not resume past the window for a recent-window walk", async () => {
    const repo = branch(250);
    const store = memoryStore({
      branch: "main",
      tipSha: repo.all[0].sha,
      complete: false,
      walkedAt: now.toISOString(),
      commits: repo.all.slice(0, 100),
    });

    const result = await walkCommits(repo, "main", {
      lookbackDays: 30,
      maxCommits: 1000,
      store,
      now,
    });

    // commit(n) is n days old, so the window holds commits 1..30.
    expect(result.commits).toHaveLength(30);
    expect(result).toMatchObject({
      truncated: false,
      complete: false,
      fromCache: 30,
    });
    expect(repo.listCommits).toHaveBeenCalledTimes(1);
  });

  it("stops a fresh walk at the window and leaves a longer cache alone", async () => {
    const repo = branch(250);
    const stale: CommitWalkCache = {
      branch: "main",
      tipSha: "f".repeat(40), // a tip this branch never had
      complete: true,
      walkedAt: now.toISOString(),
      commits: [{ ...commit(999, 999), sha: "f".repeat(40) }],
    };
    const store = memoryStore(stale);

    const result = await walkCommits(repo, "main", {
      lookbackDays: 10,
      maxCommits: 1000,
      store,
      now,
    });

    expect(result.commits).toHaveLength(10);
    expect(result.fromCache).toBe(0);
    expect(store.save).not.toHaveBeenCalled();
  });

  it("replaces a cache the tip no longer reaches when the fresh walk runs out", async () => {
    const repo = branch(50);
    const store = memoryStore({
      branch: "main",
      tipSha: "f".repeat(40),
      complete: true,
      walkedAt: now.toISOString(),
      commits: [{ ...commit(999, 999), sha: "f".repeat(40) }],
    });

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      store,
      now,
    });

    expect(result.commits).toHaveLength(50);
    expect(result.fromCache).toBe(0);
    expect(store.value()?.tipSha).toBe(repo.all[0].sha);
    expect(store.value()?.commits).toHaveLength(50);
  });

  it("caps the returned list from a longer cache and reports it truncated", async () => {
    const repo = branch(250);
    const store = memoryStore({
      branch: "main",
      tipSha: repo.all[0].sha,
      complete: true,
      walkedAt: now.toISOString(),
      commits: repo.all,
    });

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 60,
      store,
      now,
    });

    expect(result.commits).toHaveLength(60);
    expect(result).toMatchObject({
      truncated: true,
      complete: false,
      fromCache: 60,
    });
  });

  it("reports progress per page with the cached share", async () => {
    const repo = branch(250);
    const store = memoryStore({
      branch: "main",
      tipSha: repo.all[2].sha,
      complete: true,
      walkedAt: now.toISOString(),
      commits: repo.all.slice(2),
    });
    const onProgress = vi.fn();

    await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      store,
      now,
      onProgress,
    });

    expect(onProgress).toHaveBeenLastCalledWith(250, 248);
  });

  it("stops where it is when asked, keeps what it read, and says so", async () => {
    const repo = branch(250);
    const store = memoryStore();
    let pages = 0;
    const shouldStop = vi.fn(async () => ++pages > 2);

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      store,
      now,
      shouldStop,
    });

    expect(result.cancelled).toBe(true);
    expect(result.commits).toHaveLength(200);
    expect(result).toMatchObject({ truncated: true, complete: false });
    expect(store.value()?.commits).toHaveLength(200);
    expect(store.value()).toMatchObject({ complete: false });
  });

  it("works without a store", async () => {
    const repo = branch(120);

    const result = await walkCommits(repo, "main", {
      lookbackDays: Number.POSITIVE_INFINITY,
      maxCommits: 1000,
      now,
    });

    expect(result.commits).toHaveLength(120);
    expect(result).toMatchObject({ complete: true, fromCache: 0 });
  });
});
