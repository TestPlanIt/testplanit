import { prisma } from "@/lib/prisma";
import micromatch from "micromatch";
import {
  createGitRepoAdapter,
  type GitRepoAdapter
} from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  repoFileCache,
  type RepoFileEntry
} from "~/lib/integrations/cache/RepoFileCache";
import { bfsRank, buildImportGraph, isBarrelFile } from "./import-analyzer";

// Same heuristic as LlmManager.chatStream (line 261): ~4 chars per token
const CHARS_PER_TOKEN = 4;

// Reserve 20% of the budget for system prompt, case data, and output tokens
const CONTEXT_BUDGET_RATIO = 0.8;

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429");
}

// Words too generic to be useful for relevance scoring
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "that", "this",
  "it", "its", "click", "enter", "verify", "check", "then", "when",
  "given", "user", "page", "test", "into", "that", "with", "from",
]);

export interface AssembledContext {
  context: string; // Concatenated file contents with path headers
  filesUsed: string[]; // Paths of files included
  tokenEstimate: number; // Estimated tokens used
  truncated: boolean; // true if some files were skipped due to budget
}

interface PathPattern {
  path: string;
  pattern: string;
}

export function applyPathPatterns(
  allFiles: RepoFileEntry[],
  pathPatterns: PathPattern[]
): RepoFileEntry[] {
  if (!pathPatterns.length) return allFiles;

  const matched = new Set<string>();
  for (const { path: basePath, pattern } of pathPatterns) {
    const trimmedBase = basePath.replace(/\/$/, "");
    const globPattern = trimmedBase ? `${trimmedBase}/${pattern}` : pattern;
    const matchedPaths = micromatch(
      allFiles.map((f) => f.path),
      globPattern
    );
    matchedPaths.forEach((p: string) => matched.add(p));
  }

  return allFiles.filter((f) => matched.has(f.path));
}

/**
 * Extract meaningful terms from free text for relevance scoring.
 * Splits on non-alphanumeric, lowercases, removes stop words and short tokens.
 */
export function extractTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3 && !STOP_WORDS.has(t))
  );
}

/**
 * Score a file path by how many case-derived terms appear in its segments.
 * e.g. "tests/e2e/login-page.spec.ts" scores higher if "login" is in terms.
 */
export function scoreFileRelevance(filePath: string, terms: Set<string>): number {
  if (terms.size === 0) return 0;
  const segments = filePath.toLowerCase().split(/[\/.\-_]+/).filter((s) => s.length > 2);
  return segments.filter((s) => terms.has(s)).length;
}

/**
 * Service for assembling repository file context for AI code generation.
 * Bridges the cached file list with the LLM call by fetching actual file
 * contents and managing the token budget.
 *
 * When cacheEnabled=false the service fetches the file list and content
 * live from the git provider without storing anything in Valkey or the DB.
 *
 * Files are ranked by relevance to the current test case (term overlap with
 * case name + step text), with size as a tiebreaker so that equally-relevant
 * files prefer smaller ones.
 */
export class CodeContextService {
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Select files to include in context, ranked by BFS import proximity when a
   * seed file can be identified via term overlap; falls back to naive sort otherwise.
   *
   * When preloadedContents is provided (cacheEnabled path), no git adapter calls
   * are made — all content is read from the pre-loaded map.  The adapter is only
   * called on cache misses (or in live-fetch mode when no preloadedContents).
   */
  private static async selectFiles(args: {
    files: RepoFileEntry[];
    adapter: GitRepoAdapter;
    branch: string;
    budgetTokens: number;
    relevanceHint?: string;
    preloadedContents?: Map<string, string>;
  }): Promise<{
    contextParts: string[];
    filesUsed: string[];
    tokenEstimate: number;
    truncated: boolean;
  }> {
    const terms = args.relevanceHint
      ? extractTerms(args.relevanceHint)
      : new Set<string>();

    // Helper: get content from cache first, fall back to adapter
    const fetchContent = async (filePath: string): Promise<string> => {
      const cached = args.preloadedContents?.get(filePath);
      if (cached !== undefined) return cached;
      return args.adapter.getFileContent(filePath, args.branch);
    };

    // Score each file by term overlap to find the seed
    const scored = args.files.map((file) => ({
      file,
      score: scoreFileRelevance(file.path, terms),
    }));

    const bestSeed = scored.reduce(
      (best, curr) => (curr.score > best.score ? curr : best),
      scored[0] ?? { file: args.files[0], score: 0 }
    );

    // Fallback: no seed identified → naive sort (existing behavior)
    if (!bestSeed || bestSeed.score === 0) {
      const sortedFiles = [...args.files].sort(
        (a: RepoFileEntry, b: RepoFileEntry) => {
          const scoreA = scoreFileRelevance(a.path, terms);
          const scoreB = scoreFileRelevance(b.path, terms);
          if (scoreA !== scoreB) return scoreB - scoreA;
          return a.size - b.size;
        }
      );

      const contextParts: string[] = [];
      const filesUsed: string[] = [];
      let currentTokens = 0;
      let truncated = false;

      for (const file of sortedFiles) {
        try {
          const content = await fetchContent(file.path);
          const formatted = `--- file: ${file.path} ---\n${content}\n`;
          const blockTokens = CodeContextService.estimateTokens(formatted);

          if (currentTokens + blockTokens > args.budgetTokens) {
            truncated = true;
            break;
          }

          contextParts.push(formatted);
          filesUsed.push(file.path);
          currentTokens += blockTokens;
        } catch (err) {
          if (isRateLimitError(err)) {
            console.warn(
              `[CodeContextService] Rate limited after ${filesUsed.length} files — stopping context assembly`
            );
            truncated = true;
            break;
          }
          console.warn(
            `[CodeContextService] Failed to fetch file ${file.path}, skipping:`,
            err
          );
        }
      }

      return { contextParts, filesUsed, tokenEstimate: currentTokens, truncated };
    }

    // BFS path: seed identified — load all file contents to build import graph.
    // Uses preloadedContents when available (no git API calls); falls back to
    // adapter only for files missing from the cache.
    const cacheSource = args.preloadedContents ? "Valkey cache" : "git adapter";
    console.log(
      `[CodeContextService] BFS path: seed="${bestSeed.file.path}" (score=${bestSeed.score}), loading content for ${args.files.length} files from ${cacheSource}`
    );
    const contentCache = new Map<string, string>();
    for (const file of args.files) {
      try {
        const content = await fetchContent(file.path);
        contentCache.set(file.path, content);
      } catch (err) {
        if (isRateLimitError(err)) {
          console.warn(
            `[CodeContextService] BFS pre-pass: rate limited after ${contentCache.size}/${args.files.length} files — proceeding with partial content`
          );
          break;
        }
        console.warn(
          `[CodeContextService] BFS pre-pass: failed to fetch ${file.path}, skipping:`,
          err
        );
      }
    }

    // Build import graph from all fetched contents
    const availablePaths = new Set(args.files.map((f) => f.path));
    const graph = buildImportGraph(contentCache, availablePaths);

    // Detect barrel files
    const barrelPaths = new Set<string>();
    for (const [path, content] of contentCache) {
      if (isBarrelFile(content)) {
        barrelPaths.add(path);
      }
    }

    // Run BFS from seed, rank all files by import proximity
    const ranked = bfsRank(
      bestSeed.file.path,
      graph,
      args.files.map((f) => f.path),
      barrelPaths
    );

    // Build a path→RepoFileEntry map for O(1) lookup
    const fileByPath = new Map<string, RepoFileEntry>(
      args.files.map((f) => [f.path, f])
    );

    // Assemble context in BFS order using cached content — no re-fetch
    const contextParts: string[] = [];
    const filesUsed: string[] = [];
    let currentTokens = 0;
    let truncated = false;

    for (const { path } of ranked) {
      const file = fileByPath.get(path);
      if (!file) continue;

      const content = contentCache.get(path);
      if (content === undefined) continue; // fetch failed during pre-pass, skip

      const formatted = `--- file: ${file.path} ---\n${content}\n`;
      const blockTokens = CodeContextService.estimateTokens(formatted);

      if (currentTokens + blockTokens > args.budgetTokens) {
        truncated = true;
        break;
      }

      contextParts.push(formatted);
      filesUsed.push(file.path);
      currentTokens += blockTokens;
    }

    return { contextParts, filesUsed, tokenEstimate: currentTokens, truncated };
  }

  /**
   * Assemble code context within a token budget.
   *
   * @param projectConfigId  DB id of the ProjectCodeRepositoryConfig
   * @param maxTokens        Total token budget for the LLM call
   * @param relevanceHint    Free text from the test case (name + steps) used
   *                         to rank files by relevance before fetching content
   *
   * cacheEnabled=true  → read file list + contents from Valkey (no git API calls)
   * cacheEnabled=false → fetch file list + content live from git, store nothing
   */
  static async assembleContext(
    projectConfigId: number,
    maxTokens: number,
    relevanceHint?: string
  ): Promise<AssembledContext> {
    const empty: AssembledContext = {
      context: "",
      filesUsed: [],
      tokenEstimate: 0,
      truncated: false,
    };

    // Load config (need cacheEnabled and pathPatterns before anything else)
    const config = await prisma.projectCodeRepositoryConfig.findUnique({
      where: { id: projectConfigId },
      include: {
        repository: {
          select: { credentials: true, settings: true, provider: true },
        },
      },
    });

    if (!config) {
      throw new Error("Project code repository config not found");
    }

    const credentials = config.repository.credentials as Record<string, string>;
    const adapter = createGitRepoAdapter(
      config.repository.provider,
      credentials,
      config.repository.settings as Record<string, string> | null
    );
    const branch = config.branch || (await adapter.getDefaultBranch());
    const budgetTokens = Math.floor(maxTokens * CONTEXT_BUDGET_RATIO);

    let filesToFetch: RepoFileEntry[];
    let preloadedContents: Map<string, string> | undefined;

    if ((config as any).cacheEnabled) {
      // Cache path: read file list from Valkey
      const cached = await repoFileCache.getFiles(projectConfigId);
      if (!cached || cached.length === 0) {
        console.log(
          `[CodeContextService] Cache empty for config ${projectConfigId} — proceeding with no context`
        );
        return empty;
      }
      console.log(
        `[CodeContextService] Cache hit: ${cached.length} files for config ${projectConfigId}`
      );
      filesToFetch = cached;

      // Load cached file contents to avoid live git API calls during BFS
      const cachedContents = await repoFileCache.getFileContents(projectConfigId);
      if (cachedContents && cachedContents.size > 0) {
        preloadedContents = cachedContents;
        console.log(
          `[CodeContextService] Content cache hit: ${cachedContents.size} files for config ${projectConfigId}`
        );
      } else {
        console.log(
          `[CodeContextService] Content cache miss for config ${projectConfigId} — will fetch from git`
        );
      }
    } else {
      // Live path: fetch file list from git, apply path patterns, store nothing
      const { files: allFiles } = await adapter.listAllFiles(branch);
      const pathPatterns = (config.pathPatterns as unknown as PathPattern[]) ?? [];
      filesToFetch = applyPathPatterns(allFiles, pathPatterns);
      if (filesToFetch.length === 0) return empty;
    }

    const { contextParts, filesUsed, tokenEstimate, truncated } =
      await CodeContextService.selectFiles({
        files: filesToFetch,
        adapter,
        branch,
        budgetTokens,
        relevanceHint,
        preloadedContents,
      });

    return {
      context: contextParts.join("\n"),
      filesUsed,
      tokenEstimate,
      truncated,
    };
  }

  /**
   * Quick check: does this project have usable code context?
   *
   * - cacheEnabled=true  → checks Valkey for cached files
   * - cacheEnabled=false → returns true if a config exists (live fetch at
   *   export time, no way to pre-verify without a network round-trip)
   */
  static async checkProjectHasCodeContext(
    projectId: number
  ): Promise<boolean> {
    const config = await prisma.projectCodeRepositoryConfig.findUnique({
      where: { projectId },
      select: { id: true, cacheEnabled: true } as any,
    });

    if (!config) return false;

    if (!(config as any).cacheEnabled) {
      // Live-fetch mode: context is available as long as the config exists
      return true;
    }

    const files = await repoFileCache.getFiles((config as any).id);
    return files !== null && files.length > 0;
  }
}
