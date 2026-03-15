import { Redis } from "ioredis";
import { getCurrentTenantId } from "~/lib/multiTenantPrisma";
import valkeyConnection from "../../valkey";

// RepoFileEntry is defined here (not imported from adapter layer) to avoid
// circular dependency concerns in Phase 2. Both definitions must stay in sync.
export interface RepoFileEntry {
  path: string;
  size: number; // bytes
  type: "file";
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
  async getFiles(
    projectConfigId: number
  ): Promise<RepoFileEntry[] | null> {
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
