import type {
  GitRepoAdapter,
  RepoCommit,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";

export interface CommitFilesRequest {
  configId: number;
  cacheEnabled: boolean;
  adapter: Pick<GitRepoAdapter, "compareCommits">;
  commit: Pick<RepoCommit, "sha" | "parents">;
  maxFiles: number;
}

export interface CommitFiles {
  /** Paths the commit touched, old and new names of a rename both included. */
  paths: string[];
  /** True when the file cap cut the list short. */
  capped: boolean;
}

const CACHE_KIND = "commit-files";
/** A commit's file list never changes, so keep it as long as the file cache. */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The files one commit changed, read as a compare against its first parent
 * with no patch text. Root commits have no parent and yield null. Cached per
 * config so a commit that several analyses and scans look at costs one call.
 */
export async function getCommitFilePaths(
  req: CommitFilesRequest
): Promise<CommitFiles | null> {
  const parent = req.commit.parents[0];
  if (!parent) return null;

  if (req.cacheEnabled) {
    const cached = await repoFileCache.getRefList<CommitFiles>(
      req.configId,
      CACHE_KIND,
      req.commit.sha
    );
    if (cached) return cached;
  }

  const result = await req.adapter.compareCommits(parent, req.commit.sha, {
    maxFilesWithPatch: 0,
    maxCommits: 1,
    maxFiles: req.maxFiles,
  });
  const paths = [
    ...new Set(
      result.files.flatMap((file) =>
        file.previousPath ? [file.path, file.previousPath] : [file.path]
      )
    ),
  ];
  const value: CommitFiles = {
    paths,
    capped: result.files.length >= req.maxFiles,
  };
  if (req.cacheEnabled) {
    await repoFileCache.setRefList(
      req.configId,
      CACHE_KIND,
      req.commit.sha,
      value,
      CACHE_TTL_SECONDS
    );
  }
  return value;
}
