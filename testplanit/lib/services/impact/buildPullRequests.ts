import {
  PullRequestsUnsupportedError,
  type GitRepoAdapter,
  type RepoCommit,
  type RepoPullRequestRef,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import type { BuildChanges } from "./types";

export interface CollectBuildPullRequestsOptions {
  /** Newest commits looked up; the rest are counted, not fetched. */
  maxCommits: number;
  /** Parallel provider calls. */
  concurrency?: number;
  /** Commits to leave out entirely, such as a build bot's version bump. */
  excludeCommit?: (commit: RepoCommit) => boolean;
}

export interface BuildPullRequestsResult {
  /** Deduplicated by number, in the order each was first seen. */
  pullRequests: RepoPullRequestRef[];
  /** Looked-up commits no pull request contains, newest first. */
  orphanCommits: RepoCommit[];
  truncated: boolean;
  /** Commits beyond `maxCommits` that were not looked up. */
  uncheckedCommits: number;
  /** The provider has no per-commit pull request lookup. */
  unsupported: boolean;
}

/**
 * The pull requests behind a build: every commit of the range (newest first)
 * asked for the pull requests that contain it. A commit whose lookup fails
 * twice counts as an orphan rather than failing the whole list, since the
 * run is composed either way.
 */
export async function collectBuildPullRequests(
  adapter: Pick<GitRepoAdapter, "pullRequestsForCommit">,
  commits: RepoCommit[],
  opts: CollectBuildPullRequestsOptions
): Promise<BuildPullRequestsResult> {
  const kept = commits.filter((c) => !(opts.excludeCommit?.(c) ?? false));
  const max = Math.max(0, Math.floor(opts.maxCommits));
  const checked = kept.slice(0, max);
  const uncheckedCommits = kept.length - checked.length;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));

  const perCommit: (RepoPullRequestRef[] | null)[] = new Array(
    checked.length
  ).fill(null);
  let unsupported = false;
  let next = 0;
  const lookup = async (sha: string) => {
    try {
      return await adapter.pullRequestsForCommit(sha);
    } catch (err) {
      if (err instanceof PullRequestsUnsupportedError) throw err;
      // One retry covers a 429 or a 5xx; after that the commit is an orphan.
      return adapter.pullRequestsForCommit(sha);
    }
  };
  const runner = async () => {
    while (next < checked.length && !unsupported) {
      const index = next++;
      try {
        perCommit[index] = await lookup(checked[index].sha);
      } catch (err) {
        if (err instanceof PullRequestsUnsupportedError) {
          unsupported = true;
          return;
        }
        perCommit[index] = [];
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, checked.length) }, runner)
  );
  if (unsupported) {
    return {
      pullRequests: [],
      orphanCommits: [],
      truncated: false,
      uncheckedCommits: 0,
      unsupported: true,
    };
  }

  const seen = new Set<number>();
  const pullRequests: RepoPullRequestRef[] = [];
  const orphanCommits: RepoCommit[] = [];
  checked.forEach((commit, index) => {
    const refs = perCommit[index] ?? [];
    if (refs.length === 0) orphanCommits.push(commit);
    for (const ref of refs) {
      if (seen.has(ref.number)) continue;
      seen.add(ref.number);
      pullRequests.push(ref);
    }
  });
  return {
    pullRequests,
    orphanCommits,
    truncated: uncheckedCommits > 0,
    uncheckedCommits,
    unsupported: false,
  };
}

/** The first line of a commit message. */
export function commitSubject(message: string): string {
  return (message ?? "").split(/\r?\n/, 1)[0].trim();
}

/**
 * A matcher for commits a build bot writes, from a regular expression tested
 * against the message's first line. An empty or invalid pattern matches
 * nothing.
 */
export function botCommitMatcher(
  pattern: string | undefined
): (commit: RepoCommit) => boolean {
  const source = (pattern ?? "").trim();
  if (!source) return () => false;
  let re: RegExp;
  try {
    re = new RegExp(source);
  } catch {
    return () => false;
  }
  return (commit) => re.test(commitSubject(commit.message));
}

/** What the run note and the saved analysis keep of the lookup. */
export function toBuildChanges(result: BuildPullRequestsResult): BuildChanges {
  return {
    pullRequests: result.pullRequests,
    orphanCommits: result.orphanCommits.map((c) => ({
      shortSha: c.shortSha,
      subject: commitSubject(c.message),
      ...(c.url ? { url: c.url } : {}),
    })),
    truncated: result.truncated,
    uncheckedCommits: result.uncheckedCommits,
  };
}
