import type { RepoCommit } from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  extractIssueTokens,
  resolveLinkedIssues,
  type IssueLookupDb,
  type IssueToken,
  type LinkedIssue,
} from "../issueKeys";
import { ISSUE_SCORE } from "../scoring";
import type { IssueReason, LayerResult } from "../types";

export interface IssueLayerInput {
  projectId: number;
  /** Commits of the analyzed range, as the compare returned them. */
  commits: RepoCommit[];
  /** Every changed path of the range. */
  changedPaths: string[];
  caseFilter?: Record<string, unknown>;
  /** Commits whose own file list may be fetched; the rest carry no files. */
  maxCommitFetches: number;
  /** Paths one commit touched, or null when they cannot be read. */
  getCommitFiles: (commit: RepoCommit) => Promise<string[] | null>;
}

export interface IssueLayerOutput {
  layer: LayerResult;
  issueCount: number;
  matchedCommitCount: number;
  fetchCapped: boolean;
}

/** Commits per reason kept for the detail line; the count is what matters. */
const MAX_COMMITS_PER_REASON = 10;

function tokenId(token: IssueToken): string {
  return token.exact[0];
}

/**
 * Layer 1: a commit in the range names a ticket, and cases are linked to that
 * ticket. The change says what it is for; those cases are what to run. Files
 * come from the commit itself so a case selected this way covers the paths
 * its ticket's commits touched, not the whole range.
 */
export async function runIssueLayer(
  db: IssueLookupDb,
  input: IssueLayerInput
): Promise<IssueLayerOutput> {
  const layer: LayerResult = new Map();
  const empty: IssueLayerOutput = {
    layer,
    issueCount: 0,
    matchedCommitCount: 0,
    fetchCapped: false,
  };
  if (input.commits.length === 0) return empty;

  const tokensByCommit = input.commits.map((commit) =>
    extractIssueTokens(commit.message)
  );
  const allTokens = new Map<string, IssueToken>();
  for (const tokens of tokensByCommit) {
    for (const token of tokens) {
      if (!allTokens.has(tokenId(token))) allTokens.set(tokenId(token), token);
    }
  }
  if (allTokens.size === 0) return empty;

  const resolved = await resolveLinkedIssues(db, {
    projectId: input.projectId,
    tokens: [...allTokens.values()],
    caseFilter: input.caseFilter,
  });
  if (resolved.issues.size === 0) return empty;

  const matched: Array<{ commit: RepoCommit; issues: LinkedIssue[] }> = [];
  input.commits.forEach((commit, index) => {
    const issues = new Map<number, LinkedIssue>();
    for (const token of tokensByCommit[index]) {
      for (const issue of resolved.forToken(token)) issues.set(issue.id, issue);
    }
    if (issues.size > 0) matched.push({ commit, issues: [...issues.values()] });
  });
  if (matched.length === 0) return empty;

  const changedSet = new Set(input.changedPaths);
  const filesByCommit = new Map<string, string[]>();
  let fetched = 0;
  let fetchCapped = false;
  for (const { commit } of matched) {
    if (input.commits.length === 1) {
      // The range is this one commit, so its files are the whole diff.
      filesByCommit.set(commit.sha, [...input.changedPaths]);
      continue;
    }
    if (fetched >= input.maxCommitFetches) {
      fetchCapped = true;
      continue;
    }
    fetched++;
    const files = await input.getCommitFiles(commit);
    if (files) {
      filesByCommit.set(
        commit.sha,
        files.filter((path) => changedSet.has(path))
      );
    }
  }

  const reasonsByCase = new Map<number, Map<number, IssueReason>>();
  const seenIssues = new Set<number>();
  for (const { commit, issues } of matched) {
    const files = filesByCommit.get(commit.sha);
    for (const issue of issues) {
      seenIssues.add(issue.id);
      for (const caseId of issue.caseIds) {
        let byIssue = reasonsByCase.get(caseId);
        if (!byIssue) {
          byIssue = new Map();
          reasonsByCase.set(caseId, byIssue);
        }
        let reason = byIssue.get(issue.id);
        if (!reason) {
          reason = {
            kind: "ISSUE",
            issueId: issue.id,
            issueKey: issue.key,
            commits: [],
          };
          byIssue.set(issue.id, reason);
        }
        if (reason.commits.length < MAX_COMMITS_PER_REASON) {
          reason.commits.push({ sha: commit.sha, shortSha: commit.shortSha });
        }
        if (files) {
          const merged = new Set([...(reason.files ?? []), ...files]);
          reason.files = [...merged].sort();
        }
      }
    }
  }

  for (const [caseId, byIssue] of reasonsByCase) {
    layer.set(caseId, {
      caseId,
      score: ISSUE_SCORE,
      reasons: [...byIssue.values()],
    });
  }

  return {
    layer,
    issueCount: seenIssues.size,
    matchedCommitCount: matched.length,
    fetchCapped,
  };
}
