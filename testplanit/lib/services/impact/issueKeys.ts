/**
 * Ticket keys named in commit messages, and the tracker issues they resolve
 * to. Nothing here is tracker-specific: a token is matched against the keys
 * already stored on issues linked to the project's cases, so a false hit
 * needs a real issue with that exact key.
 */

export interface IssueToken {
  /** Text as it appeared in the message, used for reporting only. */
  raw: string;
  /** Exact `externalKey` spellings this token may correspond to. */
  exact: string[];
  /** The bare number, for trackers that key issues by number. */
  number?: string;
}

/** PROJ-123 (Jira and look-alikes). Matched case-insensitively, stored upper. */
const PROJECT_KEY_RE = /\b([A-Za-z][A-Za-z0-9_]{1,9}-\d{1,7})\b/g;
/** owner/repo#12 (GitHub, Gitea) and group/project#12 (GitLab). */
const SCOPED_NUMBER_RE = /(?<![\w/])((?:[\w.-]+\/)+[\w.-]+)#(\d{1,9})\b/g;
/** #12 on its own, or AB#12 (Azure DevOps). */
const HASH_NUMBER_RE = /(?<![\w/#])(?:AB)?#(\d{1,9})\b/g;
/** Issue URLs pasted into a message. */
const URL_NUMBER_RE = /\/(?:issues|work_items|_workitems\/edit)\/(\d{1,9})\b/g;

export const MAX_TOKENS_PER_MESSAGE = 20;
export const MAX_EXACT_FORMS = 200;
export const MAX_NUMBER_FORMS = 50;

function numberToken(raw: string, number: string, scoped?: string): IssueToken {
  const exact = [`#${number}`, number];
  if (scoped) exact.unshift(`${scoped}#${number}`);
  return { raw, exact, number };
}

/** Distinct ticket tokens in one commit message, capped. */
export function extractIssueTokens(message: string): IssueToken[] {
  const out = new Map<string, IssueToken>();
  const add = (token: IssueToken) => {
    const id = token.exact[0];
    if (!out.has(id) && out.size < MAX_TOKENS_PER_MESSAGE) out.set(id, token);
  };
  const text = message ?? "";

  for (const match of text.matchAll(PROJECT_KEY_RE)) {
    const key = match[1].toUpperCase();
    add({ raw: match[1], exact: [key] });
  }
  for (const match of text.matchAll(SCOPED_NUMBER_RE)) {
    add(numberToken(match[0].trim(), match[2], match[1]));
  }
  for (const match of text.matchAll(HASH_NUMBER_RE)) {
    add(numberToken(match[0].trim(), match[1]));
  }
  for (const match of text.matchAll(URL_NUMBER_RE)) {
    add(numberToken(match[0], match[1]));
  }
  return [...out.values()];
}

/** Does a stored issue key correspond to this token? */
export function tokenMatchesKey(
  token: IssueToken,
  externalKey: string | null | undefined
): boolean {
  if (!externalKey) return false;
  if (token.exact.includes(externalKey)) return true;
  if (token.number === undefined) return false;
  return (
    externalKey === token.number || externalKey.endsWith(`#${token.number}`)
  );
}

export interface LinkedIssue {
  id: number;
  key: string;
  caseIds: number[];
}

export interface IssueLookupDb {
  issue: {
    findMany(
      args: unknown
    ): Promise<Array<{ id: number; externalKey: string | null }>>;
  };
  repositoryCaseIssue: {
    findMany(
      args: unknown
    ): Promise<Array<{ caseId: number; issueId: number }>>;
  };
  testRunResults: {
    findMany(args: unknown): Promise<
      Array<{
        testRunCase: { repositoryCaseId: number };
        issues: Array<{ id: number }>;
      }>
    >;
  };
  testRunStepResults: {
    findMany(args: unknown): Promise<
      Array<{
        testRunResult: { testRunCase: { repositoryCaseId: number } };
        issues: Array<{ id: number }>;
      }>
    >;
  };
}

export interface ResolveLinkedIssuesInput {
  projectId: number;
  tokens: IssueToken[];
  /** Extra filter on the linked cases (archived, workflow state, ...). */
  caseFilter?: Record<string, unknown>;
  /**
   * Also treat a ticket added to a test result or step result as linked to
   * the case that result was recorded for. Off, only cases linked to the
   * ticket directly count.
   */
  includeResultLinks?: boolean;
}

export interface ResolvedIssues {
  /** Issues with at least one linked case in the project, by id. */
  issues: Map<number, LinkedIssue>;
  /** Which of those issues each token names. */
  forToken(token: IssueToken): LinkedIssue[];
}

/**
 * Cases each issue is linked to through test results and step results: the
 * repository case of the run case the result was recorded for. Two batched
 * queries keyed by issue id; deleted results, run cases and cases are left
 * out, as are cases the filter rejects.
 */
async function casesViaResults(
  db: IssueLookupDb,
  issueIds: number[],
  caseWhere: Record<string, unknown>
): Promise<Array<{ caseId: number; issueId: number }>> {
  const issueFilter = { id: { in: issueIds } };
  const [results, stepResults] = await Promise.all([
    db.testRunResults.findMany({
      where: {
        isDeleted: false,
        issues: { some: issueFilter },
        testRunCase: { isDeleted: false, repositoryCase: caseWhere },
      },
      select: {
        testRunCase: { select: { repositoryCaseId: true } },
        issues: { where: issueFilter, select: { id: true } },
      },
    }),
    db.testRunStepResults.findMany({
      where: {
        isDeleted: false,
        issues: { some: issueFilter },
        testRunResult: {
          isDeleted: false,
          testRunCase: { isDeleted: false, repositoryCase: caseWhere },
        },
      },
      select: {
        testRunResult: {
          select: { testRunCase: { select: { repositoryCaseId: true } } },
        },
        issues: { where: issueFilter, select: { id: true } },
      },
    }),
  ]);
  const out: Array<{ caseId: number; issueId: number }> = [];
  for (const row of results) {
    for (const issue of row.issues) {
      out.push({ caseId: row.testRunCase.repositoryCaseId, issueId: issue.id });
    }
  }
  for (const row of stepResults) {
    for (const issue of row.issues) {
      out.push({
        caseId: row.testRunResult.testRunCase.repositoryCaseId,
        issueId: issue.id,
      });
    }
  }
  return out;
}

/**
 * Resolve tokens to issues that are linked to cases in the project. Keys are
 * compared exactly, or by trailing `#<number>` for number-keyed trackers, so
 * `#12` in a message finds GitHub's `#12` and GitLab's `group/project#12`
 * alike. Issues with no linked case are not returned: they select nothing.
 * With `includeResultLinks`, a ticket a tester added while recording a
 * result (or a step result) is linked to that result's case as well.
 */
export async function resolveLinkedIssues(
  db: IssueLookupDb,
  input: ResolveLinkedIssuesInput
): Promise<ResolvedIssues> {
  const empty: ResolvedIssues = { issues: new Map(), forToken: () => [] };
  if (input.tokens.length === 0) return empty;

  const exact = new Set<string>();
  const numbers = new Set<string>();
  for (const token of input.tokens) {
    for (const form of token.exact) {
      if (exact.size < MAX_EXACT_FORMS) exact.add(form);
    }
    if (token.number !== undefined && numbers.size < MAX_NUMBER_FORMS) {
      numbers.add(token.number);
    }
  }

  const keyClauses: Record<string, unknown>[] = [
    { externalKey: { in: [...exact] } },
  ];
  for (const number of numbers) {
    keyClauses.push({ externalKey: { endsWith: `#${number}` } });
  }

  const includeResultLinks = input.includeResultLinks === true;
  const caseInProject = { projectId: input.projectId, isDeleted: false };
  const linkClauses: Record<string, unknown>[] = [
    { caseIssues: { some: { case: caseInProject } } },
  ];
  if (includeResultLinks) {
    const liveRunCase = { isDeleted: false, repositoryCase: caseInProject };
    linkClauses.push(
      {
        testRunResults: {
          some: { isDeleted: false, testRunCase: liveRunCase },
        },
      },
      {
        testRunStepResults: {
          some: {
            isDeleted: false,
            testRunResult: { isDeleted: false, testRunCase: liveRunCase },
          },
        },
      }
    );
  }

  const rows = await db.issue.findMany({
    where: {
      isDeleted: false,
      ...(linkClauses.length === 1
        ? linkClauses[0]
        : { AND: [{ OR: linkClauses }] }),
      OR: keyClauses,
    },
    select: { id: true, externalKey: true },
  });
  if (rows.length === 0) return empty;

  const issueIds = rows.map((row) => row.id);
  const caseWhere = { ...caseInProject, ...(input.caseFilter ?? {}) };
  const [directLinks, resultLinks] = await Promise.all([
    db.repositoryCaseIssue.findMany({
      where: { issueId: { in: issueIds }, case: caseWhere },
      select: { caseId: true, issueId: true },
    }),
    includeResultLinks ? casesViaResults(db, issueIds, caseWhere) : [],
  ]);
  const casesByIssue = new Map<number, Set<number>>();
  for (const link of [...directLinks, ...resultLinks]) {
    let set = casesByIssue.get(link.issueId);
    if (!set) {
      set = new Set();
      casesByIssue.set(link.issueId, set);
    }
    set.add(link.caseId);
  }

  const issues = new Map<number, LinkedIssue>();
  const keyed: Array<{ key: string; issue: LinkedIssue }> = [];
  for (const row of rows) {
    const caseIds = casesByIssue.get(row.id);
    if (!row.externalKey || !caseIds || caseIds.size === 0) continue;
    const issue: LinkedIssue = {
      id: row.id,
      key: row.externalKey,
      caseIds: [...caseIds].sort((a, b) => a - b),
    };
    issues.set(row.id, issue);
    keyed.push({ key: row.externalKey, issue });
  }

  return {
    issues,
    forToken: (token) =>
      keyed
        .filter((entry) => tokenMatchesKey(token, entry.key))
        .map((entry) => entry.issue),
  };
}

/**
 * The tracker keys worth asking a provider for, from tokens found in commit
 * messages: the spelling each tracker stores as `externalKey`, so a lookup is
 * only made where the provider can answer it. A bare `#12` cannot name a
 * GitLab or Gitea issue without its project path, so it is not tried there.
 */
export function importableIssueKeys(
  provider: string | null | undefined,
  tokens: IssueToken[]
): string[] {
  const out = new Set<string>();
  const kind = (provider ?? "").toUpperCase();
  for (const token of tokens) {
    if (token.number === undefined) {
      if (kind === "JIRA") out.add(token.exact[0]);
      continue;
    }
    const scoped = token.exact.find((form) => /\/.*#\d+$/.test(form));
    switch (kind) {
      case "GITHUB":
      case "REDMINE":
      case "MANTISBT":
        out.add(`#${token.number}`);
        break;
      case "GITLAB":
      case "GITEA":
        if (scoped) out.add(scoped);
        break;
      case "AZURE_DEVOPS":
        out.add(token.number);
        break;
      default:
        break;
    }
  }
  return [...out];
}
