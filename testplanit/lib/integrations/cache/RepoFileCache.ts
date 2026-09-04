import { createHash } from "crypto";
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

  /**
   * Store file list with TTL. Both files and metadata keys share the same TTL.
   * @param ttlDays - from ProjectCodeRepositoryConfig.cacheTtlDays (days, NOT seconds)
   */
  async setFiles(
    projectConfigId: number,
    files: RepoFileEntry[],
    ttlDays: number,
    options?: { truncated?: boolean; error?: string }
  ): Promise<void> {
    if (!this.valkey) return;

    // Convert days to seconds — TTL conversion happens ONLY here and in setError
    const ttlSeconds = ttlDays * 24 * 3600;

    const meta: CacheMetadata = {
      fetchedAt: new Date().toISOString(),
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + (f.size ?? 0), 0),
      status: options?.error ? "error" : "success",
      ...(options?.error && { error: options.error }),
      ...(options?.truncated && { truncated: true }),
    };

    try {
      const pipeline = this.valkey.pipeline();
      pipeline.setex(
        this.getFilesKey(projectConfigId),
        ttlSeconds,
        JSON.stringify(files)
      );
      pipeline.setex(
        this.getMetaKey(projectConfigId),
        ttlSeconds,
        JSON.stringify(meta)
      );
      await pipeline.exec();
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to cache files for config ${projectConfigId}:`,
        err
      );
      throw err; // Re-throw — caller should handle and mark cache as error
    }
  }

  /**
   * Store a cache error (no files available). Uses the same TTL as a successful fetch
   * so the status panel shows the error, not "never fetched".
   */
  async setError(
    projectConfigId: number,
    error: string,
    ttlDays: number
  ): Promise<void> {
    if (!this.valkey) return;

    // Convert days to seconds — same conversion as setFiles
    const ttlSeconds = ttlDays * 24 * 3600;

    const meta: CacheMetadata = {
      fetchedAt: new Date().toISOString(),
      fileCount: 0,
      totalSize: 0,
      status: "error",
      error,
    };

    try {
      const pipeline = this.valkey.pipeline();
      // Don't store an empty file list key on error — just the metadata
      pipeline.setex(
        this.getMetaKey(projectConfigId),
        ttlSeconds,
        JSON.stringify(meta)
      );
      await pipeline.exec();
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to set error metadata for config ${projectConfigId}:`,
        err
      );
    }
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
   * Store file contents as a Redis hash (path→content). Uses the same TTL as the
   * file list so all cache keys expire together.
   * Failures are logged but not re-thrown — content cache is a performance
   * optimization and callers fall back to live fetches on cache miss.
   */
  async setFileContents(
    projectConfigId: number,
    contents: Map<string, string>,
    ttlDays: number
  ): Promise<void> {
    if (!this.valkey || contents.size === 0) return;

    const key = this.getContentsKey(projectConfigId);
    const ttlSeconds = ttlDays * 24 * 3600;

    try {
      const hashData: Record<string, string> = {};
      for (const [path, content] of contents) {
        hashData[path] = content;
      }
      const pipeline = this.valkey.pipeline();
      pipeline.hset(key, hashData);
      pipeline.expire(key, ttlSeconds);
      await pipeline.exec();
    } catch (err) {
      console.error(
        `[RepoFileCache] Failed to set file contents for config ${projectConfigId}:`,
        err
      );
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
