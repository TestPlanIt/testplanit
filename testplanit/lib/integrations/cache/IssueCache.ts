import { Redis } from "ioredis"; // ioredis client type (compatible with Valkey)
import valkeyConnection from "../../valkey"; // Valkey connection
import { IssueData } from "../adapters/IssueAdapter";

export interface CachedIssue extends IssueData {
  cachedAt: Date;
  integrationId: number;
}

export class IssueCache {
  private valkey: Redis | null; // Valkey connection instance
  private defaultTTL: number = 3600; // 1 hour default TTL

  constructor() {
    // Use a duplicate connection to avoid conflicts with BullMQ
    this.valkey = valkeyConnection ? valkeyConnection.duplicate() : null;
  }

  private getCacheKey(integrationId: number, externalId: string): string {
    return `issue:${integrationId}:${externalId}`;
  }

  private getBulkCacheKey(integrationId: number, projectId?: string): string {
    return projectId
      ? `issues:${integrationId}:project:${projectId}`
      : `issues:${integrationId}:all`;
  }

  private getMetadataCacheKey(integrationId: number): string {
    return `issue-metadata:${integrationId}`;
  }

  private getProjectCacheKey(integrationId: number): string {
    return `projects:${integrationId}`;
  }

  async get(
    integrationId: number,
    externalId: string
  ): Promise<CachedIssue | null> {
    if (!this.valkey) return null;

    const key = this.getCacheKey(integrationId, externalId);
    const cached = await this.valkey.get(key);

    if (!cached) {
      return null;
    }

    try {
      const data = JSON.parse(cached);
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
        cachedAt: new Date(data.cachedAt),
      } as CachedIssue;
    } catch (error) {
      console.error("Failed to parse cached issue:", error);
      await this.valkey.del(key); // Remove corrupted cache
      return null;
    }
  }

  async set(
    integrationId: number,
    externalId: string,
    issue: IssueData,
    ttl?: number
  ): Promise<void> {
    if (!this.valkey) return;

    const key = this.getCacheKey(integrationId, externalId);
    const cachedIssue: CachedIssue = {
      ...issue,
      integrationId,
      cachedAt: new Date(),
    };
    const value = JSON.stringify(cachedIssue);
    const cacheTTL = ttl ?? this.defaultTTL;

    await this.valkey.setex(key, cacheTTL, value);
  }

  async getBulk(
    integrationId: number,
    projectId?: string
  ): Promise<CachedIssue[]> {
    if (!this.valkey) return [];

    const key = this.getBulkCacheKey(integrationId, projectId);
    const cached = await this.valkey.get(key);

    if (!cached) {
      return [];
    }

    try {
      const data = JSON.parse(cached);
      return data.map((item: any) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        cachedAt: new Date(item.cachedAt),
      })) as CachedIssue[];
    } catch (error) {
      console.error("Failed to parse cached issues:", error);
      await this.valkey.del(key);
      return [];
    }
  }

  async setBulk(
    integrationId: number,
    issues: IssueData[],
    projectId?: string,
    ttl?: number
  ): Promise<void> {
    if (!this.valkey) return;

    const key = this.getBulkCacheKey(integrationId, projectId);
    const cachedIssues = issues.map((issue) => ({
      ...issue,
      integrationId,
      cachedAt: new Date(),
    }));
    const value = JSON.stringify(cachedIssues);
    const cacheTTL = ttl ?? this.defaultTTL;

    await this.valkey.setex(key, cacheTTL, value);

    // Also cache individual issues
    const pipeline = this.valkey.pipeline();
    for (const issue of issues) {
      const issueKey = this.getCacheKey(integrationId, issue.id);
      const cachedIssue: CachedIssue = {
        ...issue,
        integrationId,
        cachedAt: new Date(),
      };
      pipeline.setex(issueKey, cacheTTL, JSON.stringify(cachedIssue));
    }
    await pipeline.exec();
  }

  async invalidate(integrationId: number, externalId?: string): Promise<void> {
    if (!this.valkey) return;

    if (externalId) {
      // Invalidate specific issue
      const key = this.getCacheKey(integrationId, externalId);
      await this.valkey.del(key);
    } else {
      // Invalidate all issues for integration using scan for better performance
      const stream = this.valkey.scanStream({
        match: `issue:${integrationId}:*`,
        count: 100,
      });

      const pipeline = this.valkey.pipeline();
      stream.on("data", (keys: string[]) => {
        if (keys.length) {
          keys.forEach((key) => pipeline.del(key));
        }
      });

      stream.on("end", async () => {
        await pipeline.exec();
      });

      // Also invalidate bulk caches
      const bulkStream = this.valkey.scanStream({
        match: `issues:${integrationId}:*`,
        count: 100,
      });

      const bulkPipeline = this.valkey.pipeline();
      bulkStream.on("data", (keys: string[]) => {
        if (keys.length) {
          keys.forEach((key) => bulkPipeline.del(key));
        }
      });

      bulkStream.on("end", async () => {
        await bulkPipeline.exec();
      });
    }
  }

  async invalidateProject(
    integrationId: number,
    projectId: string
  ): Promise<void> {
    if (!this.valkey) return;

    const key = this.getBulkCacheKey(integrationId, projectId);
    await this.valkey.del(key);
  }

  async getMetadata(
    integrationId: number
  ): Promise<Record<string, any> | null> {
    if (!this.valkey) return null;

    const key = this.getMetadataCacheKey(integrationId);
    const cached = await this.valkey.get(key);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached);
    } catch (error) {
      console.error("Failed to parse cached metadata:", error);
      await this.valkey.del(key);
      return null;
    }
  }

  async setMetadata(
    integrationId: number,
    metadata: Record<string, any>,
    ttl: number = 7200 // 2 hours for metadata
  ): Promise<void> {
    if (!this.valkey) return;

    const key = this.getMetadataCacheKey(integrationId);
    const value = JSON.stringify(metadata);
    await this.valkey.setex(key, ttl, value);
  }

  async getProjects(
    integrationId: number
  ): Promise<Array<{ id: string; key: string; name: string }> | null> {
    if (!this.valkey) return null;

    const key = this.getProjectCacheKey(integrationId);
    const cached = await this.valkey.get(key);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached);
    } catch (error) {
      console.error("Failed to parse cached projects:", error);
      await this.valkey.del(key);
      return null;
    }
  }

  async setProjects(
    integrationId: number,
    projects: Array<{ id: string; key: string; name: string }>,
    ttl: number = 86400 // 24 hours for project list
  ): Promise<void> {
    if (!this.valkey) return;

    const key = this.getProjectCacheKey(integrationId);
    const value = JSON.stringify(projects);
    await this.valkey.setex(key, ttl, value);
  }

  async getCacheTTL(
    integrationId: number,
    externalId: string
  ): Promise<number> {
    if (!this.valkey) return -1;

    const key = this.getCacheKey(integrationId, externalId);
    return await this.valkey.ttl(key);
  }

  async warmCache(
    integrationId: number,
    fetchFn: () => Promise<IssueData[]>,
    projectId?: string
  ): Promise<void> {
    try {
      const issues = await fetchFn();
      await this.setBulk(integrationId, issues, projectId);
    } catch (error) {
      console.error("Failed to warm cache:", error);
    }
  }

  async close(): Promise<void> {
    if (this.valkey) {
      this.valkey.disconnect();
    }
  }
}

export const issueCache = new IssueCache();
