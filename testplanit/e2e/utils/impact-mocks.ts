import type { Page, Route } from "@playwright/test";

/**
 * Route mocks for the Impact feature's provider-backed and job-backed APIs.
 *
 * Every payload mirrors the real route's response shape:
 *   - app/api/code-repositories/[id]/{branches,commits,compare,files,file}
 *   - app/api/projects/[projectId]/impact/analyses (+ [analysisId], cancel,
 *     cases)
 *   - app/api/repository-cases/[caseId]/code-pins
 * so the components parse exactly what production hands them, while no
 * request reaches a git provider and no BullMQ job has to run.
 */

export const MOCK_BASE_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const MOCK_HEAD_SHA = "f9e8d7c6b5a4a3b2c1d0e9f8a7b6c5d4e3f2a1b0";
export const MOCK_PINNED_FILE = "src/checkout/cart.ts";
export const MOCK_UNCOVERED_FILE = "src/payments/charge.ts";

/** GitRepoAdapter.RepoBranch */
export interface MockBranch {
  name: string;
  sha: string;
  isDefault: boolean;
}

/** GitRepoAdapter.RepoCommit */
export interface MockCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authoredAt: string;
  parents: string[];
}

/** GitRepoAdapter.ChangedFile */
export interface MockChangedFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
  patchTruncated?: boolean;
  isBinary: boolean;
}

/** GitRepoAdapter.RepoFileEntry */
export interface MockFileEntry {
  path: string;
  size: number;
  type: "file";
}

export type MockCaseTier = "pinned" | "affected" | "related";

/** One row of GET /impact/analyses/[analysisId] `cases` (ImpactAnalysisCase + case). */
export interface MockAnalysisCase {
  caseId: number;
  score: number;
  tier: MockCaseTier;
  layers: string[];
  reasons: Array<Record<string, unknown>>;
  coveredFiles: string[];
  case: {
    id: number;
    name: string;
    automated: boolean;
    isArchived: boolean;
    isDeleted: boolean;
    folder: { id: number; name: string } | null;
  };
}

export function mockBranches(): MockBranch[] {
  return [
    { name: "main", sha: MOCK_HEAD_SHA, isDefault: true },
    { name: "develop", sha: MOCK_BASE_SHA, isDefault: false },
  ];
}

/** Newest first, as the commits route returns them. */
export function mockCommits(): MockCommit[] {
  return [
    {
      sha: MOCK_HEAD_SHA,
      shortSha: MOCK_HEAD_SHA.slice(0, 7),
      message: "Charge cards through the new payments client",
      authorName: "E2E Author",
      authoredAt: "2026-09-02T10:00:00.000Z",
      parents: [MOCK_BASE_SHA],
    },
    {
      sha: MOCK_BASE_SHA,
      shortSha: MOCK_BASE_SHA.slice(0, 7),
      message: "Cart totals round to cents",
      authorName: "E2E Author",
      authoredAt: "2026-09-01T10:00:00.000Z",
      parents: [],
    },
  ];
}

const CART_PATCH = [
  "@@ -10,7 +10,8 @@ export function cartTotal(items: CartItem[]): number {",
  "-  return items.reduce((sum, item) => sum + item.price, 0);",
  "+  const total = items.reduce((sum, item) => sum + item.price, 0);",
  "+  return Math.round(total * 100) / 100;",
  " }",
].join("\n");

const CHARGE_PATCH = [
  "@@ -0,0 +1,3 @@",
  "+export async function charge() {",
  "+  return true;",
  "+}",
].join("\n");

export function mockChangedFiles(): MockChangedFile[] {
  return [
    {
      path: MOCK_PINNED_FILE,
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: CART_PATCH,
      isBinary: false,
    },
    {
      path: MOCK_UNCOVERED_FILE,
      status: "added",
      additions: 3,
      deletions: 0,
      patch: CHARGE_PATCH,
      isBinary: false,
    },
  ];
}

export function mockFiles(): MockFileEntry[] {
  return [
    { path: MOCK_PINNED_FILE, size: 812, type: "file" },
    { path: "src/checkout/totals.ts", size: 410, type: "file" },
    { path: MOCK_UNCOVERED_FILE, size: 1200, type: "file" },
  ];
}

/**
 * Two scored rows for real cases: the first pinned (a PIN reason), the
 * second affected (a PATH reason). Both are in the dialog's default
 * selection.
 */
export function mockAnalysisCases(
  cases: Array<{ id: number; name: string }>
): MockAnalysisCase[] {
  const [pinned, affected] = cases;
  const rows: MockAnalysisCase[] = [];
  if (pinned) {
    rows.push({
      caseId: pinned.id,
      score: 100,
      tier: "pinned",
      layers: ["PIN"],
      reasons: [
        {
          kind: "PIN",
          pinId: 1,
          filePath: MOCK_PINNED_FILE,
          pinKind: "FILE",
          source: "MANUAL",
          confidence: "file",
        },
      ],
      coveredFiles: [MOCK_PINNED_FILE],
      case: {
        id: pinned.id,
        name: pinned.name,
        automated: false,
        isArchived: false,
        isDeleted: false,
        folder: null,
      },
    });
  }
  if (affected) {
    rows.push({
      caseId: affected.id,
      score: 72,
      tier: "affected",
      layers: ["PATH"],
      reasons: [
        {
          kind: "PATH",
          term: "checkout",
          matchedField: "db.name",
          filePath: MOCK_PINNED_FILE,
          rawScore: 4.2,
        },
      ],
      coveredFiles: [MOCK_PINNED_FILE],
      case: {
        id: affected.id,
        name: affected.name,
        automated: false,
        isArchived: false,
        isDeleted: false,
        folder: null,
      },
    });
  }
  return rows;
}

export interface ImpactMockOptions {
  branches?: MockBranch[];
  /** What the branches route reports as the project config's branch. */
  configuredBranch?: string | null;
  commits?: MockCommit[];
  changedFiles?: MockChangedFile[];
  files?: MockFileEntry[];
  fileContent?: string;
  analysisId?: number;
  analysisCases?: MockAnalysisCase[];
  uncoveredFiles?: string[];
  summary?: string;
  aiAvailable?: boolean;
  /** How many detail GETs answer RUNNING before the analysis completes. */
  runningPolls?: number;
}

export interface ImpactMockCalls {
  /** Bodies of POST /impact/analyses, in order. */
  analysisPosts: Array<Record<string, unknown>>;
  /** GET /impact/analyses/[id] count. */
  analysisPolls: number;
  cancels: number;
  /** Bodies of PATCH /impact/analyses/[id]/cases, in order. */
  casePatches: Array<Record<string, unknown>>;
  /** `base..head` query pairs the compare route was asked for. */
  compares: Array<{ base: string; head: string }>;
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * Register `page.route` handlers for every Impact API the dialog, the
 * settings page and the Code Pins dialog call. Returns a recorder so specs
 * can assert on what the UI sent.
 */
export async function mockImpactApi(
  page: Page,
  opts: ImpactMockOptions = {}
): Promise<ImpactMockCalls> {
  const branches = opts.branches ?? mockBranches();
  const commits = opts.commits ?? mockCommits();
  const changedFiles = opts.changedFiles ?? mockChangedFiles();
  const files = opts.files ?? mockFiles();
  const fileContent =
    opts.fileContent ??
    "export function cartTotal(items: CartItem[]): number {\n  return 0;\n}\n";
  const analysisId = opts.analysisId ?? 4242;
  const analysisCases = opts.analysisCases ?? [];
  const uncoveredFiles = opts.uncoveredFiles ?? [MOCK_UNCOVERED_FILE];
  const summary =
    opts.summary ??
    "Cart totals and the new payments client changed; checkout coverage is affected.";
  const aiAvailable = opts.aiAvailable ?? true;
  const runningPolls = opts.runningPolls ?? 1;
  const configuredBranch =
    opts.configuredBranch === undefined ? "main" : opts.configuredBranch;

  const calls: ImpactMockCalls = {
    analysisPosts: [],
    analysisPolls: 0,
    cancels: 0,
    casePatches: [],
    compares: [],
  };

  const defaultBranch = branches.find((b) => b.isDefault)?.name ?? null;

  const resolveRef = (ref: string): string | null => {
    const branch = branches.find((b) => b.name === ref);
    if (branch) return branch.sha;
    if (SHA_PATTERN.test(ref)) {
      const commit = commits.find((c) =>
        c.sha.toLowerCase().startsWith(ref.toLowerCase())
      );
      return commit ? commit.sha : null;
    }
    return null;
  };

  // GET /api/code-repositories/[id]/branches?configId=
  await page.route(/\/api\/code-repositories\/\d+\/branches(?:\?|$)/, (route) =>
    fulfillJson(route, { branches, defaultBranch, configuredBranch })
  );

  // GET /api/code-repositories/[id]/commits?configId=&ref=&page=&perPage=
  await page.route(
    /\/api\/code-repositories\/\d+\/commits(?:\?|$)/,
    (route) => {
      const url = new URL(route.request().url());
      const ref = url.searchParams.get("ref") ?? defaultBranch ?? "";
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("perPage") ?? "30");
      let list = commits;
      if (SHA_PATTERN.test(ref) && !branches.some((b) => b.name === ref)) {
        list = commits.filter((c) =>
          c.sha.toLowerCase().startsWith(ref.toLowerCase())
        );
        if (list.length === 0) {
          return fulfillJson(route, { error: "Ref not found" }, 404);
        }
      }
      return fulfillJson(route, {
        ref,
        page: pageNumber,
        perPage,
        commits: pageNumber === 1 ? list.slice(0, perPage) : [],
        hasMore: false,
      });
    }
  );

  // GET /api/code-repositories/[id]/compare?configId=&base=&head=
  await page.route(
    /\/api\/code-repositories\/\d+\/compare(?:\?|$)/,
    (route) => {
      const url = new URL(route.request().url());
      const base = url.searchParams.get("base") ?? "";
      const head = url.searchParams.get("head") ?? "";
      calls.compares.push({ base, head });
      const baseSha = resolveRef(base);
      const headSha = resolveRef(head);
      if (!baseSha || !headSha) {
        return fulfillJson(route, { error: "Ref not found" }, 404);
      }
      if (baseSha === headSha) {
        return fulfillJson(
          route,
          { error: "Base and head resolve to the same commit" },
          400
        );
      }
      return fulfillJson(route, {
        baseSha,
        headSha,
        files: changedFiles,
        commits: commits.filter((c) => c.sha === headSha),
        truncated: false,
        totalFiles: changedFiles.length,
        aheadBy: 1,
        behindBy: 0,
        baseRef: base,
        headRef: head,
        cached: false,
      });
    }
  );

  // GET /api/code-repositories/[id]/files?configId=
  await page.route(/\/api\/code-repositories\/\d+\/files(?:\?|$)/, (route) =>
    fulfillJson(route, {
      files,
      meta: {
        fetchedAt: "2026-09-03T08:00:00.000Z",
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        status: "success",
      },
      truncated: false,
      source: "cache",
    })
  );

  // GET /api/code-repositories/[id]/file?configId=&path=&ref=
  await page.route(/\/api\/code-repositories\/\d+\/file(?:\?|$)/, (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    const ref = url.searchParams.get("ref") ?? defaultBranch ?? "main";
    return fulfillJson(route, {
      path,
      ref,
      sha: resolveRef(ref) ?? MOCK_HEAD_SHA,
      content: fileContent,
      cached: true,
    });
  });

  const runningPayload = () => ({
    analysis: {
      id: analysisId,
      status: "RUNNING",
      error: null,
      baseSha: MOCK_BASE_SHA,
      headSha: MOCK_HEAD_SHA,
      fileCount: 0,
      additions: 0,
      deletions: 0,
      truncated: false,
      affectedCaseCount: 0,
      pinnedCaseCount: 0,
      result: null,
    },
    cases: [],
    progress: { phase: "matching_pins", message: "matching_pins" },
    jobState: "active",
  });

  const completedPayload = () => {
    const additions = changedFiles.reduce((sum, f) => sum + f.additions, 0);
    const deletions = changedFiles.reduce((sum, f) => sum + f.deletions, 0);
    const pinnedCount = analysisCases.filter(
      (row) => row.tier === "pinned"
    ).length;
    const affectedCount = analysisCases.filter(
      (row) => row.tier === "pinned" || row.tier === "affected"
    ).length;
    return {
      analysis: {
        id: analysisId,
        status: "COMPLETED",
        error: null,
        baseSha: MOCK_BASE_SHA,
        headSha: MOCK_HEAD_SHA,
        fileCount: changedFiles.length,
        additions,
        deletions,
        truncated: false,
        affectedCaseCount: affectedCount,
        pinnedCaseCount: pinnedCount,
        result: {
          summary,
          stalePins: [],
          uncoveredFiles,
          warnings: [],
          stats: {
            repositoryTotalCount: analysisCases.length,
            candidateCount: analysisCases.length,
            aiCandidateCount: 0,
            layerCounts: {
              PIN: pinnedCount,
              PATH: affectedCount - pinnedCount,
              HISTORY: 0,
              AI: 0,
              LINKED: 0,
            },
            searchMode: "db",
            ai: {
              model: "mock",
              tokens: { prompt: 100, completion: 23, total: 123 },
              batchCount: 1,
              failedBatchCount: 0,
              truncatedBatches: [],
            },
            durationsMs: {},
          },
        },
      },
      cases: analysisCases,
      progress: null,
      jobState: "completed",
    };
  };

  // POST /api/projects/[projectId]/impact/analyses -> 202
  // GET  /api/projects/[projectId]/impact/analyses?take= -> previous analyses
  await page.route(
    /\/api\/projects\/\d+\/impact\/analyses(?:\?|$)/,
    (route) => {
      const method = route.request().method();
      if (method === "POST") {
        let body: Record<string, unknown> = {};
        try {
          body = route.request().postDataJSON() as Record<string, unknown>;
        } catch {
          body = {};
        }
        calls.analysisPosts.push(body);
        return fulfillJson(
          route,
          {
            analysisId,
            jobId: `impact:${analysisId}`,
            reused: false,
            aiAvailable,
          },
          202
        );
      }
      if (method === "GET") {
        return fulfillJson(route, { analyses: [], nextCursor: null });
      }
      return route.fallback();
    }
  );

  // GET /api/projects/[projectId]/impact/analyses/[analysisId]
  await page.route(
    /\/api\/projects\/\d+\/impact\/analyses\/\d+(?:\?|$)/,
    (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      calls.analysisPolls += 1;
      return fulfillJson(
        route,
        calls.analysisPolls <= runningPolls
          ? runningPayload()
          : completedPayload()
      );
    }
  );

  // POST /api/projects/[projectId]/impact/analyses/[analysisId]/cancel
  await page.route(
    /\/api\/projects\/\d+\/impact\/analyses\/\d+\/cancel(?:\?|$)/,
    (route) => {
      calls.cancels += 1;
      return fulfillJson(route, { message: "Analysis cancelled" });
    }
  );

  // PATCH /api/projects/[projectId]/impact/analyses/[analysisId]/cases
  await page.route(
    /\/api\/projects\/\d+\/impact\/analyses\/\d+\/cases(?:\?|$)/,
    (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      let body: Record<string, unknown> = {};
      try {
        body = route.request().postDataJSON() as Record<string, unknown>;
      } catch {
        body = {};
      }
      calls.casePatches.push(body);
      const accepted = Array.isArray(body.acceptedCaseIds)
        ? body.acceptedCaseIds.length
        : 0;
      const added = Array.isArray(body.addedCaseIds)
        ? body.addedCaseIds.length
        : 0;
      return fulfillJson(route, {
        accepted,
        rejected: 0,
        added,
        testRunId: typeof body.testRunId === "number" ? body.testRunId : null,
      });
    }
  );

  return calls;
}

/** POST /api/repository-cases/[caseId]/code-pins request body. */
export interface CodePinCreateBody {
  configId: number;
  kind: "FILE" | "RANGE" | "SYMBOL" | "GLOB";
  filePath: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  note?: string;
  ref?: string;
}

/** The persisted pin row the create mock answers with (e.g. CodePinRow). */
export interface PersistedCodePin {
  id: number;
  createdById?: string;
}

export interface CodePinsMockOptions {
  /**
   * Persist the dialog's create request without the route's provider
   * anchoring (e.g. `api.createCodePin`). The returned row becomes the 201
   * body, so it must carry the pin's `id`.
   */
  persist: (
    caseId: number,
    body: CodePinCreateBody
  ) => Promise<PersistedCodePin>;
}

export interface CodePinsMockCalls {
  creates: Array<{ caseId: number; body: CodePinCreateBody }>;
  /** Rows `persist` returned, in creation order. */
  created: PersistedCodePin[];
}

/**
 * Keep the Code Pins REST API provider-free:
 *   - POST create is intercepted, persisted through `persist`, and answered
 *     201 `{ pin }` exactly as the route would (minus the anchor).
 *   - GET list continues to the real route with `?staleness=0`, which skips
 *     the branch-tip staleness check (the only provider call on that path)
 *     and returns the live rows.
 *   - DELETE is left alone: the real route never talks to the provider.
 */
export async function mockCodePinsApi(
  page: Page,
  { persist }: CodePinsMockOptions
): Promise<CodePinsMockCalls> {
  const calls: CodePinsMockCalls = { creates: [], created: [] };

  await page.route(
    /\/api\/repository-cases\/\d+\/code-pins(?:\?|$)/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const caseId = Number(
        url.pathname.match(/repository-cases\/(\d+)\//)?.[1]
      );

      if (request.method() === "POST") {
        const body = request.postDataJSON() as CodePinCreateBody;
        calls.creates.push({ caseId, body });
        const row = await persist(caseId, body);
        calls.created.push(row);
        return fulfillJson(
          route,
          {
            pin: {
              anchorSha: null,
              anchorSnippet: null,
              staleDismissedAt: null,
              ...row,
              createdBy: {
                id: String(row.createdById ?? ""),
                name: null,
              },
              staleness: null,
            },
          },
          201
        );
      }

      if (request.method() === "GET" && !url.searchParams.has("staleness")) {
        url.searchParams.set("staleness", "0");
        return route.continue({ url: url.toString() });
      }

      return route.fallback();
    }
  );

  return calls;
}
