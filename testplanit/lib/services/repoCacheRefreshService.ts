import type { DbClient } from "~/lib/zenstack";
import {
  createGitRepoAdapter,
  type ArchiveTree,
  type GitRepoAdapter,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  repoFileCache,
  type RepoFileEntry,
} from "~/lib/integrations/cache/RepoFileCache";
import {
  applyPathPatterns,
  extractBasePathScopes,
  type PathPattern,
} from "~/lib/integrations/repoPathPatterns";
import { getCommitFilePaths } from "./impact/commitFiles";
import { commitWalkStore, walkCommits } from "./impact/commitWalk";
import { issueScanCancelKey } from "./impact/jobKeys";
import { importableIssueKeys, type IssueToken } from "./impact/issueKeys";
import { integrationManager } from "~/lib/integrations/IntegrationManager";
import valkeyConnection from "~/lib/valkey";
import {
  IssueKeyResolutionError,
  resolveIssueKeys,
  resolveIssueTrackerIntegration,
} from "./resolveIssueKeys";
import { resolveRefToSha } from "./impact/compareService";
import { impactConfig } from "./impact/config";
import {
  type IssueImportProgress,
  type IssueImportResult,
  type IssueScanDb,
  type IssueScanProgress,
  type IssueScanReport,
  syncIssuePins,
} from "./impact/issueScan";
import { IssueScanCancelledError } from "./impact/issueScanCancel";
import {
  shouldScanMarkers,
  syncMarkerPins,
  type MarkerScanDb,
} from "./impact/markerScan";

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429");
}

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_SECONDS = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch file contents with rate-limit retry. On 429, waits for the
 * Retry-After period, drops to sequential fetching, and continues.
 * Gives up after MAX_RATE_LIMIT_RETRIES consecutive rate-limit hits.
 */
async function fetchContentsBatched(
  files: RepoFileEntry[],
  adapter: {
    getFileContent(path: string, branch: string): Promise<string>;
    retryAfterSeconds: number;
  },
  branch: string,
  initialConcurrency: number
): Promise<{ contentMap: Map<string, string>; contentRateLimited: boolean }> {
  const contentMap = new Map<string, string>();
  let concurrency = initialConcurrency;
  let consecutiveRateLimits = 0;
  let i = 0;

  while (i < files.length) {
    if (consecutiveRateLimits >= MAX_RATE_LIMIT_RETRIES) {
      console.warn(
        `[repoCacheRefresh] Giving up after ${MAX_RATE_LIMIT_RETRIES} consecutive rate limits — ${contentMap.size}/${files.length} files cached`
      );
      return { contentMap, contentRateLimited: true };
    }

    const batch = files.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const content = await adapter.getFileContent(file.path, branch);
        return { path: file.path, content };
      })
    );

    let batchRateLimited = false;

    for (const result of results) {
      if (result.status === "fulfilled") {
        contentMap.set(result.value.path, result.value.content);
      } else if (isRateLimitError(result.reason)) {
        batchRateLimited = true;
      } else {
        console.warn(
          `[repoCacheRefresh] Skipping content for a file:`,
          result.reason
        );
      }
    }

    if (batchRateLimited) {
      consecutiveRateLimits++;
      // Drop to sequential and wait before retrying
      concurrency = 1;
      const waitSeconds = adapter.retryAfterSeconds || DEFAULT_RETRY_SECONDS;
      console.warn(
        `[repoCacheRefresh] Rate limited (attempt ${consecutiveRateLimits}/${MAX_RATE_LIMIT_RETRIES}) — waiting ${waitSeconds}s, then continuing sequentially (${contentMap.size}/${files.length} cached so far)`
      );
      await sleep(waitSeconds * 1000);
      // Don't advance i — retry the files that failed in this batch
      // (successful ones are already in contentMap and will be skipped by the adapter's cache or deduped by Map.set)
      continue;
    }

    // Batch succeeded — reset rate-limit counter and advance
    consecutiveRateLimits = 0;
    i += concurrency;
  }

  return { contentMap, contentRateLimited: false };
}

async function storeMarkerScanReport(
  dbClient: DbClient,
  configId: number,
  report: unknown
): Promise<void> {
  try {
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: configId },
      data: { markerScanReport: report },
    });
  } catch (err) {
    console.warn(
      `[repoCacheRefresh] Failed to store marker scan report for config ${configId}:`,
      err
    );
  }
}

/**
 * Sync repo markers (annotations + testmap) into code pins for an IMPACT
 * config. Never throws: a failed scan is recorded in the report instead.
 */
async function runMarkerScan(
  dbClient: DbClient,
  config: { id: number; projectId: number; project: { createdBy: string } },
  adapter: GitRepoAdapter,
  branch: string,
  contentMap: Map<string, string>,
  contentRateLimited: boolean
): Promise<void> {
  const scannedAt = new Date().toISOString();
  let report: unknown;
  if (contentRateLimited) {
    report = { skipped: "partial_contents", scannedAt };
  } else {
    try {
      const anchorSha = await resolveRefToSha(adapter, branch);
      report = await syncMarkerPins(
        dbClient as unknown as MarkerScanDb,
        { id: config.id, projectId: config.projectId, branch },
        contentMap,
        { anchorSha, actorId: config.project.createdBy }
      );
    } catch (err) {
      console.warn(
        `[repoCacheRefresh] Marker scan failed for config ${config.id}:`,
        err
      );
      report = {
        error:
          err instanceof Error
            ? err.message
            : "Unknown error during marker scan",
        scannedAt,
      };
    }
  }
  await storeMarkerScanReport(dbClient, config.id, report);
}

async function storeIssueScanReport(
  dbClient: DbClient,
  configId: number,
  report: unknown
): Promise<void> {
  try {
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: configId },
      data: { issueScanReport: report },
    });
  } catch (err) {
    console.warn(
      `[repoCacheRefresh] Failed to store issue scan report for config ${configId}:`,
      err
    );
  }
}

interface IssueScanConfigRow {
  id: number;
  projectId: number;
  cacheEnabled: boolean;
  project: { createdBy: string };
}

export interface IssueScanRunOptions {
  /** Walk the whole branch instead of the recent window. */
  full?: boolean;
  /** Polled between pages, import rounds and commits; true stops the scan. */
  isCancelled?: () => Promise<boolean>;
}

export interface IssueScanCancelledReport {
  cancelled: true;
  full: boolean;
  scannedAt: string;
}

/** Was a cancel requested for this config's running scan? */
async function cancelRequested(configId: number): Promise<boolean> {
  if (!valkeyConnection) return false;
  try {
    return Boolean(await valkeyConnection.get(issueScanCancelKey(configId)));
  } catch {
    return false;
  }
}

async function clearCancelRequest(configId: number): Promise<void> {
  if (!valkeyConnection) return;
  await valkeyConnection.del(issueScanCancelKey(configId)).catch(() => {});
}

/**
 * Import the tickets a set of commit tokens name that TestPlanIt does not
 * hold yet, through the project's issue tracker. A project without a tracker,
 * or with several, imports nothing. A ticket another project already pulled
 * in is already here — one row per ticket per integration — and is left for
 * linking, not counted as a failure.
 */
/** Keys resolved per tracker round, so progress is reported between rounds. */
const IMPORT_CHUNK = 20;

/**
 * The project prefixes (`PROJ` in `PROJ-123`) a Jira-style tracker can answer
 * for. Commit messages are full of look-alikes — `PHASE-33`, `ID-24`,
 * `ROUND-2` — that would each cost a 404 lookup. The tracker's own project
 * list is the authority; when it cannot be listed, the prefixes of tickets
 * already imported on the integration stand in. Null means unknown: try
 * every key.
 */
async function knownIssueKeyPrefixes(
  dbClient: DbClient,
  integrationId: number
): Promise<Set<string> | null> {
  try {
    const adapter = await integrationManager.getAdapter(
      String(integrationId),
      dbClient as any
    );
    if (adapter && typeof adapter.getProjects === "function") {
      const projects = await adapter.getProjects();
      const keys = projects
        .map((project) => project.key?.toUpperCase())
        .filter((key): key is string => !!key);
      if (keys.length > 0) return new Set(keys);
    }
  } catch (err) {
    console.warn(
      `[repoCacheRefresh] Could not list tracker projects for integration ${integrationId}; falling back to known prefixes:`,
      err
    );
  }
  const rows = (await (dbClient as any).issue.findMany({
    where: { integrationId, isDeleted: false, externalKey: { contains: "-" } },
    select: { externalKey: true },
    distinct: ["externalKey"],
    take: 5000,
  })) as Array<{ externalKey: string | null }>;
  const seen = new Set<string>();
  for (const row of rows) {
    const prefix = row.externalKey?.split("-")[0]?.toUpperCase();
    if (prefix) seen.add(prefix);
  }
  return seen.size > 0 ? seen : null;
}

function keyPrefix(key: string): string | null {
  const dash = key.indexOf("-");
  return dash > 0 ? key.slice(0, dash).toUpperCase() : null;
}

async function importNamedIssues(
  dbClient: DbClient,
  config: { id: number; projectId: number },
  tokens: IssueToken[],
  maxLookups: number,
  onProgress?: (progress: IssueImportProgress) => Promise<void>
): Promise<IssueImportResult> {
  let integration: { integrationId: number; provider: string };
  try {
    integration = await resolveIssueTrackerIntegration(config.projectId);
  } catch (err) {
    if (err instanceof IssueKeyResolutionError) {
      return { imported: 0, failed: 0, skipped: 0, moved: 0 };
    }
    throw err;
  }
  let keys = importableIssueKeys(integration.provider, tokens);
  if (keys.length === 0)
    return { imported: 0, failed: 0, skipped: 0, moved: 0 };
  if (integration.provider.toUpperCase() === "JIRA") {
    const prefixes = await knownIssueKeyPrefixes(
      dbClient,
      integration.integrationId
    );
    if (prefixes) {
      keys = keys.filter((key) => {
        const prefix = keyPrefix(key);
        return prefix !== null && prefixes.has(prefix);
      });
      if (keys.length === 0)
        return { imported: 0, failed: 0, skipped: 0, moved: 0 };
    }
  }

  // One local row per tracker ticket per integration, whichever project
  // first pulled it in; a case in this project links to that row. So a
  // ticket held anywhere on the integration is already here.
  const known = (await (dbClient as any).issue.findMany({
    where: {
      integrationId: integration.integrationId,
      isDeleted: false,
      OR: [{ externalKey: { in: keys } }, { externalId: { in: keys } }],
    },
    select: { externalKey: true, externalId: true },
  })) as Array<{ externalKey: string | null; externalId: string | null }>;
  const held = new Set(
    known.flatMap((row) => [row.externalKey, row.externalId]).filter(Boolean)
  );
  const missing = keys.filter((key) => !held.has(key));
  if (missing.length === 0)
    return { imported: 0, failed: 0, skipped: 0, moved: 0 };

  let imported = 0;
  let failed = 0;
  let skipped = 0;
  let moved = 0;
  let lookups = 0;
  const failures: Array<{ key: string; error: string }> = [];
  let index = 0;
  while (index < missing.length) {
    const budget = maxLookups - lookups;
    if (budget <= 0) {
      // Left for the next scan: imported keys are skipped then, so each run
      // continues where the cap stopped this one.
      skipped = missing.length - index;
      break;
    }
    const chunk = missing.slice(index, index + Math.min(IMPORT_CHUNK, budget));
    index += chunk.length;
    const results = await resolveIssueKeys({
      projectId: config.projectId,
      keys: chunk,
      integrationId: integration.integrationId,
      maxLookups: chunk.length,
    });
    // Every key here was missing locally, so each one cost a lookup.
    lookups += chunk.length;
    for (const result of results.values()) {
      if (result.created) imported++;
      else if (result.code === "moved") moved++;
      else if (result.error) {
        failed++;
        failures.push({ key: result.key, error: result.error });
      }
    }
    if (onProgress) await onProgress({ lookups, imported });
  }
  return { imported, failed, skipped, moved, failures };
}

/**
 * Derive ISSUE code pins from ticket keys in commit messages of an IMPACT
 * config: the recent window on a cache refresh, or the whole branch for a
 * manual full scan. Tickets the commits name that are unknown here are
 * imported from the tracker first. Progress is written into
 * `issueScanReport` as `{ running: true, ... }` so the settings page can
 * follow a long walk. Never throws: a failed scan is recorded in the report.
 */
async function runIssueScan(
  dbClient: DbClient,
  config: IssueScanConfigRow,
  adapter: GitRepoAdapter,
  branch: string,
  opts: IssueScanRunOptions = {}
): Promise<
  | IssueScanReport
  | IssueScanCancelledReport
  | { error: string; scannedAt: string }
> {
  const full = opts.full === true;
  const startedAt = new Date().toISOString();
  const isCancelled = opts.isCancelled ?? (async () => false);
  const assertNotCancelled = async () => {
    if (await isCancelled()) throw new IssueScanCancelledError();
  };
  const writeProgress = (progress: IssueScanProgress) =>
    storeIssueScanReport(dbClient, config.id, {
      running: true,
      full,
      startedAt,
      progressAt: new Date().toISOString(),
      ...progress,
    });
  const walkProgress = (
    scannedCommits: number,
    cachedCommits = 0
  ): IssueScanProgress => ({
    stage: "walk",
    scannedCommits,
    cachedCommits,
    matchedCommits: 0,
    fetchedCommits: 0,
    importLookups: 0,
    importedIssues: 0,
  });
  let report:
    | IssueScanReport
    | IssueScanCancelledReport
    | { error: string; scannedAt: string };
  try {
    const cfg = impactConfig;
    await writeProgress(walkProgress(0));
    const recent = await walkCommits(adapter, branch, {
      lookbackDays: full ? Number.POSITIVE_INFINITY : cfg.issueScanLookbackDays,
      maxCommits: full ? cfg.issueScanFullMaxCommits : cfg.issueScanMaxCommits,
      // Only a full walk needs commits older than the cache already holds.
      continueFromCache: full,
      store: commitWalkStore(config.id, branch),
      onProgress: (scannedCommits, fromCache) =>
        writeProgress(walkProgress(scannedCommits, fromCache)),
      shouldStop: isCancelled,
    });
    // The walk kept what it read; the rest of the scan is not worth a
    // partial result.
    if (recent.cancelled) throw new IssueScanCancelledError();
    report = await syncIssuePins(
      dbClient as unknown as IssueScanDb,
      { id: config.id, projectId: config.projectId },
      {
        commits: recent.commits,
        truncated: recent.truncated,
        cachedCommits: recent.fromCache,
        full,
        getCommitFiles: (commit) =>
          getCommitFilePaths({
            configId: config.id,
            cacheEnabled: config.cacheEnabled,
            adapter,
            commit,
            maxFiles: cfg.maxDiffFiles,
            withSymbols: cfg.issueScanSymbolPins,
          }),
        symbolPins: cfg.issueScanSymbolPins,
        maxCommitFetches: full
          ? cfg.issueScanFullMaxCommitFetches
          : cfg.issueScanMaxCommitFetches,
        maxFilesPerCommit: cfg.issueScanMaxFilesPerCommit,
        actorId: config.project.createdBy,
        importIssues: (tokens, onProgress) =>
          importNamedIssues(
            dbClient,
            config,
            tokens,
            full ? cfg.issueImportFullMaxLookups : cfg.issueImportMaxLookups,
            async (progress) => {
              await assertNotCancelled();
              await onProgress(progress);
            }
          ),
        onProgress: async (progress) => {
          await assertNotCancelled();
          await writeProgress(progress);
        },
      }
    );
  } catch (err) {
    if (err instanceof IssueScanCancelledError) {
      report = { cancelled: true, full, scannedAt: new Date().toISOString() };
    } else {
      console.warn(
        `[repoCacheRefresh] Issue scan failed for config ${config.id}:`,
        err
      );
      report = {
        error:
          err instanceof Error
            ? err.message
            : "Unknown error during issue scan",
        scannedAt: new Date().toISOString(),
      };
    }
  }
  await storeIssueScanReport(dbClient, config.id, report);
  return report;
}

/**
 * Run the ticket scan on its own for one IMPACT config — the manual
 * "Rescan" and "Scan full history" actions on the settings page. Reads the
 * repository directly; the file cache is not touched.
 */
export async function scanRepoIssues(
  configId: number,
  dbClient: DbClient,
  opts: IssueScanRunOptions = {}
): Promise<
  | IssueScanReport
  | IssueScanCancelledReport
  | { error: string; scannedAt: string }
> {
  const config = await (dbClient as any).projectCodeRepositoryConfig.findUnique(
    {
      where: { id: configId },
      include: {
        repository: {
          select: { credentials: true, settings: true, provider: true },
        },
        project: { select: { createdBy: true } },
      },
    }
  );
  if (!config) {
    throw new Error(`ProjectCodeRepositoryConfig ${configId} not found`);
  }
  if (config.purpose !== "IMPACT") {
    throw new Error(`Config ${configId} is not an Impact repository`);
  }
  try {
    const credentials = config.repository.credentials as Record<string, string>;
    const adapter = createGitRepoAdapter(
      config.repository.provider,
      credentials,
      config.repository.settings as Record<string, string> | null
    );
    const branch = config.branch || (await adapter.getDefaultBranch());
    // A stale cancel from an earlier run must not stop this one.
    await clearCancelRequest(config.id);
    return await runIssueScan(dbClient, config, adapter, branch, {
      ...opts,
      isCancelled: opts.isCancelled ?? (() => cancelRequested(config.id)),
    });
  } catch (err) {
    // The route marked the config running; leave a report, not a flag.
    const report = {
      error:
        err instanceof Error ? err.message : "Unknown error during issue scan",
      scannedAt: new Date().toISOString(),
    };
    await storeIssueScanReport(dbClient, config.id, report);
    return report;
  } finally {
    await clearCancelRequest(config.id);
  }
}

/** Only IMPACT configs with the ticket scan switched on are scanned. */
export function shouldScanIssues(config: {
  purpose: string | null | undefined;
  issueScanEnabled: boolean | null | undefined;
}): boolean {
  return config.purpose === "IMPACT" && config.issueScanEnabled !== false;
}

export interface RefreshResult {
  success: boolean;
  fileCount: number;
  totalSize: number;
  truncated: boolean;
  contentCached: number;
  contentRateLimited: boolean;
  error?: string;
}

/**
 * Refresh the code repository cache for a given ProjectCodeRepositoryConfig.
 *
 * This is the shared logic used by both the API route (manual refresh) and
 * the background worker (automatic refresh on expiry).
 *
 * Performs: invalidate old cache → fetch file list → store in Valkey →
 * fetch file contents → store in Valkey → update DB status.
 */
export async function refreshRepoCache(
  configId: number,
  dbClient: DbClient
): Promise<RefreshResult> {
  const config = await (dbClient as any).projectCodeRepositoryConfig.findUnique(
    {
      where: { id: configId },
      include: {
        repository: {
          select: { credentials: true, settings: true, provider: true },
        },
        project: { select: { createdBy: true } },
      },
    }
  );

  if (!config) {
    throw new Error(`ProjectCodeRepositoryConfig ${configId} not found`);
  }

  if (!config.cacheEnabled) {
    if (config.purpose === "IMPACT") {
      await storeMarkerScanReport(dbClient, config.id, {
        skipped: "privacy_mode",
        scannedAt: new Date().toISOString(),
      });
    }
    return {
      success: false,
      fileCount: 0,
      totalSize: 0,
      truncated: false,
      contentCached: 0,
      contentRateLimited: false,
      error: "File caching is disabled for this project",
    };
  }

  const credentials = config.repository.credentials as Record<string, string>;
  const adapter = createGitRepoAdapter(
    config.repository.provider,
    credentials,
    config.repository.settings as Record<string, string> | null
  );
  const branch = config.branch || (await adapter.getDefaultBranch());

  // Invalidate existing cache
  await repoFileCache.invalidate(config.id);

  // Update DB status to "pending"
  await (dbClient as any).projectCodeRepositoryConfig.update({
    where: { id: config.id },
    data: { cacheStatus: "pending", cacheError: null },
  });

  try {
    const pathPatterns =
      (config.pathPatterns as unknown as PathPattern[]) ?? [];

    let files: RepoFileEntry[];
    let truncated = false;
    let contentMap: Map<string, string>;
    let contentRateLimited = false;

    // Prefer ONE archive download that yields BOTH the file list and the file
    // contents (like `git clone`) — no per-directory API tree-walk and no
    // per-file rate limits. Fall back to the API tree-walk + per-file fetch
    // when the provider has no archive support or the archive download fails.
    let tree: ArchiveTree | null = null;
    try {
      tree = await adapter.downloadArchiveTree(branch);
    } catch (archiveErr) {
      console.warn(
        `[repoCacheRefresh] Archive download failed, falling back to tree-walk + per-file fetch:`,
        archiveErr
      );
      tree = null;
    }

    if (tree) {
      const matched = applyPathPatterns(tree.files, pathPatterns);
      contentMap = await tree.getContents(new Set(matched.map((f) => f.path)));
      // Archive entries carry no size up front — resolve it from the
      // decompressed content so cacheTotalSize stays accurate.
      files = matched.map((f) => ({
        ...f,
        size: Buffer.byteLength(contentMap.get(f.path) ?? "", "utf8"),
      }));
    } else {
      // Bound each base's scan depth to its glob so a non-recursive root pattern
      // (e.g. "." + "*.md") doesn't crawl the whole repo.
      const scopes = extractBasePathScopes(pathPatterns);
      const basePaths = scopes.map((s) => s.path);
      const maxDepthByPath = Object.fromEntries(
        scopes.map((s) => [s.path, s.maxDepth])
      );
      const listing = await adapter.listFilesInPaths(
        branch,
        basePaths,
        undefined,
        maxDepthByPath
      );
      truncated = listing.truncated ?? false;
      files = applyPathPatterns(listing.files, pathPatterns);
      ({ contentMap, contentRateLimited } = await fetchContentsBatched(
        files,
        adapter,
        branch,
        10
      ));
    }

    const totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);

    // Store file list in Valkey
    await repoFileCache.setFiles(config.id, files, config.cacheTtlDays, {
      truncated,
    });

    // Record the file list now so the UI can show the list count. Status stays
    // "pending" until contents are cached so "success" never lies about content
    // being available.
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheLastFetchedAt: new Date(),
        cacheFileCount: files.length,
        cacheTotalSize: BigInt(totalSize),
        cacheError: null,
      },
    });

    if (contentMap.size > 0) {
      await repoFileCache.setFileContents(
        config.id,
        contentMap,
        config.cacheTtlDays
      );
    }

    // Finalize: mark success now that contents are cached. cacheContentFileCount
    // records how many file contents were actually stored — the UI warns when
    // it is below the file count (e.g. a rate-limited per-file fallback).
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheStatus: "success",
        cacheContentFileCount: contentMap.size,
      },
    });

    if (shouldScanMarkers(config)) {
      await runMarkerScan(
        dbClient,
        config,
        adapter,
        branch,
        contentMap,
        contentRateLimited
      );
    }
    if (shouldScanIssues(config)) {
      await runIssueScan(dbClient, config, adapter, branch);
    }

    return {
      success: true,
      fileCount: files.length,
      totalSize,
      truncated,
      contentCached: contentMap.size,
      contentRateLimited,
    };
  } catch (fetchErr: unknown) {
    const errorMessage =
      fetchErr instanceof Error
        ? fetchErr.message
        : "Unknown error during file fetch";

    // Store error in both Valkey and DB
    await repoFileCache.setError(config.id, errorMessage, config.cacheTtlDays);
    await (dbClient as any).projectCodeRepositoryConfig.update({
      where: { id: config.id },
      data: {
        cacheStatus: "error",
        cacheLastFetchedAt: new Date(),
        cacheError: errorMessage,
      },
    });

    return {
      success: false,
      fileCount: 0,
      totalSize: 0,
      truncated: false,
      contentCached: 0,
      contentRateLimited: false,
      error: errorMessage,
    };
  }
}
