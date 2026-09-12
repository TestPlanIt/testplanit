import { Job, Worker } from "bullmq";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import { LLM_FEATURES } from "../lib/llm/constants";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import { PromptResolver } from "../lib/llm/services/prompt-resolver.service";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { IMPACT_ANALYSIS_QUEUE_NAME } from "../lib/queueNames";
import { impactConfig } from "../lib/services/impact/config";
import {
  changedDirsOf,
  getOrComputeCompare,
  toDiffFileRecords,
} from "../lib/services/impact/compareService";
import {
  buildDiffSummary,
  renderDiffSummaryForPrompt,
} from "../lib/services/impact/diffSummary";
import { getCommitFilePaths } from "../lib/services/impact/commitFiles";
import { getFileAtCommit } from "../lib/services/impact/fileAtCommit";
import { impactCancelKey } from "../lib/services/impact/jobKeys";
import { runAiLayer } from "../lib/services/impact/layers/aiLayer";
import { runHistoryLayer } from "../lib/services/impact/layers/historyLayer";
import { runIssueLayer } from "../lib/services/impact/layers/issueLayer";
import { runPathLayer } from "../lib/services/impact/layers/pathLayer";
import {
  runPinLayer,
  type PinRow,
} from "../lib/services/impact/layers/pinLayer";
import { mergeLayers, type CaseLink } from "../lib/services/impact/merge";
import { derivePathTerms } from "../lib/services/impact/pathTerms";
import {
  markFailed,
  markRunning,
  saveDiff,
  saveResult,
} from "../lib/services/impact/persistence";
import type { DiffFileForMatch } from "../lib/services/impact/pinMatcher";
import {
  compressCase,
  type CompressedCase,
  type RawCaseForPrompt,
} from "../lib/services/impact/promptBuilder";
import { loadRepoConfigForWorker } from "../lib/services/impact/repoAccess";
import type {
  AnalysisResult,
  AnalysisWarning,
  ImpactAnalysisJobData,
  ImpactAnalysisJobResult,
  ImpactPhase,
  ImpactProgress,
  LayerResult,
  ReasonKind,
} from "../lib/services/impact/types";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import {
  getElasticsearchClient,
  getRepositoryCaseIndexName,
} from "../services/elasticsearchService";

const CANCELLED_MESSAGE = "Job cancelled by user";

const CASE_INCLUDE = {
  folder: {
    select: {
      name: true,
      parent: {
        select: { name: true, parent: { select: { name: true } } },
      },
    },
  },
  caseTags: { select: { tag: { select: { name: true } } } },
  caseFieldValues: {
    include: {
      field: {
        select: {
          displayName: true,
          systemName: true,
          type: { select: { type: true } },
          fieldOptions: {
            select: { fieldOption: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} as const;

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === CANCELLED_MESSAGE;
}

function emptyLayerCounts(): Record<ReasonKind, number> {
  return { PIN: 0, ISSUE: 0, PATH: 0, HISTORY: 0, AI: 0, LINKED: 0 };
}

export const processor = async (
  job: Job<ImpactAnalysisJobData>
): Promise<ImpactAnalysisJobResult> => {
  const { analysisId, projectId, configId, baseSha, headSha, userId } =
    job.data;
  console.log(
    `[impact] job ${job.id} analysis ${analysisId} project ${projectId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );
  validateMultiTenantJobData(job.data);

  const redis = await worker!.client;
  const cancelKey = impactCancelKey(String(job.id));
  const isCancelled = async () => Boolean(await redis.get(cancelKey));
  const assertNotCancelled = async () => {
    if (await isCancelled()) {
      await redis.del(cancelKey);
      throw new Error(CANCELLED_MESSAGE);
    }
  };
  const db = getDbClientForJob(job.data) as any;
  const cfg = impactConfig;
  const durationsMs: Partial<Record<ImpactPhase, number>> = {};
  const warnings: AnalysisWarning[] = [];
  let phaseStartedAt = Date.now();
  let currentPhase: ImpactPhase = "resolving_config";

  const enterPhase = async (
    phase: ImpactPhase,
    extra: Partial<ImpactProgress> = {}
  ) => {
    durationsMs[currentPhase] = Date.now() - phaseStartedAt;
    currentPhase = phase;
    phaseStartedAt = Date.now();
    await assertNotCancelled();
    await job.updateProgress({ phase, message: phase, ...extra });
  };

  try {
    await assertNotCancelled();
    await markRunning(db, analysisId, job.id ? String(job.id) : undefined);
    await job.updateProgress({
      phase: "resolving_config",
      message: "resolving_config",
    } satisfies ImpactProgress);

    // ── resolving_config ────────────────────────────────────────────────
    const loaded = await loadRepoConfigForWorker(db, configId, {
      purpose: "IMPACT",
    });
    if (!loaded) {
      throw new Error("Impact repository configuration not found");
    }
    const { config, adapter } = loaded;

    const llmManager = LlmManager.createForWorker(db, job.data.tenantId);
    const promptResolver = new PromptResolver(db);
    const resolvedLlm = await llmManager.resolveIntegration(
      LLM_FEATURES.IMPACT_ANALYSIS,
      projectId
    );
    let maxTokensPerRequest = 8192;
    let maxOutputTokens = 4000;
    let retryOptions: { maxRetries?: number } | undefined;
    if (resolvedLlm) {
      const providerConfig = await db.llmProviderConfig.findFirst({
        where: { llmIntegrationId: resolvedLlm.integrationId },
      });
      if (providerConfig) {
        maxTokensPerRequest = providerConfig.maxTokensPerRequest ?? 8192;
        maxOutputTokens = providerConfig.defaultMaxTokens ?? 4000;
        retryOptions = { maxRetries: providerConfig.retryAttempts ?? 3 };
      }
    }
    const resolvedPrompt = await promptResolver.resolve(
      LLM_FEATURES.IMPACT_ANALYSIS,
      projectId
    );
    maxOutputTokens = Math.max(maxOutputTokens, resolvedPrompt.maxOutputTokens);

    const project = await db.projects.findUnique({
      where: { id: projectId },
      select: { excludeNotStartedFromRuns: true },
    });
    const caseFilter: Record<string, unknown> =
      project?.excludeNotStartedFromRuns
        ? { state: { workflowType: { not: "NOT_STARTED" } } }
        : {};

    // ── fetching_diff ────────────────────────────────────────────────────
    await enterPhase("fetching_diff");
    const { result: compare } = await getOrComputeCompare({
      configId: config.id,
      cacheEnabled: config.cacheEnabled,
      adapter,
      baseSha,
      headSha,
    });
    const diffRecords = toDiffFileRecords(compare);
    const changedPaths = Array.from(
      new Set(
        compare.files.flatMap((f) =>
          f.previousPath ? [f.path, f.previousPath] : [f.path]
        )
      )
    );
    const changedDirs = changedDirsOf(changedPaths);
    await saveDiff(db, analysisId, {
      diffRecords,
      changedPaths,
      changedDirs,
      fileCount: compare.files.length,
      additions: compare.files.reduce((n, f) => n + f.additions, 0),
      deletions: compare.files.reduce((n, f) => n + f.deletions, 0),
      truncated: compare.truncated,
    });
    const diffSummary = buildDiffSummary(compare, cfg, { maxTokensPerRequest });
    if (diffSummary.truncatedByProvider) {
      warnings.push({
        code: "diff_truncated_by_provider",
        detail: { filesReturned: compare.files.length },
      });
    }
    if (diffSummary.truncatedByBudget) {
      warnings.push({
        code: "diff_truncated_by_budget",
        detail: { omittedFileCount: diffSummary.omittedFileCount },
      });
    }
    const includedPaths = diffSummary.files.map((f) => f.path);

    // ── matching_pins ────────────────────────────────────────────────────
    await enterPhase("matching_pins", {
      filesTotal: compare.files.length,
      filesIncluded: diffSummary.files.length,
    });
    const pinRows = (await db.repositoryCaseCodePin.findMany({
      where: {
        configId: config.id,
        isDeleted: false,
        case: { isDeleted: false, isArchived: false, ...caseFilter },
      },
      select: {
        id: true,
        caseId: true,
        kind: true,
        filePath: true,
        startLine: true,
        endLine: true,
        symbol: true,
        anchorSha: true,
        anchorSnippet: true,
        staleDismissedAt: true,
        source: true,
      },
    })) as PinRow[];

    const hunksByPath = new Map(diffRecords.map((r) => [r.path, r.hunks]));
    const filesForMatch: DiffFileForMatch[] = compare.files.map((f) => ({
      path: f.path,
      previousPath: f.previousPath,
      status: f.status,
      isBinary: f.isBinary,
      hunks: hunksByPath.get(f.path) ?? [],
      patch: f.patch,
    }));

    const changedPathSet = new Set(changedPaths);
    const needsFetch = new Set<string>();
    for (const pin of pinRows) {
      if (
        (pin.kind === "RANGE" || pin.kind === "SYMBOL") &&
        changedPathSet.has(pin.filePath) &&
        !(pin.kind === "RANGE" && pin.anchorSha === baseSha)
      ) {
        needsFetch.add(pin.filePath);
      }
    }
    const fetchable = new Set([...needsFetch].slice(0, cfg.maxAnchorFetches));
    if (needsFetch.size > fetchable.size) {
      warnings.push({
        code: "anchor_fetch_capped",
        detail: { needed: needsFetch.size, cap: cfg.maxAnchorFetches },
      });
    }
    const pinsForMatch: PinRow[] = pinRows.map((pin) =>
      (pin.kind === "RANGE" || pin.kind === "SYMBOL") &&
      needsFetch.has(pin.filePath) &&
      !fetchable.has(pin.filePath)
        ? { ...pin, kind: "FILE" }
        : pin
    );
    const baseFileCache = new Map<string, Promise<string | null>>();
    const getBaseFile = (path: string): Promise<string | null> => {
      let pending = baseFileCache.get(path);
      if (!pending) {
        pending = getFileAtCommit({
          configId: config.id,
          cacheEnabled: config.cacheEnabled,
          adapter,
          path,
          sha: baseSha,
        })
          .then((r) => r.content)
          .catch(() => null);
        baseFileCache.set(path, pending);
      }
      return pending;
    };
    const pinLayer = await runPinLayer(pinsForMatch, filesForMatch, {
      baseSha,
      getBaseFile,
    });
    const pinnedCaseIds = [...pinLayer.layer.keys()];

    // ── matching_issues ──────────────────────────────────────────────────
    await enterPhase("matching_issues", {
      pinsMatched: pinLayer.matchedPinCount,
      pinsStale: pinLayer.stalePins.length,
    });
    const issueLayer = await runIssueLayer(db, {
      projectId,
      commits: compare.commits,
      changedPaths,
      caseFilter: { isArchived: false, ...caseFilter },
      maxCommitFetches: cfg.issueMaxCommitFetches,
      getCommitFiles: async (commit) => {
        try {
          const files = await getCommitFilePaths({
            configId: config.id,
            cacheEnabled: config.cacheEnabled,
            adapter,
            commit,
            maxFiles: cfg.maxDiffFiles,
          });
          return files?.paths ?? null;
        } catch (error) {
          console.warn(
            `[impact] could not read files of commit ${commit.shortSha}:`,
            error instanceof Error ? error.message : error
          );
          return null;
        }
      },
    });
    if (issueLayer.fetchCapped) {
      warnings.push({
        code: "issue_commit_fetch_capped",
        detail: {
          matchedCommits: issueLayer.matchedCommitCount,
          cap: cfg.issueMaxCommitFetches,
        },
      });
    }

    // ── searching_cases ──────────────────────────────────────────────────
    await enterPhase("searching_cases", {
      pinsMatched: pinLayer.matchedPinCount,
      pinsStale: pinLayer.stalePins.length,
      issuesMatched: issueLayer.issueCount,
    });
    const terms = derivePathTerms(diffSummary);
    const pathLayer = await runPathLayer(db, getElasticsearchClient(), {
      projectId,
      indexName: getRepositoryCaseIndexName(job.data.tenantId),
      terms,
      cfg,
      caseFilter,
    });
    if (pathLayer.indexEmpty) {
      // The useful thing to say: the index holds nothing for this project, so
      // a reindex is what turns a thin result into a real one.
      warnings.push({ code: "search_index_empty" });
    } else if (pathLayer.searchFailed) {
      warnings.push({ code: "search_fallback_db" });
    }

    // ── scoring_history ──────────────────────────────────────────────────
    await enterPhase("scoring_history", { candidates: pathLayer.layer.size });
    const history = await runHistoryLayer(db, {
      projectId,
      analysisId,
      changedPaths,
      changedDirs,
      cfg,
    });

    // ── waiting_for_ai ───────────────────────────────────────────────────
    const excluded = new Set(job.data.excludeCaseIds ?? []);
    const repositoryTotalCount: number = await db.repositoryCases.count({
      where: { projectId, isDeleted: false, isArchived: false, ...caseFilter },
    });
    let aiLayer: LayerResult = new Map();
    let aiSummary = "";
    let aiUncovered: string[] = [];
    let aiStats: AnalysisResult["stats"]["ai"];
    let aiCandidateCount = 0;

    if (!resolvedLlm) {
      warnings.push({ code: "llm_not_configured" });
    } else {
      await enterPhase("waiting_for_ai");
      const pinnedSet = new Set(pinnedCaseIds);
      const baseWhere = {
        projectId,
        isDeleted: false,
        isArchived: false,
        ...caseFilter,
      };
      let candidateWhere: Record<string, unknown>;
      if (repositoryTotalCount <= cfg.aiFullRepoThreshold) {
        candidateWhere = { ...baseWhere, id: { notIn: [...pinnedSet] } };
      } else {
        const seed = new Set<number>([
          ...issueLayer.layer.keys(),
          ...pathLayer.layer.keys(),
          ...history.layer.keys(),
        ]);
        for (const id of pinnedSet) seed.delete(id);
        const seedRows = (await db.repositoryCases.findMany({
          where: { id: { in: [...seed] } },
          select: { folderId: true },
        })) as Array<{ folderId: number | null }>;
        const folderIds = [
          ...new Set(seedRows.map((r) => r.folderId).filter((x) => x !== null)),
        ] as number[];
        const neighbours =
          folderIds.length > 0
            ? ((await db.repositoryCases.findMany({
                where: {
                  ...baseWhere,
                  folderId: { in: folderIds },
                  id: { notIn: [...seed, ...pinnedSet] },
                },
                select: { id: true },
                orderBy: { id: "desc" },
                take: cfg.aiSampleSize,
              })) as Array<{ id: number }>)
            : [];
        const ids = [...seed, ...neighbours.map((n) => n.id)].slice(
          0,
          cfg.maxAiCandidates
        );
        candidateWhere = { ...baseWhere, id: { in: ids } };
      }
      const rawCases = (await db.repositoryCases.findMany({
        where: candidateWhere,
        include: CASE_INCLUDE,
        orderBy: { name: "asc" },
        take: cfg.maxAiCandidates,
      })) as RawCaseForPrompt[];
      const candidates: CompressedCase[] = rawCases.map((raw) =>
        compressCase(raw, {
          truncateCaseName: cfg.truncateCaseName,
          truncateTextLong: cfg.truncateTextLong,
          truncateOtherField: cfg.truncateOtherField,
        })
      );
      aiCandidateCount = candidates.length;

      if (candidates.length > 0) {
        const ai = await runAiLayer(
          {
            llm: llmManager,
            feature: LLM_FEATURES.IMPACT_ANALYSIS,
            isCancelled,
            onBatchComplete: async (processed, total) => {
              await job.updateProgress({
                phase: "waiting_for_ai",
                message: "waiting_for_ai",
                casesRanked: processed,
                casesToRank: total,
                candidates: candidates.length,
              } satisfies ImpactProgress);
            },
          },
          {
            integrationId: resolvedLlm.integrationId,
            model: resolvedLlm.model,
            systemPrompt: resolvedPrompt.systemPrompt,
            userTemplate: resolvedPrompt.userPrompt,
            temperature: resolvedPrompt.temperature,
            maxOutputTokens,
            maxTokensPerRequest,
            retryOptions,
            userId,
            projectId,
            analysisId,
            baseSha,
            headSha,
            notes: job.data.notes,
            diffText: renderDiffSummaryForPrompt(diffSummary),
            changedFileCount: diffSummary.files.length,
            excludedCount: diffSummary.excludedFiles.length,
            changedPaths: includedPaths,
            pinnedCaseIds,
            candidates,
            cfg,
          }
        );
        if (ai.cancelled) {
          await redis.del(cancelKey);
          throw new Error(CANCELLED_MESSAGE);
        }
        aiLayer = ai.layer;
        aiSummary = ai.summary;
        aiUncovered = ai.uncoveredFiles;
        aiStats = ai.stats;
        warnings.push(...ai.warnings);
      }
    }

    // ── merging ──────────────────────────────────────────────────────────
    await enterPhase("merging");
    const involved = new Set<number>([
      ...pinLayer.layer.keys(),
      ...issueLayer.layer.keys(),
      ...pathLayer.layer.keys(),
      ...history.layer.keys(),
      ...aiLayer.keys(),
    ]);
    const links = new Map<number, CaseLink[]>();
    if (cfg.linkedExpansion && involved.size > 0) {
      const linkRows = (await db.repositoryCaseLink.findMany({
        where: {
          isDeleted: false,
          OR: [
            { caseAId: { in: [...involved] } },
            { caseBId: { in: [...involved] } },
          ],
        },
        select: { caseAId: true, caseBId: true, type: true },
      })) as Array<{ caseAId: number; caseBId: number; type: string }>;
      for (const row of linkRows) {
        for (const [from, to] of [
          [row.caseAId, row.caseBId],
          [row.caseBId, row.caseAId],
        ] as Array<[number, number]>) {
          const list = links.get(from) ?? [];
          list.push({ otherId: to, type: row.type });
          links.set(from, list);
        }
      }
    }
    const merged = mergeLayers({
      pin: pinLayer.layer,
      issue: issueLayer.layer,
      path: pathLayer.layer,
      history: history.layer,
      ai: aiLayer,
      links,
      changedPaths: includedPaths,
      cfg,
    });
    const cases = merged.cases.filter((c) => !excluded.has(c.caseId));
    const uncoveredFiles = Array.from(
      new Set([
        ...merged.uncoveredFiles,
        ...aiUncovered.filter((p) => merged.uncoveredFiles.includes(p)),
      ])
    );
    if (cases.length === 0) warnings.push({ code: "no_candidates" });

    const layerCounts = emptyLayerCounts();
    for (const c of cases) for (const kind of c.layers) layerCounts[kind]++;
    durationsMs[currentPhase] = Date.now() - phaseStartedAt;

    const result: AnalysisResult = {
      analysisId,
      baseSha,
      headSha,
      diff: diffSummary,
      cases,
      stalePins: pinLayer.stalePins,
      uncoveredFiles,
      summary: aiSummary,
      warnings,
      stats: {
        repositoryTotalCount,
        candidateCount: involved.size,
        aiCandidateCount,
        layerCounts,
        searchMode: pathLayer.searchMode,
        ...(aiStats ? { ai: aiStats } : {}),
        durationsMs,
      },
    };
    await saveResult(db, analysisId, result);

    return {
      analysisId,
      status: "complete",
      caseCount: cases.length,
      pinnedCount: cases.filter((c) => c.tier === "pinned").length,
      affectedCount: cases.filter((c) => c.tier !== "related").length,
      uncoveredCount: uncoveredFiles.length,
      warnings: warnings.map((w) => w.code),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(
      db,
      analysisId,
      isCancelledError(error) ? "CANCELLED" : "FAILED",
      message
    ).catch((persistError) =>
      console.error("[impact] failed to persist failure:", persistError)
    );
    throw error;
  }
};

// ─── Worker setup ───────────────────────────────────────────────────────────

let worker: Worker<ImpactAnalysisJobData, ImpactAnalysisJobResult> | null =
  null;

export function startImpactAnalysisWorker() {
  console.log(
    `Impact analysis worker starting in ${
      isMultiTenantMode() ? "MULTI-TENANT" : "SINGLE-TENANT"
    } mode`
  );

  worker = new Worker<ImpactAnalysisJobData, ImpactAnalysisJobResult>(
    IMPACT_ANALYSIS_QUEUE_NAME,
    withTenantContext(processor),
    {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: Number(process.env.IMPACT_ANALYSIS_CONCURRENCY || "1"),
    }
  );

  worker.on("completed", (job) =>
    console.log(`Impact analysis job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`Impact analysis job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("Impact analysis worker error:", err);
  });

  console.log(
    `Impact analysis worker started for queue "${IMPACT_ANALYSIS_QUEUE_NAME}".`
  );

  const shutdown = async () => {
    console.log("Shutting down impact analysis worker...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return worker;
}

if (require.main === module) {
  console.log("Impact analysis worker running...");
  startImpactAnalysisWorker();
}

export default worker;
