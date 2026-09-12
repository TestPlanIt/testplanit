import type {
  ListCommitsResult,
  RepoCommit,
} from "~/lib/integrations/adapters/GitRepoAdapter";
import { looksBinaryPath } from "~/lib/integrations/diff/localDiff";
import type { CommitFiles } from "./commitFiles";
import { classifyPath } from "./diffSummary";
import {
  extractIssueTokens,
  resolveLinkedIssues,
  type IssueLookupDb,
  type IssueToken,
  type LinkedIssue,
} from "./issueKeys";
import type { DiffFileClass } from "./types";

/** Only application code and its configuration make a useful FILE pin. */
const PINNABLE_CLASSES: ReadonlySet<DiffFileClass> = new Set<DiffFileClass>([
  "source",
  "config",
]);
const COMMITS_PER_PAGE = 100;
const BATCH_SIZE = 200;
const MAX_KEYS_IN_NOTE = 3;

export interface RecentCommitsSource {
  listCommits(
    ref: string,
    opts: { page: number; perPage: number }
  ): Promise<ListCommitsResult>;
}

export interface RecentCommitsOptions {
  lookbackDays: number;
  maxCommits: number;
  now?: Date;
}

export interface RecentCommits {
  /** Newest first. */
  commits: RepoCommit[];
  /** True when the commit cap stopped the walk before the lookback did. */
  truncated: boolean;
}

/**
 * Commits on `ref` newer than the lookback, newest first, capped. A commit
 * with no usable date is kept: the cap still bounds the walk.
 */
export async function listRecentCommits(
  source: RecentCommitsSource,
  ref: string,
  opts: RecentCommitsOptions
): Promise<RecentCommits> {
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - opts.lookbackDays * 24 * 60 * 60 * 1000;
  const commits: RepoCommit[] = [];
  let truncated = false;

  for (let page = 1; ; page++) {
    const result = await source.listCommits(ref, {
      page,
      perPage: COMMITS_PER_PAGE,
    });
    let reachedCutoff = false;
    for (const commit of result.commits) {
      const at = Date.parse(commit.authoredAt);
      if (Number.isFinite(at) && at < cutoff) {
        reachedCutoff = true;
        break;
      }
      if (commits.length >= opts.maxCommits) {
        truncated = true;
        break;
      }
      commits.push(commit);
    }
    if (
      reachedCutoff ||
      truncated ||
      !result.hasMore ||
      result.commits.length === 0
    ) {
      break;
    }
  }
  return { commits, truncated };
}

interface ExistingPinRow {
  id: number;
  caseId: number;
  filePath: string;
  source: string;
  anchorSha: string | null;
  note: string | null;
  isDeleted: boolean;
}

export interface IssueScanDb extends IssueLookupDb {
  repositoryCaseCodePin: {
    findMany(args: unknown): Promise<ExistingPinRow[]>;
    createMany(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface IssueScanConfig {
  id: number;
  projectId: number;
}

export interface IssueScanOptions {
  /** Newest first. */
  commits: RepoCommit[];
  /** True when the commit walk was cut short; existing pins are then kept. */
  truncated: boolean;
  getCommitFiles: (commit: RepoCommit) => Promise<CommitFiles | null>;
  maxCommitFetches: number;
  maxFilesPerCommit: number;
  /** User recorded as creator of new pins. */
  actorId: string;
}

export interface IssueScanReport {
  scannedCommits: number;
  /** Commits that named at least one ticket with linked cases. */
  matchedCommits: number;
  /** Matched commits skipped as noise: too many files, or a capped list. */
  skippedLargeCommits: number;
  issues: number;
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Matched commits past the fetch cap; their files were not read. */
  fetchCapped: boolean;
  truncated: boolean;
  scannedAt: string;
}

interface DesiredPin {
  caseId: number;
  filePath: string;
  anchorSha: string;
  note: string;
}

function pinKey(pin: { caseId: number; filePath: string }): string {
  return `${pin.caseId}|${pin.filePath}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function tokenId(token: IssueToken): string {
  return token.exact[0];
}

/**
 * Derive whole-file ISSUE pins from recent commits: a commit that names a
 * ticket pins every source file it touched to every case linked to that
 * ticket, anchored at that commit. Pins from other sources are never touched,
 * an active pin of another source on the same file wins, and a derived pin
 * the user removed is not recreated for the same commit. ISSUE pins whose
 * commit has left the window are removed, unless the walk was cut short.
 */
export async function syncIssuePins(
  db: IssueScanDb,
  config: IssueScanConfig,
  opts: IssueScanOptions
): Promise<IssueScanReport> {
  const scannedAt = new Date().toISOString();
  const report: IssueScanReport = {
    scannedCommits: opts.commits.length,
    matchedCommits: 0,
    skippedLargeCommits: 0,
    issues: 0,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    fetchCapped: false,
    truncated: opts.truncated,
    scannedAt,
  };

  const tokensByCommit = opts.commits.map((commit) =>
    extractIssueTokens(commit.message)
  );
  const allTokens = new Map<string, IssueToken>();
  for (const tokens of tokensByCommit) {
    for (const token of tokens) {
      if (!allTokens.has(tokenId(token))) allTokens.set(tokenId(token), token);
    }
  }

  const resolved =
    allTokens.size > 0
      ? await resolveLinkedIssues(db, {
          projectId: config.projectId,
          tokens: [...allTokens.values()],
          caseFilter: { isArchived: false },
        })
      : null;

  const matched: Array<{ commit: RepoCommit; issues: LinkedIssue[] }> = [];
  if (resolved && resolved.issues.size > 0) {
    opts.commits.forEach((commit, index) => {
      const issues = new Map<number, LinkedIssue>();
      for (const token of tokensByCommit[index]) {
        for (const issue of resolved.forToken(token)) {
          issues.set(issue.id, issue);
        }
      }
      if (issues.size > 0) {
        matched.push({ commit, issues: [...issues.values()] });
      }
    });
  }
  report.matchedCommits = matched.length;
  report.issues = new Set(
    matched.flatMap((m) => m.issues.map((i) => i.id))
  ).size;

  // Newest commit first, so the first claim on a (case, file) is the latest.
  const desired = new Map<string, DesiredPin>();
  let fetched = 0;
  for (const { commit, issues } of matched) {
    if (fetched >= opts.maxCommitFetches) {
      report.fetchCapped = true;
      break;
    }
    fetched++;
    const files = await opts.getCommitFiles(commit);
    if (!files) continue;
    if (files.capped || files.paths.length > opts.maxFilesPerCommit) {
      report.skippedLargeCommits++;
      continue;
    }
    const pinnable = files.paths.filter((path) =>
      PINNABLE_CLASSES.has(classifyPath(path, looksBinaryPath(path)))
    );
    if (pinnable.length === 0) continue;
    const note = issues
      .map((issue) => issue.key)
      .slice(0, MAX_KEYS_IN_NOTE)
      .join(", ");
    const caseIds = new Set(issues.flatMap((issue) => issue.caseIds));
    for (const caseId of caseIds) {
      for (const filePath of pinnable) {
        const pin = { caseId, filePath, anchorSha: commit.sha, note };
        const key = pinKey(pin);
        if (!desired.has(key)) desired.set(key, pin);
      }
    }
  }

  const existing = await db.repositoryCaseCodePin.findMany({
    where: {
      configId: config.id,
      kind: "FILE",
      OR: [{ isDeleted: false }, { source: "ISSUE" }],
    },
    select: {
      id: true,
      caseId: true,
      filePath: true,
      source: true,
      anchorSha: true,
      note: true,
      isDeleted: true,
    },
  });
  const activeByKey = new Map<string, ExistingPinRow>();
  const dismissedAnchors = new Map<string, Set<string>>();
  for (const row of existing) {
    const key = pinKey(row);
    if (row.isDeleted) {
      if (row.source === "ISSUE" && row.anchorSha) {
        let set = dismissedAnchors.get(key);
        if (!set) {
          set = new Set();
          dismissedAnchors.set(key, set);
        }
        set.add(row.anchorSha);
      }
      continue;
    }
    // Prefer a pin of another source when both exist: it is the user's own.
    const current = activeByKey.get(key);
    if (!current || (current.source === "ISSUE" && row.source !== "ISSUE")) {
      activeByKey.set(key, row);
    }
  }

  const toCreate: DesiredPin[] = [];
  const kept = new Set<number>();
  for (const [key, pin] of desired) {
    const row = activeByKey.get(key);
    if (row) {
      if (row.source !== "ISSUE") continue;
      kept.add(row.id);
      if (row.anchorSha !== pin.anchorSha || row.note !== pin.note) {
        await db.repositoryCaseCodePin.update({
          where: { id: row.id },
          data: { anchorSha: pin.anchorSha, note: pin.note },
        });
        report.updated++;
      } else {
        report.unchanged++;
      }
      continue;
    }
    if (dismissedAnchors.get(key)?.has(pin.anchorSha)) continue;
    toCreate.push(pin);
  }

  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    await db.repositoryCaseCodePin.createMany({
      data: batch.map((pin) => ({
        caseId: pin.caseId,
        configId: config.id,
        kind: "FILE",
        filePath: pin.filePath,
        anchorSha: pin.anchorSha,
        source: "ISSUE",
        note: pin.note,
        createdById: opts.actorId,
      })),
    });
  }
  report.created = toCreate.length;

  if (!opts.truncated && !report.fetchCapped) {
    const stale = existing
      .filter(
        (row) => !row.isDeleted && row.source === "ISSUE" && !kept.has(row.id)
      )
      .map((row) => row.id);
    const deletedAt = new Date();
    for (const batch of chunk(stale, BATCH_SIZE)) {
      await db.repositoryCaseCodePin.updateMany({
        where: { id: { in: batch } },
        data: { isDeleted: true, deletedAt },
      });
    }
    report.removed = stale.length;
  }

  return report;
}
