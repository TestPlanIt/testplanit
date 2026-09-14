import type { RepoCommit } from "~/lib/integrations/adapters/GitRepoAdapter";
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
/** Progress is reported after this many commit file lists were read. */
const PROGRESS_EVERY = 25;
const BATCH_SIZE = 200;
const MAX_KEYS_IN_NOTE = 3;

interface ExistingPinRow {
  id: number;
  caseId: number;
  filePath: string;
  kind: string;
  symbol: string | null;
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

export interface IssueImportFailure {
  key: string;
  error: string;
}

export interface IssueImportResult {
  /** Tickets materialized from the tracker this run. */
  imported: number;
  /** Keys the tracker refused or could not find. */
  failed: number;
  /** Keys not attempted this scan because the lookup cap was reached. */
  skipped?: number;
  /** Keys the tracker knows under a different current key already held here. */
  moved?: number;
  /** Why each failed key failed, capped at MAX_IMPORT_FAILURE_DETAILS. */
  failures?: IssueImportFailure[];
}

export type IssueScanStage = "walk" | "import" | "inspect";

export interface IssueScanProgress {
  stage: IssueScanStage;
  scannedCommits: number;
  /** How many of those were served by the commit cache. */
  cachedCommits: number;
  matchedCommits: number;
  /** Matched commits whose file lists have been read so far. */
  fetchedCommits: number;
  /** Tracker lookups made so far for tickets the project did not hold. */
  importLookups: number;
  importedIssues: number;
}

export interface IssueImportProgress {
  lookups: number;
  imported: number;
}

export interface IssueScanOptions {
  /** Newest first. */
  commits: RepoCommit[];
  /**
   * True when the commit walk was cut short. Pins anchored at commits the
   * walk never reached are then left alone.
   */
  truncated: boolean;
  /** How many of `commits` came from the commit cache, for the report. */
  cachedCommits?: number;
  /**
   * A full-history scan walked the branch from its tip; when it was not cut
   * short, every ISSUE pin it did not re-derive is removed, including pins
   * whose commit is no longer on the branch.
   */
  full?: boolean;
  getCommitFiles: (commit: RepoCommit) => Promise<CommitFiles | null>;
  maxCommitFetches: number;
  maxFilesPerCommit: number;
  /** User recorded as creator of new pins. */
  actorId: string;
  /**
   * Import tickets the commits name that TestPlanIt does not hold yet. Runs
   * once with every distinct token before issues are resolved, so a ticket
   * imported here still selects nothing until a case is linked to it.
   */
  importIssues?: (
    tokens: IssueToken[],
    onProgress: (progress: IssueImportProgress) => Promise<void>
  ) => Promise<IssueImportResult>;
  /** Called as matched commits' file lists are read, every few commits. */
  onProgress?: (progress: IssueScanProgress) => Promise<void> | void;
  /**
   * Pin the declarations a commit's patch touched (SYMBOL pins) instead of
   * the whole file, falling back to a whole-file pin where the patch names
   * none. Needs `getCommitFiles` to supply `symbolsByPath`.
   */
  symbolPins?: boolean;
}

export interface IssueScanReport {
  scannedCommits: number;
  /** Commits the cache answered for; the rest came from the provider. */
  cachedCommits: number;
  /** Commits whose message named any ticket key at all. */
  commitsNamingTickets: number;
  /** Distinct ticket keys those commits named. */
  namedTickets: number;
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
  /** The scan walked the whole branch rather than the recent window. */
  full: boolean;
  /** Tickets named in commits that were imported from the tracker. */
  importedIssues: number;
  /** Named tickets the tracker refused or could not find. */
  importFailures: number;
  /** Named tickets not attempted this scan because of the lookup cap. */
  importSkipped: number;
  /** Named tickets that were moved or renamed in the tracker; held under the new key. */
  importMoved: number;
  /** Of `created`, how many pin a symbol rather than a whole file. */
  createdSymbolPins: number;
  /** Which keys failed and why, capped so the report stays small. */
  importFailureDetails: IssueImportFailure[];
  scannedAt: string;
}

export const MAX_IMPORT_FAILURE_DETAILS = 25;

export { IssueScanCancelledError } from "./issueScanCancel";

interface DesiredPin {
  caseId: number;
  filePath: string;
  /** A declaration the commit's patch touched, or null for the whole file. */
  symbol: string | null;
  anchorSha: string;
  note: string;
}

/** Identity of a derived pin: case, file, and (for symbol pins) the symbol. */
function pinKey(pin: {
  caseId: number;
  filePath: string;
  symbol?: string | null;
}): string {
  return `${pin.caseId}|${pin.filePath}|${pin.symbol ?? ""}`;
}

/** Identity of the file a pin covers, whatever its kind. */
function fileKey(pin: { caseId: number; filePath: string }): string {
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
 * the user removed is not recreated for the same commit. With `symbolPins`
 * a file is pinned by the declarations the commit's patch touched, so a
 * thousand-line file only selects its cases when that block changes again;
 * a patch naming no declaration pins the whole file. An ISSUE pin whose
 * commit the walk reached but no longer yields it (the ticket was unlinked,
 * the case archived) is removed; a pin anchored at a commit older than the
 * walk is kept, so a full-history backfill survives the recent-window scans
 * that follow it. Only an uncut full scan removes pins whose commit it never
 * met.
 */
export async function syncIssuePins(
  db: IssueScanDb,
  config: IssueScanConfig,
  opts: IssueScanOptions
): Promise<IssueScanReport> {
  const scannedAt = new Date().toISOString();
  const report: IssueScanReport = {
    scannedCommits: opts.commits.length,
    cachedCommits: opts.cachedCommits ?? 0,
    commitsNamingTickets: 0,
    namedTickets: 0,
    matchedCommits: 0,
    skippedLargeCommits: 0,
    issues: 0,
    created: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    fetchCapped: false,
    truncated: opts.truncated,
    full: opts.full === true,
    importedIssues: 0,
    importFailures: 0,
    importSkipped: 0,
    importMoved: 0,
    createdSymbolPins: 0,
    importFailureDetails: [],
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

  report.commitsNamingTickets = tokensByCommit.filter(
    (tokens) => tokens.length > 0
  ).length;
  report.namedTickets = allTokens.size;

  const importProgress: IssueImportProgress = { lookups: 0, imported: 0 };
  let matchedCount = 0;
  let fetched = 0;
  const progress = async (stage: IssueScanStage) => {
    if (!opts.onProgress) return;
    await opts.onProgress({
      stage,
      scannedCommits: opts.commits.length,
      cachedCommits: opts.cachedCommits ?? 0,
      matchedCommits: matchedCount,
      fetchedCommits: fetched,
      importLookups: importProgress.lookups,
      importedIssues: importProgress.imported,
    });
  };

  if (opts.importIssues && allTokens.size > 0) {
    await progress("import");
    const imported = await opts.importIssues(
      [...allTokens.values()],
      async (update) => {
        importProgress.lookups = update.lookups;
        importProgress.imported = update.imported;
        await progress("import");
      }
    );
    report.importedIssues = imported.imported;
    report.importFailures = imported.failed;
    report.importSkipped = imported.skipped ?? 0;
    report.importMoved = imported.moved ?? 0;
    report.importFailureDetails = (imported.failures ?? []).slice(
      0,
      MAX_IMPORT_FAILURE_DETAILS
    );
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
  // (case, file) pairs a newer commit already pinned, whole or by symbol.
  const settledFiles = new Set<string>();
  // Matched commits whose files were never read: their pins cannot be judged.
  const unfetched = new Set<string>();
  matchedCount = matched.length;
  await progress("inspect");
  for (const { commit, issues } of matched) {
    if (fetched >= opts.maxCommitFetches) {
      report.fetchCapped = true;
      unfetched.add(commit.sha);
      continue;
    }
    fetched++;
    if (fetched % PROGRESS_EVERY === 0) await progress("inspect");
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
    // The newest commit that touched a file decides how it is pinned: by the
    // declarations its patch named, or as a whole when it named none.
    const claimedFiles = new Set<string>();
    for (const caseId of caseIds) {
      for (const filePath of pinnable) {
        const file = fileKey({ caseId, filePath });
        if (claimedFiles.has(file) || settledFiles.has(file)) continue;
        const symbols =
          opts.symbolPins === true
            ? (files.symbolsByPath?.[filePath] ?? [])
            : [];
        const targets: Array<string | null> =
          symbols.length > 0 ? symbols : [null];
        let claimed = false;
        for (const symbol of targets) {
          const pin = { caseId, filePath, symbol, anchorSha: commit.sha, note };
          const key = pinKey(pin);
          if (desired.has(key)) {
            claimed = true;
            continue;
          }
          desired.set(key, pin);
          claimed = true;
        }
        if (claimed) claimedFiles.add(file);
      }
    }
    // Files this commit claimed are settled for every case it named; an
    // older commit must not add its own pins for them.
    for (const file of claimedFiles) settledFiles.add(file);
  }

  const existing = await db.repositoryCaseCodePin.findMany({
    where: {
      configId: config.id,
      kind: { in: ["FILE", "SYMBOL"] },
      OR: [{ isDeleted: false }, { source: "ISSUE" }],
    },
    select: {
      id: true,
      caseId: true,
      filePath: true,
      kind: true,
      symbol: true,
      source: true,
      anchorSha: true,
      note: true,
      isDeleted: true,
    },
  });
  const activeByKey = new Map<string, ExistingPinRow>();
  // A live pin of the user's own on a file (any kind) outranks every derived
  // pin on that file.
  const userPinnedFiles = new Set<string>();
  const dismissedAnchors = new Map<string, Set<string>>();
  for (const row of existing) {
    if (row.isDeleted) {
      if (row.source === "ISSUE" && row.anchorSha) {
        const key = pinKey(row);
        let set = dismissedAnchors.get(key);
        if (!set) {
          set = new Set();
          dismissedAnchors.set(key, set);
        }
        set.add(row.anchorSha);
      }
      continue;
    }
    if (row.source !== "ISSUE") {
      userPinnedFiles.add(fileKey(row));
      continue;
    }
    activeByKey.set(pinKey(row), row);
  }

  const toCreate: DesiredPin[] = [];
  const kept = new Set<number>();
  for (const [key, pin] of desired) {
    if (userPinnedFiles.has(fileKey(pin))) continue;
    const row = activeByKey.get(key);
    if (row) {
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
        kind: pin.symbol === null ? "FILE" : "SYMBOL",
        filePath: pin.filePath,
        symbol: pin.symbol,
        anchorSha: pin.anchorSha,
        source: "ISSUE",
        note: pin.note,
        createdById: opts.actorId,
      })),
    });
  }
  report.created = toCreate.length;
  report.createdSymbolPins = toCreate.filter(
    (pin) => pin.symbol !== null
  ).length;

  const walked = new Set(opts.commits.map((commit) => commit.sha));
  const removeUnmet = opts.full === true && !opts.truncated;
  const removable = (row: ExistingPinRow): boolean => {
    if (row.anchorSha && walked.has(row.anchorSha)) {
      return !unfetched.has(row.anchorSha);
    }
    return removeUnmet;
  };
  const stale = existing
    .filter(
      (row) =>
        !row.isDeleted &&
        row.source === "ISSUE" &&
        !kept.has(row.id) &&
        removable(row)
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

  return report;
}
