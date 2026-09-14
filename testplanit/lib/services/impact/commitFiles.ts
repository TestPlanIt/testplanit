import type {
  GitRepoAdapter,
  RepoCommit,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { extractChangedSymbols } from "./diffSummary";

export interface CommitFilesRequest {
  configId: number;
  cacheEnabled: boolean;
  adapter: Pick<GitRepoAdapter, "compareCommits">;
  commit: Pick<RepoCommit, "sha" | "parents">;
  maxFiles: number;
  /**
   * Also read each file's patch and record the declarations it touched, so a
   * caller can pin symbols rather than whole files. Costs patch text per
   * file; providers without a server-side diff fetch both sides of each one.
   */
  withSymbols?: boolean;
}

export interface CommitFiles {
  /** Paths the commit touched, old and new names of a rename both included. */
  paths: string[];
  /** True when the file cap cut the list short. */
  capped: boolean;
  /**
   * Declared names each changed file's patch touched, when read with
   * `withSymbols`. A path with no entry had no patch or no recognizable
   * declaration in it.
   */
  symbolsByPath?: Record<string, string[]>;
}

const CACHE_KIND = "commit-files";
/** Kept apart from the paths-only entries, which never carry symbols. */
const CACHE_KIND_WITH_SYMBOLS = "commit-files-symbols";
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
  const withSymbols = req.withSymbols === true;
  const cacheKind = withSymbols ? CACHE_KIND_WITH_SYMBOLS : CACHE_KIND;

  if (req.cacheEnabled) {
    const cached = await repoFileCache.getRefList<CommitFiles>(
      req.configId,
      cacheKind,
      req.commit.sha
    );
    if (cached) return cached;
  }

  const result = await req.adapter.compareCommits(parent, req.commit.sha, {
    maxFilesWithPatch: withSymbols ? req.maxFiles : 0,
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
  if (withSymbols) {
    const symbolsByPath: Record<string, string[]> = {};
    for (const file of result.files) {
      if (file.isBinary || !file.patch) continue;
      const symbols = extractChangedSymbols(file.patch);
      if (symbols.length > 0) symbolsByPath[file.path] = symbols;
    }
    value.symbolsByPath = symbolsByPath;
  }
  if (req.cacheEnabled) {
    await repoFileCache.setRefList(
      req.configId,
      cacheKind,
      req.commit.sha,
      value,
      CACHE_TTL_SECONDS
    );
  }
  return value;
}
