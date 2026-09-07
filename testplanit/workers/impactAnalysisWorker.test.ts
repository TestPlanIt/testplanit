import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PinRow } from "../lib/services/impact/layers/pinLayer";
import type {
  AnalysisResult,
  ImpactAnalysisJobData,
} from "../lib/services/impact/types";

// ─── Stable mock refs via vi.hoisted() ───────────────────────────────────────

const {
  mockUpdateProgress,
  mockRedisGet,
  mockRedisDel,
  mockLoadRepoConfig,
  mockGetOrComputeCompare,
  mockGetFileAtCommit,
  mockMarkRunning,
  mockSaveDiff,
  mockSaveResult,
  mockMarkFailed,
  mockGetEsClient,
  mockEsSearch,
  mockChat,
  mockResolveIntegration,
  mockResolve,
  mockFindFirstLlmProviderConfig,
  mockFindUniqueProject,
  mockFindManyPins,
  mockCountCases,
  mockFindManyCases,
  mockFindManyCaseTags,
  mockFindManyFolders,
  mockFindManyAnalyses,
  mockFindManyRunCases,
  mockFindManyCaseLinks,
} = vi.hoisted(() => ({
  mockUpdateProgress: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockLoadRepoConfig: vi.fn(),
  mockGetOrComputeCompare: vi.fn(),
  mockGetFileAtCommit: vi.fn(),
  mockMarkRunning: vi.fn(),
  mockSaveDiff: vi.fn(),
  mockSaveResult: vi.fn(),
  mockMarkFailed: vi.fn(),
  mockGetEsClient: vi.fn(),
  mockEsSearch: vi.fn(),
  mockChat: vi.fn(),
  mockResolveIntegration: vi.fn(),
  mockResolve: vi.fn(),
  mockFindFirstLlmProviderConfig: vi.fn(),
  mockFindUniqueProject: vi.fn(),
  mockFindManyPins: vi.fn(),
  mockCountCases: vi.fn(),
  mockFindManyCases: vi.fn(),
  mockFindManyCaseTags: vi.fn(),
  mockFindManyFolders: vi.fn(),
  mockFindManyAnalyses: vi.fn(),
  mockFindManyRunCases: vi.fn(),
  mockFindManyCaseLinks: vi.fn(),
}));

// ─── Mock bullmq Worker ───────────────────────────────────────────────────────

vi.mock("bullmq", async (importOriginal) => {
  const original = await importOriginal<typeof import("bullmq")>();
  return {
    ...original,
    Worker: class MockWorker {
      on = vi.fn();
      close = vi.fn();
      client = Promise.resolve({
        get: (...args: any[]) => mockRedisGet(...args),
        del: (...args: any[]) => mockRedisDel(...args),
      });
      constructor() {}
    },
  };
});

// The worker needs a truthy connection to construct the Worker; RepoFileCache
// (loaded for real through the partial compareService mock) duplicates it at
// import time, so give it a duplicate() that yields "no cache".
vi.mock("../lib/valkey", () => ({
  default: { status: "ready", duplicate: () => null },
}));

vi.mock("../lib/queueNames", () => ({
  IMPACT_ANALYSIS_QUEUE_NAME: "test-impact-queue",
}));

// ─── Mock db ─────────────────────────────────────────────────────────────────

const mockDb: any = {
  llmProviderConfig: {
    findFirst: (...args: any[]) => mockFindFirstLlmProviderConfig(...args),
  },
  projects: {
    findUnique: (...args: any[]) => mockFindUniqueProject(...args),
  },
  repositoryCaseCodePin: {
    findMany: (...args: any[]) => mockFindManyPins(...args),
  },
  repositoryCases: {
    count: (...args: any[]) => mockCountCases(...args),
    findMany: (...args: any[]) => mockFindManyCases(...args),
  },
  repositoryCaseTag: {
    findMany: (...args: any[]) => mockFindManyCaseTags(...args),
  },
  repositoryFolders: {
    findMany: (...args: any[]) => mockFindManyFolders(...args),
  },
  impactAnalysis: {
    findMany: (...args: any[]) => mockFindManyAnalyses(...args),
  },
  testRunCases: {
    findMany: (...args: any[]) => mockFindManyRunCases(...args),
  },
  repositoryCaseLink: {
    findMany: (...args: any[]) => mockFindManyCaseLinks(...args),
  },
};

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: () => mockDb,
  isMultiTenantMode: () => false,
  validateMultiTenantJobData: () => undefined,
  disconnectAllTenantClients: async () => undefined,
  getCurrentTenantId: () => undefined,
}));

vi.mock("../lib/tenantContext", () => ({
  withTenantContext: (fn: unknown) => fn,
}));

// ─── Mock LlmManager / PromptResolver ────────────────────────────────────────

const mockManager = {
  chat: (...args: any[]) => mockChat(...args),
  resolveIntegration: (...args: any[]) => mockResolveIntegration(...args),
};

vi.mock("../lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    createForWorker: () => mockManager,
  },
}));

vi.mock("../lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class MockPromptResolver {
    resolve = (...args: any[]) => mockResolve(...args);
    constructor() {}
  },
}));

// ─── Mock elasticsearchService ───────────────────────────────────────────────

vi.mock("../services/elasticsearchService", () => ({
  getElasticsearchClient: (...args: any[]) => mockGetEsClient(...args),
  getRepositoryCaseIndexName: () => "test-repository-cases",
}));

// ─── Mock the I/O boundaries of the impact engine; the engine runs for real ──

vi.mock("../lib/services/impact/repoAccess", () => ({
  loadRepoConfigForWorker: (...args: any[]) => mockLoadRepoConfig(...args),
}));

vi.mock("../lib/services/impact/compareService", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../lib/services/impact/compareService")
    >();
  return {
    ...original,
    getOrComputeCompare: (...args: any[]) => mockGetOrComputeCompare(...args),
  };
});

vi.mock("../lib/services/impact/fileAtCommit", () => ({
  getFileAtCommit: (...args: any[]) => mockGetFileAtCommit(...args),
}));

vi.mock("../lib/services/impact/persistence", () => ({
  markRunning: (...args: any[]) => mockMarkRunning(...args),
  saveDiff: (...args: any[]) => mockSaveDiff(...args),
  saveResult: (...args: any[]) => mockSaveResult(...args),
  markFailed: (...args: any[]) => mockMarkFailed(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const OLD_SHA = "3333333333333333333333333333333333333333";
const ANALYSIS_ID = 5;
const JOB_ID = `impact-${ANALYSIS_ID}`;
const CANCEL_KEY = `impact:cancel:${JOB_ID}`;

const LOGIN_PATH = "src/auth/login.ts";
const CHARGE_PATH = "src/payments/charge.ts";

const BASE_LOGIN_LINES = [
  'import { db } from "../db";',
  "",
  "export async function login(email: string, password: string) {",
  "  const user = await db.user.findUnique({ where: { email } });",
  "  if (!user) return null;",
  "  return verifyPassword(user, password);",
  "}",
  "",
  "export function logout() {",
  "  return true;",
  "}",
  "",
];
const BASE_LOGIN_FILE = BASE_LOGIN_LINES.join("\n");
/** Lines 4-6 of the base file. */
const LOGIN_SNIPPET = BASE_LOGIN_LINES.slice(3, 6).join("\n");

/** Replaces old lines 5-6 of login.ts (changedOldRanges [[5, 6]]). */
const LOGIN_PATCH = [
  "@@ -3,5 +3,6 @@ export async function login(email: string, password: string) {",
  " export async function login(email: string, password: string) {",
  "   const user = await db.user.findUnique({ where: { email } });",
  "-  if (!user) return null;",
  "-  return verifyPassword(user, password);",
  '+  if (!user) throw new Error("unknown user");',
  "+  await audit(user);",
  "+  return verifyPassword(user, password);",
  " }",
].join("\n");

const CHARGE_PATCH = [
  "@@ -0,0 +1,3 @@",
  "+export function charge(amount: number) {",
  "+  return amount * 100;",
  "+}",
].join("\n");

function compareFixture() {
  return {
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    files: [
      {
        path: LOGIN_PATH,
        status: "modified" as const,
        additions: 3,
        deletions: 2,
        isBinary: false,
        patch: LOGIN_PATCH,
      },
      {
        path: CHARGE_PATH,
        status: "added" as const,
        additions: 3,
        deletions: 0,
        isBinary: false,
        patch: CHARGE_PATCH,
      },
    ],
    commits: [],
    truncated: false,
  };
}

const jobData: ImpactAnalysisJobData = {
  analysisId: ANALYSIS_ID,
  projectId: 1,
  configId: 7,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  userId: "user-1",
};

function makeJob(
  overrides: Partial<{ id: string; data: ImpactAnalysisJobData }> = {}
): Job<ImpactAnalysisJobData> {
  return {
    id: JOB_ID,
    name: "impact-analysis",
    data: jobData,
    updateProgress: mockUpdateProgress,
    ...overrides,
  } as unknown as Job<ImpactAnalysisJobData>;
}

function pinRow(
  overrides: Partial<PinRow> & Pick<PinRow, "id" | "caseId" | "kind">
): PinRow {
  return {
    filePath: LOGIN_PATH,
    startLine: null,
    endLine: null,
    symbol: null,
    anchorSha: null,
    anchorSnippet: null,
    staleDismissedAt: null,
    source: "MANUAL",
    ...overrides,
  };
}

function rawCase(id: number, name: string) {
  return { id, name, folder: null, caseTags: [], caseFieldValues: [] };
}

const defaultResolvedPrompt = {
  systemPrompt: "You select the tests a code change affects.",
  userPrompt: [
    "Diff ({{CHANGED_FILE_COUNT}} files{{EXCLUDED_FILE_NOTE}}):",
    "{{DIFF_SUMMARY}}",
    "{{PINNED_CASES_NOTE}}",
    "Candidates ({{CANDIDATE_COUNT}}{{BATCH_NOTE}}):",
    "{{CANDIDATE_CASES}}",
  ].join("\n"),
  temperature: 0.2,
  maxOutputTokens: 8000,
  source: "fallback" as const,
};

const aiSelectionJson = JSON.stringify({
  selections: [
    {
      caseId: 22,
      score: 88,
      rationale: "The login flow changed and this case exercises it.",
      files: [LOGIN_PATH],
    },
  ],
  uncoveredFiles: [CHARGE_PATH],
  summary: "s",
});

function chatResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: aiSelectionJson,
    model: "gpt-4",
    promptTokens: 500,
    completionTokens: 100,
    totalTokens: 600,
    finishReason: "stop" as const,
    ...overrides,
  };
}

/** Turn the AI layer on with a small repository (under the full-repo threshold). */
function enableLlm(
  cases = [
    rawCase(22, "Login with valid credentials"),
    rawCase(23, "Charge a saved card"),
  ]
) {
  mockResolveIntegration.mockResolvedValue({
    integrationId: 100,
    model: "gpt-4",
  });
  // The AI candidate query is the only repositoryCases.findMany with `include`;
  // the PATH layer's DB fallback uses `select` and must keep returning nothing.
  mockFindManyCases.mockImplementation(async (args: any) =>
    args?.include ? cases : []
  );
}

function savedResult(): AnalysisResult {
  expect(mockSaveResult).toHaveBeenCalledTimes(1);
  return mockSaveResult.mock.calls[0][2] as AnalysisResult;
}

function progressPhases(): string[] {
  return mockUpdateProgress.mock.calls.map(([progress]) => progress.phase);
}

function aiCandidateQuery() {
  return mockFindManyCases.mock.calls.find(([args]) => args?.include)?.[0];
}

async function loadWorker() {
  const mod = await import("./impactAnalysisWorker");
  mod.startImpactAnalysisWorker();
  return mod;
}

let adapter: {
  compareCommits: ReturnType<typeof vi.fn>;
  listCommits: ReturnType<typeof vi.fn>;
  getFileContentAtCommit: ReturnType<typeof vi.fn>;
  getDefaultBranch: ReturnType<typeof vi.fn>;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("impactAnalysisWorker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    adapter = {
      compareCommits: vi.fn(),
      listCommits: vi.fn(),
      getFileContentAtCommit: vi.fn(),
      getDefaultBranch: vi.fn(),
    };

    mockUpdateProgress.mockResolvedValue(undefined);
    mockRedisGet.mockResolvedValue(null);
    mockRedisDel.mockResolvedValue(0);

    mockLoadRepoConfig.mockResolvedValue({
      config: {
        id: 7,
        projectId: 1,
        purpose: "IMPACT",
        branch: "main",
        cacheEnabled: false,
        repositoryId: 3,
        repository: { id: 3, name: "app", provider: "github", settings: null },
      },
      adapter,
    });
    mockGetOrComputeCompare.mockResolvedValue({
      result: compareFixture(),
      cached: false,
    });
    mockGetFileAtCommit.mockResolvedValue({
      content: BASE_LOGIN_FILE,
      cached: false,
    });
    mockMarkRunning.mockResolvedValue(undefined);
    mockSaveDiff.mockResolvedValue(undefined);
    mockSaveResult.mockResolvedValue(undefined);
    mockMarkFailed.mockResolvedValue(undefined);

    mockGetEsClient.mockReturnValue(null);
    mockResolveIntegration.mockResolvedValue(null);
    mockResolve.mockResolvedValue(defaultResolvedPrompt);
    mockChat.mockResolvedValue(chatResponse());

    mockFindFirstLlmProviderConfig.mockResolvedValue(null);
    mockFindUniqueProject.mockResolvedValue({
      excludeNotStartedFromRuns: false,
    });
    mockFindManyPins.mockResolvedValue([]);
    mockCountCases.mockResolvedValue(2);
    mockFindManyCases.mockResolvedValue([]);
    mockFindManyCaseTags.mockResolvedValue([]);
    mockFindManyFolders.mockResolvedValue([]);
    mockFindManyAnalyses.mockResolvedValue([]);
    mockFindManyRunCases.mockResolvedValue([]);
    mockFindManyCaseLinks.mockResolvedValue([]);
  });

  it("runs pins, path and history only when no LLM is configured and reports the phases in order", async () => {
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out).toEqual({
      analysisId: ANALYSIS_ID,
      status: "complete",
      caseCount: 0,
      pinnedCount: 0,
      affectedCount: 0,
      uncoveredCount: 2,
      warnings: expect.arrayContaining(["llm_not_configured", "no_candidates"]),
    });
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockLoadRepoConfig).toHaveBeenCalledWith(mockDb, 7, {
      purpose: "IMPACT",
    });
    expect(mockMarkRunning).toHaveBeenCalledWith(mockDb, ANALYSIS_ID, JOB_ID);
    expect(mockMarkFailed).not.toHaveBeenCalled();

    // The real toDiffFileRecords / changedDirsOf ran over the fixture patch.
    expect(mockSaveDiff).toHaveBeenCalledTimes(1);
    const diff = mockSaveDiff.mock.calls[0][2];
    expect(diff).toMatchObject({
      changedPaths: [LOGIN_PATH, CHARGE_PATH],
      changedDirs: ["src", "src/auth", "src/payments"],
      fileCount: 2,
      additions: 6,
      deletions: 2,
      truncated: false,
    });
    expect(diff.diffRecords[0].hunks[0].changedOldRanges).toEqual([[5, 6]]);

    const result = savedResult();
    expect(result.summary).toBe("");
    expect(result.cases).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["llm_not_configured", "search_fallback_db"])
    );
    expect(result.stats.ai).toBeUndefined();
    expect(result.stats.searchMode).toBe("db");
    expect(result.stats.repositoryTotalCount).toBe(2);
    expect(result.diff.files.map((f) => f.path)).toEqual([
      LOGIN_PATH,
      CHARGE_PATH,
    ]);

    expect(progressPhases()).toEqual([
      "resolving_config",
      "fetching_diff",
      "matching_pins",
      "searching_cases",
      "scoring_history",
      "merging",
    ]);
  });

  it("selects a case whose FILE pin the diff touches at score 100 in the pinned tier", async () => {
    mockFindManyPins.mockResolvedValue([
      pinRow({ id: 1, caseId: 11, kind: "FILE" }),
    ]);
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out).toMatchObject({
      caseCount: 1,
      pinnedCount: 1,
      affectedCount: 1,
      uncoveredCount: 1,
    });
    expect(mockFindManyPins).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ configId: 7, isDeleted: false }),
      })
    );
    expect(mockGetFileAtCommit).not.toHaveBeenCalled();

    const result = savedResult();
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({
      caseId: 11,
      score: 100,
      tier: "pinned",
      layers: ["PIN"],
      coveredFiles: [LOGIN_PATH],
    });
    expect(result.cases[0].reasons).toEqual([
      expect.objectContaining({
        kind: "PIN",
        pinId: 1,
        pinKind: "FILE",
        filePath: LOGIN_PATH,
        source: "MANUAL",
        confidence: "file",
      }),
    ]);
    expect(result.stalePins).toEqual([]);
    expect(result.uncoveredFiles).toEqual([CHARGE_PATH]);
    expect(result.stats.layerCounts).toEqual({
      PIN: 1,
      PATH: 0,
      HISTORY: 0,
      AI: 0,
      LINKED: 0,
    });
  });

  it("relocates a RANGE pin anchored at an older sha by fetching the file at the base sha", async () => {
    // Stale line numbers (10-12): the snippet must be located, not trusted.
    mockFindManyPins.mockResolvedValue([
      pinRow({
        id: 2,
        caseId: 11,
        kind: "RANGE",
        startLine: 10,
        endLine: 12,
        anchorSha: OLD_SHA,
        anchorSnippet: LOGIN_SNIPPET,
      }),
    ]);
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out.pinnedCount).toBe(1);
    expect(mockGetFileAtCommit).toHaveBeenCalledTimes(1);
    expect(mockGetFileAtCommit).toHaveBeenCalledWith({
      configId: 7,
      cacheEnabled: false,
      adapter,
      path: LOGIN_PATH,
      sha: BASE_SHA,
    });

    const result = savedResult();
    expect(result.stalePins).toEqual([]);
    expect(result.cases[0]).toMatchObject({ caseId: 11, tier: "pinned" });
    expect(result.cases[0].reasons[0]).toMatchObject({
      kind: "PIN",
      pinKind: "RANGE",
      confidence: "exact",
      lines: [4, 6],
      touchedRanges: [[5, 6]],
    });
  });

  it("matches a RANGE pin anchored at the base sha without fetching the file", async () => {
    mockFindManyPins.mockResolvedValue([
      pinRow({
        id: 3,
        caseId: 11,
        kind: "RANGE",
        startLine: 5,
        endLine: 6,
        anchorSha: BASE_SHA,
      }),
    ]);
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out.pinnedCount).toBe(1);
    expect(mockGetFileAtCommit).not.toHaveBeenCalled();
    const result = savedResult();
    expect(result.stalePins).toEqual([]);
    expect(result.cases[0].reasons[0]).toMatchObject({
      kind: "PIN",
      pinKind: "RANGE",
      confidence: "exact",
      lines: [5, 6],
      touchedRanges: [[5, 6]],
    });
  });

  it("reports a stale pin whose snippet is gone and still selects its case at file level", async () => {
    mockFindManyPins.mockResolvedValue([
      pinRow({
        id: 4,
        caseId: 11,
        kind: "RANGE",
        startLine: 4,
        endLine: 5,
        anchorSha: OLD_SHA,
        anchorSnippet:
          "  const nothingLikeThis = 42;\n  return nothingLikeThis;",
      }),
    ]);
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out.pinnedCount).toBe(1);
    const result = savedResult();
    expect(result.stalePins).toEqual([
      {
        pinId: 4,
        caseId: 11,
        filePath: LOGIN_PATH,
        pinKind: "RANGE",
        reason: "SNIPPET_NOT_FOUND",
      },
    ]);
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]).toMatchObject({ caseId: 11, tier: "pinned" });
    expect(result.cases[0].reasons[0]).toMatchObject({
      kind: "PIN",
      confidence: "file",
      stale: true,
      staleReason: "SNIPPET_NOT_FOUND",
    });
    expect(mockUpdateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "searching_cases",
        pinsMatched: 1,
        pinsStale: 1,
      })
    );
  });

  it("ranks LLM selections into the result with a capped score, summary, uncovered files and token stats", async () => {
    enableLlm();
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out).toMatchObject({
      caseCount: 1,
      pinnedCount: 0,
      affectedCount: 1,
      uncoveredCount: 1,
    });
    expect(out.warnings).not.toContain("llm_not_configured");

    // Small repository: every case is a candidate, none pinned.
    expect(aiCandidateQuery()).toMatchObject({
      where: {
        projectId: 1,
        isDeleted: false,
        isArchived: false,
        id: { notIn: [] },
      },
    });

    expect(mockChat).toHaveBeenCalledTimes(1);
    const [integrationId, request] = mockChat.mock.calls[0];
    expect(integrationId).toBe(100);
    expect(request).toMatchObject({
      model: "gpt-4",
      temperature: 0.2,
      maxTokens: 8000,
      userId: "user-1",
      projectId: 1,
      feature: "impact_analysis",
      metadata: expect.objectContaining({
        analysisId: ANALYSIS_ID,
        batchIndex: 0,
        candidateCount: 2,
      }),
    });
    expect(request.messages[0]).toEqual({
      role: "system",
      content: defaultResolvedPrompt.systemPrompt,
    });
    const userPrompt: string = request.messages[1].content;
    expect(userPrompt).toContain('[22,"Login with valid credentials"]');
    expect(userPrompt).toContain('[23,"Charge a saved card"]');
    expect(userPrompt).toContain(`M ${LOGIN_PATH}`);
    expect(userPrompt).toContain(`A ${CHARGE_PATH}`);
    expect(userPrompt).not.toContain("{{");

    const result = savedResult();
    expect(result.summary).toBe("s");
    expect(result.uncoveredFiles).toEqual([CHARGE_PATH]);
    expect(result.cases.map((c) => c.caseId)).toEqual([22]);
    const selected = result.cases[0];
    expect(selected.score).toBeLessThanOrEqual(95);
    expect(selected).toMatchObject({
      score: 88,
      tier: "affected",
      layers: ["AI"],
      coveredFiles: [LOGIN_PATH],
    });
    expect(selected.reasons).toEqual([
      expect.objectContaining({
        kind: "AI",
        score: 88,
        files: [LOGIN_PATH],
        batchIndex: 0,
      }),
    ]);
    expect(result.stats.aiCandidateCount).toBe(2);
    expect(result.stats.ai).toEqual({
      model: "gpt-4",
      tokens: { prompt: 500, completion: 100, total: 600 },
      batchCount: 1,
      failedBatchCount: 0,
      truncatedBatches: [],
    });
    expect(progressPhases()).toContain("waiting_for_ai");
  });

  it("splits and retries a batch whose output was cut off and warns ai_truncated", async () => {
    enableLlm();
    mockChat.mockResolvedValueOnce(
      chatResponse({
        content: "",
        finishReason: "length",
        completionTokens: 8000,
        totalTokens: 8500,
      })
    );
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(mockChat).toHaveBeenCalledTimes(3);
    expect(
      mockChat.mock.calls.map(([, request]) => request.metadata.candidateCount)
    ).toEqual([2, 1, 1]);
    expect(out.warnings).toContain("ai_truncated");
    expect(out.warnings).not.toContain("ai_partial");

    const result = savedResult();
    expect(result.warnings).toContainEqual({
      code: "ai_truncated",
      detail: { truncatedBatches: [0] },
    });
    expect(result.stats.ai).toMatchObject({
      batchCount: 1,
      failedBatchCount: 0,
      truncatedBatches: [0],
      tokens: { total: 8500 + 600 + 600 },
    });
    expect(result.cases.map((c) => c.caseId)).toEqual([22]);
  });

  it("drops excluded case ids from the final list", async () => {
    enableLlm();
    mockFindManyPins.mockResolvedValue([
      pinRow({ id: 1, caseId: 11, kind: "FILE" }),
    ]);
    const { processor } = await loadWorker();

    const out = await processor(
      makeJob({ data: { ...jobData, excludeCaseIds: [22] } })
    );

    // Pinned cases are left out of the AI candidate set and named in the prompt.
    expect(aiCandidateQuery().where.id).toEqual({ notIn: [11] });
    expect(mockChat.mock.calls[0][1].messages[1].content).toContain(
      "Already selected by Code Pins (do not re-select): [11]"
    );

    const result = savedResult();
    expect(result.cases.map((c) => c.caseId)).toEqual([11]);
    expect(out).toMatchObject({ caseCount: 1, pinnedCount: 1 });
  });

  it("marks the analysis CANCELLED and throws when the cancel flag is set before it starts", async () => {
    mockRedisGet.mockResolvedValue("1");
    const { processor } = await loadWorker();

    await expect(processor(makeJob())).rejects.toThrow("Job cancelled by user");

    expect(mockRedisGet).toHaveBeenCalledWith(CANCEL_KEY);
    expect(mockRedisDel).toHaveBeenCalledWith(CANCEL_KEY);
    expect(mockMarkFailed).toHaveBeenCalledWith(
      mockDb,
      ANALYSIS_ID,
      "CANCELLED",
      "Job cancelled by user"
    );
    expect(mockMarkRunning).not.toHaveBeenCalled();
    expect(mockLoadRepoConfig).not.toHaveBeenCalled();
    expect(mockSaveResult).not.toHaveBeenCalled();
  });

  it("stops at the next phase boundary when cancelled mid-run", async () => {
    mockRedisGet.mockResolvedValueOnce(null).mockResolvedValue("1");
    const { processor } = await loadWorker();

    await expect(processor(makeJob())).rejects.toThrow("Job cancelled by user");

    expect(mockMarkRunning).toHaveBeenCalledTimes(1);
    expect(mockLoadRepoConfig).toHaveBeenCalledTimes(1);
    expect(mockGetOrComputeCompare).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith(
      mockDb,
      ANALYSIS_ID,
      "CANCELLED",
      "Job cancelled by user"
    );
    expect(progressPhases()).toEqual(["resolving_config"]);
  });

  it("marks the analysis FAILED with the error message and rethrows when the compare fails", async () => {
    mockGetOrComputeCompare.mockRejectedValue(new Error("compare exploded"));
    const { processor } = await loadWorker();

    await expect(processor(makeJob())).rejects.toThrow("compare exploded");

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledWith(
      mockDb,
      ANALYSIS_ID,
      "FAILED",
      "compare exploded"
    );
    expect(mockSaveDiff).not.toHaveBeenCalled();
    expect(mockSaveResult).not.toHaveBeenCalled();
  });

  it("uses Elasticsearch for the PATH layer when a client is available", async () => {
    mockGetEsClient.mockReturnValue({ search: mockEsSearch });
    mockEsSearch.mockResolvedValue({
      hits: {
        hits: [{ _id: "22", _score: 12, matched_queries: ["path_name"] }],
      },
    });
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(mockEsSearch).toHaveBeenCalledTimes(1);
    expect(mockEsSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        index: "test-repository-cases",
        query: {
          bool: expect.objectContaining({
            filter: [
              { term: { projectId: 1 } },
              { term: { isArchived: false } },
              { term: { isDeleted: false } },
            ],
          }),
        },
      })
    );
    expect(out.warnings).not.toContain("search_fallback_db");

    const result = savedResult();
    expect(result.stats.searchMode).toBe("es");
    expect(result.cases.map((c) => c.caseId)).toEqual([22]);
    expect(result.cases[0].layers).toEqual(["PATH"]);
    expect(result.cases[0].score).toBeGreaterThan(0);
    expect(result.cases[0].reasons[0]).toMatchObject({
      kind: "PATH",
      matchedField: "es.name",
      rawScore: 12,
    });
  });

  it("falls back to the DB name search and warns when the Elasticsearch search throws", async () => {
    mockGetEsClient.mockReturnValue({ search: mockEsSearch });
    mockEsSearch.mockRejectedValue(new Error("es down"));
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(mockEsSearch).toHaveBeenCalledTimes(1);
    expect(out.warnings).toContain("search_fallback_db");
    expect(mockFindManyCases).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 1,
          OR: expect.arrayContaining([
            { name: { contains: "login", mode: "insensitive" } },
          ]),
        }),
      })
    );
    const result = savedResult();
    expect(result.stats.searchMode).toBe("db");
    expect(result.warnings).toContainEqual({ code: "search_fallback_db" });
  });

  it("warns that the project is not indexed when the search finds nothing there", async () => {
    // A project nobody indexed answers every query with zero hits and no
    // error, which used to look exactly like a genuine no-match.
    const mockEsCount = vi.fn().mockResolvedValue({ count: 0 });
    mockGetEsClient.mockReturnValue({
      search: mockEsSearch,
      count: mockEsCount,
    });
    mockEsSearch.mockResolvedValue({ hits: { hits: [] } });
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out.warnings).toContain("search_index_empty");
    expect(out.warnings).not.toContain("search_fallback_db");
    expect(mockFindManyCases).toHaveBeenCalled();
    const result = savedResult();
    expect(result.stats.searchMode).toBe("db");
    expect(result.warnings).toContainEqual({ code: "search_index_empty" });
  });

  it("says nothing when a healthy index simply has no match", async () => {
    // The database still gets a turn, but neither warning applies: the index
    // is reachable and populated, the query just matched nothing.
    const mockEsCount = vi.fn().mockResolvedValue({ count: 500 });
    mockGetEsClient.mockReturnValue({
      search: mockEsSearch,
      count: mockEsCount,
    });
    mockEsSearch.mockResolvedValue({ hits: { hits: [] } });
    const { processor } = await loadWorker();

    const out = await processor(makeJob());

    expect(out.warnings).not.toContain("search_index_empty");
    expect(out.warnings).not.toContain("search_fallback_db");
    expect(mockFindManyCases).toHaveBeenCalled();
  });
});
