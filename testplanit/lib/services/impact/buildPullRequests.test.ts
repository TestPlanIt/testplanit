import { describe, expect, it, vi } from "vitest";
import {
  PullRequestsUnsupportedError,
  type RepoCommit,
  type RepoPullRequestRef,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  botCommitMatcher,
  collectBuildPullRequests,
  commitSubject,
  toBuildChanges,
} from "./buildPullRequests";

function commit(sha: string, message: string): RepoCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    authorName: "dev",
    authoredAt: "2026-10-15T23:00:00Z",
    parents: [],
    url: `https://bitbucket.org/acme/app/commits/${sha}`,
  };
}

function pr(number: number): RepoPullRequestRef {
  return {
    number,
    title: `PR ${number}`,
    url: `https://bitbucket.org/acme/app/pull-requests/${number}`,
  };
}

const BUMP = commit(
  "2828d02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Update version code to 904003"
);
const C1 = commit(
  "5ae21baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Fix the pip token crash\n\nDetails."
);
const C2 = commit(
  "ae4cd34aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Add a test for the pip token"
);
const C3 = commit(
  "e34a9acaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Add test coverage for Share With Public"
);
const C4 = commit(
  "813043caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "Sync worker foreground not allowed"
);

function adapterFor(map: Record<string, RepoPullRequestRef[] | Error>) {
  return {
    pullRequestsForCommit: vi.fn(async (sha: string) => {
      const entry = map[sha];
      if (entry instanceof Error) throw entry;
      return entry ?? [];
    }),
  };
}

describe("collectBuildPullRequests", () => {
  it("deduplicates pull requests across commits and keeps first-seen order", async () => {
    const adapter = adapterFor({
      [C1.sha]: [pr(2957)],
      [C2.sha]: [pr(2957)],
      [C4.sha]: [pr(2960), pr(2957)],
    });

    const result = await collectBuildPullRequests(adapter, [C1, C2, C4], {
      maxCommits: 100,
    });

    expect(result.pullRequests.map((p) => p.number)).toEqual([2957, 2960]);
    expect(result.orphanCommits).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.unsupported).toBe(false);
    expect(adapter.pullRequestsForCommit).toHaveBeenCalledTimes(3);
  });

  it("lists commits no pull request contains as orphans, newest first", async () => {
    const adapter = adapterFor({ [C1.sha]: [pr(2957)] });

    const result = await collectBuildPullRequests(adapter, [C3, C1, C2], {
      maxCommits: 100,
    });

    expect(result.orphanCommits.map((c) => c.shortSha)).toEqual([
      "e34a9ac",
      "ae4cd34",
    ]);
  });

  it("leaves excluded commits out of both lists and never asks about them", async () => {
    const adapter = adapterFor({ [C1.sha]: [pr(2957)] });

    const result = await collectBuildPullRequests(adapter, [BUMP, C1], {
      maxCommits: 100,
      excludeCommit: botCommitMatcher("^Update version code to "),
    });

    expect(result.orphanCommits).toEqual([]);
    expect(adapter.pullRequestsForCommit).not.toHaveBeenCalledWith(BUMP.sha);
    expect(result.pullRequests.map((p) => p.number)).toEqual([2957]);
  });

  it("looks up only the newest maxCommits and reports the rest as unchecked", async () => {
    const adapter = adapterFor({ [C1.sha]: [pr(2957)], [C3.sha]: [pr(1)] });

    const result = await collectBuildPullRequests(adapter, [C1, C2, C3, C4], {
      maxCommits: 2,
    });

    expect(adapter.pullRequestsForCommit).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(true);
    expect(result.uncheckedCommits).toBe(2);
    expect(result.pullRequests.map((p) => p.number)).toEqual([2957]);
    expect(result.orphanCommits.map((c) => c.shortSha)).toEqual(["ae4cd34"]);
  });

  it("retries a failed lookup once, then counts the commit as an orphan", async () => {
    const calls: string[] = [];
    const adapter = {
      pullRequestsForCommit: vi.fn(async (sha: string) => {
        calls.push(sha);
        if (sha === C1.sha) throw new Error("HTTP 429");
        if (sha === C2.sha && calls.filter((c) => c === sha).length === 1) {
          throw new Error("HTTP 502");
        }
        return sha === C2.sha ? [pr(2957)] : [];
      }),
    };

    const result = await collectBuildPullRequests(adapter, [C1, C2], {
      maxCommits: 100,
      concurrency: 1,
    });

    expect(calls.filter((c) => c === C1.sha)).toHaveLength(2);
    expect(calls.filter((c) => c === C2.sha)).toHaveLength(2);
    expect(result.orphanCommits.map((c) => c.shortSha)).toEqual(["5ae21ba"]);
    expect(result.pullRequests.map((p) => p.number)).toEqual([2957]);
  });

  it("reports an unsupported provider instead of throwing", async () => {
    const adapter = {
      pullRequestsForCommit: vi.fn(async () => {
        throw new PullRequestsUnsupportedError("GiteaRepoAdapter");
      }),
    };

    const result = await collectBuildPullRequests(adapter, [C1, C2, C3], {
      maxCommits: 100,
    });

    expect(result).toEqual({
      pullRequests: [],
      orphanCommits: [],
      truncated: false,
      uncheckedCommits: 0,
      unsupported: true,
    });
  });

  it("runs lookups with the given concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const adapter = {
      pullRequestsForCommit: vi.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return [];
      }),
    };

    await collectBuildPullRequests(adapter, [C1, C2, C3, C4, BUMP], {
      maxCommits: 100,
      concurrency: 2,
    });

    expect(peak).toBe(2);
    expect(adapter.pullRequestsForCommit).toHaveBeenCalledTimes(5);
  });
});

describe("commitSubject / botCommitMatcher / toBuildChanges", () => {
  it("takes the first line of the message", () => {
    expect(commitSubject("Fix it\n\nBody")).toBe("Fix it");
    expect(commitSubject("  Trim me \r\nnext")).toBe("Trim me");
    expect(commitSubject("")).toBe("");
  });

  it("matches nothing for an empty or invalid pattern", () => {
    expect(botCommitMatcher("")(BUMP)).toBe(false);
    expect(botCommitMatcher(undefined)(BUMP)).toBe(false);
    expect(botCommitMatcher("[")(BUMP)).toBe(false);
    expect(botCommitMatcher("^Update version code to ")(BUMP)).toBe(true);
    expect(botCommitMatcher("^Update version code to ")(C1)).toBe(false);
  });

  it("keeps the short sha, subject and link of each orphan", () => {
    const changes = toBuildChanges({
      pullRequests: [pr(2957)],
      orphanCommits: [C1, { ...C3, url: undefined }],
      truncated: true,
      uncheckedCommits: 3,
      unsupported: false,
    });
    expect(changes).toEqual({
      pullRequests: [pr(2957)],
      orphanCommits: [
        {
          shortSha: "5ae21ba",
          subject: "Fix the pip token crash",
          url: C1.url,
        },
        {
          shortSha: "e34a9ac",
          subject: "Add test coverage for Share With Public",
        },
      ],
      truncated: true,
      uncheckedCommits: 3,
    });
  });
});
