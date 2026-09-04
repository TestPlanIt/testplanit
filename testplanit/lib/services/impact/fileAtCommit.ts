import type { GitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { repoFileCache } from "~/lib/integrations/cache/RepoFileCache";
import { MAX_FILE_AT_COMMIT_BYTES } from "~/lib/integrations/diff/limits";

export class FileTooLargeError extends Error {
  constructor(path: string, bytes: number) {
    super(`File too large: ${path} (${bytes} bytes)`);
    this.name = "FileTooLargeError";
  }
}

export interface FileAtCommitRequest {
  configId: number;
  cacheEnabled: boolean;
  adapter: GitRepoAdapter;
  path: string;
  sha: string;
}

/** Cache-first read of one file at an exact commit. */
export async function getFileAtCommit(
  req: FileAtCommitRequest
): Promise<{ content: string; cached: boolean }> {
  const { configId, cacheEnabled, adapter, path, sha } = req;
  if (cacheEnabled) {
    const cached = await repoFileCache.getFileAtCommit(configId, sha, path);
    if (cached !== null) return { content: cached, cached: true };
  }
  const content = await adapter.getFileContentAtCommit(path, sha);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_FILE_AT_COMMIT_BYTES) {
    throw new FileTooLargeError(path, bytes);
  }
  if (cacheEnabled) {
    await repoFileCache.setFileAtCommit(configId, sha, path, content);
  }
  return { content, cached: false };
}

/** Repo-relative paths only: no absolute paths, no parent traversal. */
export function isSafeRepoPath(path: string): boolean {
  if (!path || path.length > 4096) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  return !path.split("/").some((segment) => segment === "" || segment === "..");
}
