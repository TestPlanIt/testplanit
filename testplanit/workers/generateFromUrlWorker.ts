import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { GENERATE_FROM_URL_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";
import { ssrfSafeFetch, SsrfError } from "../lib/utils/ssrf";
import { extractContent } from "../lib/utils/contentExtractor";
import { extractLinks, normalizeUrl, hashContent, fetchRobots } from "../lib/utils/crawl";

// ---- Job data / result types ----

export interface GenerateFromUrlJobData extends MultiTenantJobData {
  projectId: number;
  userId: string;
  url: string;
  options: {
    followLinks: boolean;
    maxDepth: number;
    maxPages: number;
  };
}

export interface GenerateFromUrlJobResult {
  testCases: unknown[];
  pagesProcessed: number;
  warnings: string[];
  robotsSkipped: number;
  urlsCrawled: string[];
}

// ---- Cancel key ----

function cancelKey(jobId: string | undefined): string {
  return `generate-from-url:cancel:${jobId}`;
}

// ---- Internal types ----

interface PageContent {
  url: string;
  markdown: string;
  hash: string;
  spaWarning: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Processor ----

export const processor = async (
  job: Job<GenerateFromUrlJobData>,
  token?: string
): Promise<GenerateFromUrlJobResult> => {
  console.log(
    `Processing generate-from-url job ${job.id} for project ${job.data.projectId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Check for pre-start cancellation
  const redis = await worker!.client;
  const cancelled = await redis.get(cancelKey(job.id));
  if (cancelled) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 3. Setup phase
  await job.updateProgress({ phase: "setup", message: "initializing" });

  const seedUrl = job.data.url;
  const startHostname = new URL(seedUrl).hostname;

  // 4. Fetch robots.txt once at crawl start (per locked decision)
  const robots = await fetchRobots(new URL(seedUrl).origin);

  // 5. BFS loop initialization
  const visited = new Set<string>();
  const bfsQueue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
  const pages: PageContent[] = [];
  const spaWarnings: string[] = [];
  let skippedRobots = 0;

  // 6. BFS loop
  while (bfsQueue.length > 0 && pages.length < job.data.options.maxPages) {
    const item = bfsQueue.shift()!;
    const normalizedUrl = normalizeUrl(item.url);

    // Skip already visited
    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);

    // robots.txt check — only for discovered links (depth > 0), not the seed URL
    if (
      robots !== null &&
      item.depth > 0 &&
      robots.isAllowed(normalizedUrl, "TestPlanIt") === false
    ) {
      skippedRobots++;
      await job.updateProgress({
        phase: "crawling",
        message: `Skipped robots.txt: ${normalizedUrl}`,
        pagesProcessed: pages.length,
        totalPages: Math.min(pages.length + bfsQueue.length, job.data.options.maxPages),
        skippedRobots,
      });
      continue;
    }

    // Cancellation check between each page fetch
    const isCancelled = await redis.get(cancelKey(job.id));
    if (isCancelled) break;

    // Fetch page
    try {
      const { body, finalUrl } = await ssrfSafeFetch(normalizedUrl, { allowHttp: true });
      const result = extractContent(body, finalUrl);

      // Content deduplication — hash first 1000 chars of extracted markdown
      const contentHash = hashContent(result.markdown.slice(0, 1000));
      const isDuplicate = pages.some(p => p.hash === contentHash);

      if (!isDuplicate) {
        pages.push({
          url: finalUrl,
          markdown: result.markdown,
          hash: contentHash,
          spaWarning: result.spaWarning,
        });

        if (result.spaWarning) {
          spaWarnings.push(
            `SPA warning: ${finalUrl} may require JavaScript rendering. Generated test cases may be incomplete.`
          );
        }

        // Enqueue same-domain links if following links is enabled and within limits
        if (
          job.data.options.followLinks &&
          item.depth < job.data.options.maxDepth &&
          pages.length < job.data.options.maxPages
        ) {
          const links = extractLinks(body, finalUrl, startHostname);
          for (const link of links) {
            if (!visited.has(normalizeUrl(link))) {
              bfsQueue.push({ url: link, depth: item.depth + 1 });
            }
          }
        }
      }
    } catch (err) {
      // Skip non-HTML pages (INVALID_CONTENT_TYPE), SSRF violations, and other errors
      // Do not stop the crawl — just continue to the next URL
      if (err instanceof SsrfError) {
        console.log(`Skipped ${normalizedUrl}: ${err.code} — ${err.message}`);
      } else {
        console.log(`Skipped ${normalizedUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Extend lock to prevent BullMQ from marking the job as stalled
    await job.extendLock(token!, 60_000);

    // Update progress
    await job.updateProgress({
      phase: "crawling",
      message: `Fetching page ${pages.length}`,
      pagesProcessed: pages.length,
      totalPages: Math.min(pages.length + bfsQueue.length, job.data.options.maxPages),
      skippedRobots,
    });

    // Polite delay between page fetches (locked decision: 500ms)
    await sleep(500);
  }

  // 7. Post-crawl: error if nothing was extracted
  if (pages.length === 0) {
    throw new Error("No content could be extracted from the provided URL");
  }

  // 8. Final progress update and clean up cancel key
  await job.updateProgress({
    phase: "complete",
    message: `Crawl finished: ${pages.length} pages`,
    pagesProcessed: pages.length,
    totalPages: pages.length,
    skippedRobots,
  });

  // Clean up cancel key if it was set during crawl
  await redis.del(cancelKey(job.id));

  // NOTE: Phase 63 adds LLM generation using the in-memory `pages` array.
  // Do NOT store raw page markdown in the return value (Redis bloat anti-pattern).
  return {
    testCases: [],  // Phase 63 adds LLM generation
    pagesProcessed: pages.length,
    warnings: spaWarnings,
    robotsSkipped: skippedRobots,
    urlsCrawled: pages.map(p => p.url),
  };
};

// ---- Worker setup ----

let worker: Worker<GenerateFromUrlJobData, GenerateFromUrlJobResult> | null =
  null;

export function startGenerateFromUrlWorker() {
  if (isMultiTenantMode()) {
    console.log("Generate-from-URL worker starting in MULTI-TENANT mode");
  } else {
    console.log("Generate-from-URL worker starting in SINGLE-TENANT mode");
  }

  worker = new Worker<GenerateFromUrlJobData, GenerateFromUrlJobResult>(
    GENERATE_FROM_URL_QUEUE_NAME,
    processor,
    {
      connection: valkeyConnection as any,
      concurrency: 1,
      lockDuration: 60_000,
      maxStalledCount: 1,
      stalledInterval: 30_000,
    }
  );

  worker.on("completed", (job) =>
    console.log(`Generate-from-URL job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`Generate-from-URL job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("Generate-from-URL worker error:", err);
  });

  console.log(
    `Generate-from-URL worker started for queue "${GENERATE_FROM_URL_QUEUE_NAME}".`
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down generate-from-URL worker...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down generate-from-URL worker...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });

  return worker;
}

// Auto-start
startGenerateFromUrlWorker();
