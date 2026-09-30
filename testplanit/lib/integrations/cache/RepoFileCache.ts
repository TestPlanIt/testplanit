import { createHash, randomUUID } from "crypto";
import { Redis } from "ioredis";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import valkeyConnection from "../../valkey";
import type { CompareResult } from "../adapters/GitRepoAdapter";

// RepoFileEntry is defined here (not imported from adapter layer) to avoid
// circular dependency concerns. Both definitions must stay in sync.
export interface RepoFileEntry {
  path: string;
  size: number; // bytes
  type: "file";
}

// Short-lived cache for the QuickScript "Preview" listing. The raw file list
// for a repo+branch+base-paths rarely changes while a user tunes glob patterns,
// so caching it briefly turns N previews into a single provider listing call —
// the main lever against hitting provider rate limits during pattern tuning.
const PREVIEW_LIST_TTL_SECONDS = 300; // 5 minutes
// Compare results and file contents at an exact commit never change; the TTL
// only bounds memory. Branch and commit listings are mutable and stay short.
const IMMUTABLE_TTL_SECONDS = 24 * 60 * 60;
const REF_LIST_TTL_SECONDS = 60;

export interface PreviewListCacheEntry {
  files: RepoFileEntry[];
  truncated: boolean;
}

export type RepoCacheStatus = "success" | "error" | "pending";

export interface CacheMetadata {
  fetchedAt: string; // ISO 8601 string
  fileCount: number;
  totalSize: number; // bytes (sum of all file sizes)
  status: RepoCacheStatus;
  error?: string;
  truncated?: boolean; // true if provider returned incomplete file list (GitHub)
  lastError?: { message: string; at: string }; // failed refresh; files above still served
}

// Staging keys are swapped in right after they are written; the TTL only
// clears keys left behind by a refresh that crashed in between.
const STAGING_TTL_SECONDS = 60 * 60;

export interface StagedRepoCache {
  projectConfigId: number;
  token: string;
  hasContents: boolean;
}

/** Pipelines and transactions report per-command errors instead of throwing. */
function assertExecOk(results: [Error | null, unknown][] | null): void {
  if (!results) throw new Error("Valkey transaction was aborted");
  const failed = results.find(([err]) => err);
  if (failed) throw failed[0];
}

export class RepoFileCache {
  private valkey: Redis | null;

  constructor() {
    // Use duplicate() to avoid conflicts with BullMQ and the main app connection
    this.valkey = valkeyConnection ? valkeyConnection.duplicate() : null;
  }

  private getFilesKey(projectConfigId: number): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    return `repo-files:${prefix}config:${projectConfigId}`;
  }

  private getMetaKey(projectConfigId: number): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    return `repo-files-meta:${prefix}config:${projectConfigId}`;
  }

  private getContentsKey(projectConfigId: number): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    return `repo-file-contents:${prefix}config:${projectConfigId}`;
  }

  /**
   * Retrieve cached file list. Returns null on cache miss or Valkey unavailable.
   */
  async getFiles(projectConfigId: number): Promise<RepoFileEntry[] | null> {
    if (!this.valkey) return null;

    const key = this.getFilesKey(projectConfigId);
    try {
      const cached = await this.valkey.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as RepoFileEntry[];
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to parse cached files for config ${projectConfigId}:`,
        err
      );
      await this.valkey.del(key).catch(() => {}); // Remove corrupted entry
      return null;
    }
  }

  private getStagingKeys(projectConfigId: number, token: string) {
    const suffix = `:staging:${token}`;
    return {
      files: this.getFilesKey(projectConfigId) + suffix,
      meta: this.getMetaKey(projectConfigId) + suffix,
      contents: this.getContentsKey(projectConfigId) + suffix,
    };
  }

  /** True when a file list is live for the config. */
  async hasFiles(projectConfigId: number): Promise<boolean> {
    if (!this.valkey) return false;
    try {
      return (await this.valkey.exists(this.getFilesKey(projectConfigId))) > 0;
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to check files for config ${projectConfigId}:`,
        err
      );
      return false;
    }
  }

  /**
   * Write a refreshed file list, metadata and contents to staging keys beside
   * the live ones. Readers keep the live cache until commitStaged() swaps the
   * staging keys in; discardStaged() drops them instead.
   */
  async stage(
    projectConfigId: number,
    files: RepoFileEntry[],
    contents: Map<string, string>,
    options?: { truncated?: boolean }
  ): Promise<StagedRepoCache> {
    const staged: StagedRepoCache = {
      projectConfigId,
      token: randomUUID(),
      hasContents: contents.size > 0,
    };
    if (!this.valkey) return staged;

    const keys = this.getStagingKeys(projectConfigId, staged.token);
    const meta: CacheMetadata = {
      fetchedAt: new Date().toISOString(),
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + (f.size ?? 0), 0),
      status: "success",
      ...(options?.truncated && { truncated: true }),
    };

    try {
      const pipeline = this.valkey.pipeline();
      pipeline.setex(keys.files, STAGING_TTL_SECONDS, JSON.stringify(files));
      pipeline.setex(keys.meta, STAGING_TTL_SECONDS, JSON.stringify(meta));
      if (staged.hasContents) {
        pipeline.hset(keys.contents, Object.fromEntries(contents));
        pipeline.expire(keys.contents, STAGING_TTL_SECONDS);
      }
      assertExecOk(await pipeline.exec());
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to stage cache for config ${projectConfigId}:`,
        err
      );
      await this.discardStaged(staged);
      throw err;
    }
    return staged;
  }

  /**
   * Swap staged keys in for the live ones in one transaction. The contents
   * hash is replaced whole, so files deleted upstream do not linger.
   * @param ttlDays - from ProjectCodeRepositoryConfig.cacheTtlDays (days, NOT seconds)
   */
  async commitStaged(staged: StagedRepoCache, ttlDays: number): Promise<void> {
    if (!this.valkey) return;

    const ttlSeconds = ttlDays * 24 * 3600;
    const { projectConfigId, token } = staged;
    const from = this.getStagingKeys(projectConfigId, token);
    const to = {
      files: this.getFilesKey(projectConfigId),
      meta: this.getMetaKey(projectConfigId),
      contents: this.getContentsKey(projectConfigId),
    };

    const tx = this.valkey.multi();
    tx.rename(from.files, to.files).expire(to.files, ttlSeconds);
    tx.rename(from.meta, to.meta).expire(to.meta, ttlSeconds);
    if (staged.hasContents) {
      tx.rename(from.contents, to.contents).expire(to.contents, ttlSeconds);
    } else {
      tx.del(to.contents);
    }
    assertExecOk(await tx.exec());
  }

  /** Drop staged keys, leaving the live cache as it was. */
  async discardStaged(staged: StagedRepoCache): Promise<void> {
    if (!this.valkey) return;

    const keys = this.getStagingKeys(staged.projectConfigId, staged.token);
    try {
      await this.valkey.del(keys.files, keys.meta, keys.contents);
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to discard staged cache for config ${staged.projectConfigId}:`,
        err
      );
    }
  }

  /**
   * Record a failed refresh. When a file list is still live, its metadata is
   * kept and the failure is added as lastError, so the old files stay usable.
   * Otherwise an error entry is stored with the cache TTL so the status panel
   * shows the error, not "never fetched".
   * @returns true when a live cache was kept
   */
  async setError(
    projectConfigId: number,
    error: string,
    ttlDays: number
  ): Promise<boolean> {
    if (!this.valkey) return false;

    const metaKey = this.getMetaKey(projectConfigId);
    const at = new Date().toISOString();

    try {
      if (await this.hasFiles(projectConfigId)) {
        const meta = await this.getMeta(projectConfigId);
        if (meta) {
          await this.valkey.set(
            metaKey,
            JSON.stringify({ ...meta, lastError: { message: error, at } }),
            "KEEPTTL"
          );
        }
        return true;
      }

      const meta: CacheMetadata = {
        fetchedAt: at,
        fileCount: 0,
        totalSize: 0,
        status: "error",
        error,
      };
      await this.valkey.setex(
        metaKey,
        ttlDays * 24 * 3600,
        JSON.stringify(meta)
      );
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to set error metadata for config ${projectConfigId}:`,
        err
      );
    }
    return false;
  }

  /**
   * Get cache metadata for the status panel (last fetched, file count, size, status).
   * Returns null if never fetched or Valkey unavailable.
   */
  async getMeta(projectConfigId: number): Promise<CacheMetadata | null> {
    if (!this.valkey) return null;

    const key = this.getMetaKey(projectConfigId);
    try {
      const cached = await this.valkey.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as CacheMetadata;
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to parse meta for config ${projectConfigId}:`,
        err
      );
      return null;
    }
  }

  /**
   * Retrieve all cached file contents as a path→content map.
   * Returns null on cache miss or Valkey unavailable.
   */
  async getFileContents(
    projectConfigId: number
  ): Promise<Map<string, string> | null> {
    if (!this.valkey) return null;

    const key = this.getContentsKey(projectConfigId);
    try {
      const hash = await this.valkey.hgetall(key);
      if (!hash || Object.keys(hash).length === 0) return null;
      return new Map(Object.entries(hash));
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to get file contents for config ${projectConfigId}:`,
        err
      );
      return null;
    }
  }

  /**
   * Key for a preview listing, scoped by tenant + repo + branch + base paths.
   * Base paths are order-normalized so {"src","tests"} and {"tests","src"} hit
   * the same entry; the (branch, paths) tuple is hashed to keep keys bounded.
   */
  private getPreviewListKey(
    repoId: number,
    branch: string,
    scopeKeys: string[]
  ): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    const sortedPaths = [...scopeKeys].sort().join("\n");
    const hash = createHash("sha1")
      .update(`${branch}\n${sortedPaths}`)
      .digest("hex")
      .slice(0, 16);
    return `repo-preview-list:${prefix}repo:${repoId}:${hash}`;
  }

  /**
   * Retrieve a cached preview listing. Returns null on miss/Valkey unavailable.
   */
  async getPreviewList(
    repoId: number,
    branch: string,
    scopeKeys: string[]
  ): Promise<PreviewListCacheEntry | null> {
    if (!this.valkey) return null;

    const key = this.getPreviewListKey(repoId, branch, scopeKeys);
    try {
      const cached = await this.valkey.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as PreviewListCacheEntry;
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to parse preview list for repo ${repoId}:`,
        err
      );
      await this.valkey.del(key).catch(() => {}); // Remove corrupted entry
      return null;
    }
  }

  /**
   * Store a preview listing with a short TTL. Failures are logged but not
   * re-thrown — this is a best-effort optimization; callers fall back to a
   * live listing on miss.
   */
  async setPreviewList(
    repoId: number,
    branch: string,
    scopeKeys: string[],
    entry: PreviewListCacheEntry,
    ttlSeconds: number = PREVIEW_LIST_TTL_SECONDS
  ): Promise<void> {
    if (!this.valkey) return;

    const key = this.getPreviewListKey(repoId, branch, scopeKeys);
    try {
      await this.valkey.setex(key, ttlSeconds, JSON.stringify(entry));
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to cache preview list for repo ${repoId}:`,
        err
      );
    }
  }

  private getCompareKey(
    projectConfigId: number,
    baseSha: string,
    headSha: string
  ): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    return `repo-compare:${prefix}config:${projectConfigId}:${baseSha}:${headSha}`;
  }

  /** Cached commit compare (immutable content; TTL only bounds memory). */
  async getCompare(
    projectConfigId: number,
    baseSha: string,
    headSha: string
  ): Promise<CompareResult | null> {
    if (!this.valkey) return null;
    const key = this.getCompareKey(projectConfigId, baseSha, headSha);
    try {
      const cached = await this.valkey.get(key);
      return cached ? (JSON.parse(cached) as CompareResult) : null;
    } catch (err) {
      console.error(`[RepoFileCache] Failed to read compare ${key}:`, err);
      await this.valkey.del(key).catch(() => {});
      return null;
    }
  }

  async setCompare(
    projectConfigId: number,
    baseSha: string,
    headSha: string,
    result: CompareResult,
    ttlSeconds: number = IMMUTABLE_TTL_SECONDS
  ): Promise<void> {
    if (!this.valkey) return;
    const key = this.getCompareKey(projectConfigId, baseSha, headSha);
    try {
      await this.valkey.setex(key, ttlSeconds, JSON.stringify(result));
    } catch (err) {
      console.error(`[RepoFileCache] Failed to cache compare ${key}:`, err);
    }
  }

  private getFileAtCommitKey(
    projectConfigId: number,
    sha: string,
    path: string
  ): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    const pathHash = createHash("sha1").update(path).digest("hex").slice(0, 16);
    return `repo-file-at:${prefix}config:${projectConfigId}:${sha}:${pathHash}`;
  }

  /** Cached single-file content at an exact commit. */
  async getFileAtCommit(
    projectConfigId: number,
    sha: string,
    path: string
  ): Promise<string | null> {
    if (!this.valkey) return null;
    try {
      return await this.valkey.get(
        this.getFileAtCommitKey(projectConfigId, sha, path)
      );
    } catch (err) {
      console.error(`[RepoFileCache] Failed to read file-at-commit:`, err);
      return null;
    }
  }

  async setFileAtCommit(
    projectConfigId: number,
    sha: string,
    path: string,
    content: string,
    ttlSeconds: number = IMMUTABLE_TTL_SECONDS
  ): Promise<void> {
    if (!this.valkey) return;
    try {
      await this.valkey.setex(
        this.getFileAtCommitKey(projectConfigId, sha, path),
        ttlSeconds,
        content
      );
    } catch (err) {
      console.error(`[RepoFileCache] Failed to cache file-at-commit:`, err);
    }
  }

  private getRefListKey(repoId: number, kind: string, hash: string): string {
    const tenantId = getCurrentTenantId();
    const prefix = tenantId ? `${tenantId}:` : "";
    return `repo-refs:${prefix}repo:${repoId}:${kind}:${hash}`;
  }

  /** Short-lived cache for mutable ref listings (branches, commit pages). */
  async getRefList<T>(
    repoId: number,
    kind: string,
    hash: string
  ): Promise<T | null> {
    if (!this.valkey) return null;
    const key = this.getRefListKey(repoId, kind, hash);
    try {
      const cached = await this.valkey.get(key);
      return cached ? (JSON.parse(cached) as T) : null;
    } catch (err) {
      console.error(`[RepoFileCache] Failed to read ref list ${key}:`, err);
      await this.valkey.del(key).catch(() => {});
      return null;
    }
  }

  async setRefList<T>(
    repoId: number,
    kind: string,
    hash: string,
    value: T,
    ttlSeconds: number = REF_LIST_TTL_SECONDS
  ): Promise<void> {
    if (!this.valkey) return;
    const key = this.getRefListKey(repoId, kind, hash);
    try {
      await this.valkey.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      console.error(`[RepoFileCache] Failed to cache ref list ${key}:`, err);
    }
  }

  /**
   * Invalidate both file list and metadata for a project config.
   * Call this when ProjectCodeRepositoryConfig is updated (branch/patterns changed).
   */
  async invalidate(projectConfigId: number): Promise<void> {
    if (!this.valkey) return;

    try {
      const pipeline = this.valkey.pipeline();
      pipeline.del(this.getFilesKey(projectConfigId));
      pipeline.del(this.getMetaKey(projectConfigId));
      pipeline.del(this.getContentsKey(projectConfigId));
      await pipeline.exec();
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to invalidate cache for config ${projectConfigId}:`,
        err
      );
    }
  }
}

// Singleton — import this directly in API routes
export const repoFileCache = new RepoFileCache();
