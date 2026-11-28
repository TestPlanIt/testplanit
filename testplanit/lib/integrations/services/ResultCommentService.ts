import { rawDb as defaultDb } from "@/lib/rawDb";
import { getAppUrl } from "~/lib/appUrl";
import { getTenantConfig } from "~/lib/multiTenantDb";
import { getTestRunSummary } from "~/lib/services/testRunSummary";
import { unexecutedStatusName } from "~/lib/services/testRunSummary-shared";
import { escapeMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import type { DbClient } from "~/lib/zenstack";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import { integrationManager } from "../IntegrationManager";
import {
  readResultCommentsConfig,
  supportsResultComments,
} from "../resultCommentsConfig";

/** A comment lists this many test cases and counts the rest. */
export const MAX_COMMENT_ROWS = 50;

/** One completed run writes to at most this many issues. */
export const MAX_COMMENTED_ISSUES = 100;

/** What a result means, from the status's flags; the name is only shown. */
export interface ResultCommentStatus {
  name: string;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
}

export interface ResultCommentRow {
  caseId: number;
  caseName: string;
  status: ResultCommentStatus;
}

export interface ResultCommentTotal {
  status: ResultCommentStatus;
  count: number;
}

export interface ResultCommentContent {
  /** The line the comment starts with, by which it is found again. */
  marker: string;
  runName: string;
  runUrl: string;
  completedAt: Date | null;
  /** The run's test cases linked to the issue; none for a run-level link. */
  rows: ResultCommentRow[];
  totals: ResultCommentTotal[];
}

export interface ResultCommentsResult {
  success: boolean;
  /** Why nothing was posted, when the run or project does not qualify. */
  skipped?: string;
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

function statusIcon(status: ResultCommentStatus): string {
  if (status.isSuccess) return "✅";
  if (status.isFailure) return "❌";
  return status.isCompleted ? "⏭️" : "⚪";
}

/**
 * Text from TestPlanIt placed in a line of the comment. Markdown and HTML
 * in a name stay text, a name cannot break out of its table cell, and an
 * `@name` in it mentions nobody.
 */
function inlineText(value: string): string {
  return escapeMarkdown(value.replace(/\s+/g, " ").trim())
    .replace(/</g, "&lt;")
    .replace(/@/g, "@​");
}

function sameStatus(a: ResultCommentStatus, b: ResultCommentStatus): boolean {
  return (
    a.name === b.name &&
    a.isSuccess === b.isSuccess &&
    a.isFailure === b.isFailure &&
    a.isCompleted === b.isCompleted
  );
}

/** Counts per status: passes first, then failures, then the rest. */
export function totalsOfRows(rows: ResultCommentRow[]): ResultCommentTotal[] {
  const totals: ResultCommentTotal[] = [];
  for (const row of rows) {
    const total = totals.find((entry) => sameStatus(entry.status, row.status));
    if (total) total.count += 1;
    else totals.push({ status: row.status, count: 1 });
  }
  return sortTotals(totals);
}

function sortTotals(totals: ResultCommentTotal[]): ResultCommentTotal[] {
  const rank = (status: ResultCommentStatus) =>
    status.isSuccess ? 0 : status.isFailure ? 1 : 2;
  return totals
    .map((total, index) => ({ total, index }))
    .sort(
      (a, b) => rank(a.total.status) - rank(b.total.status) || a.index - b.index
    )
    .map((entry) => entry.total);
}

/** The comment body, in GitHub-flavored markdown. */
export function renderResultComment(content: ResultCommentContent): string {
  const lines = [content.marker, "### Test results from TestPlanIt", ""];

  // A day alone would be the UTC day, which is not the day everyone
  // completed the run on; the time and its zone are said outright.
  const completed = content.completedAt
    ? ` · completed ${content.completedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
    : "";
  lines.push(
    `**[${inlineText(content.runName)}](${content.runUrl})**${completed}`,
    ""
  );

  if (content.totals.length > 0) {
    lines.push(
      content.totals
        .map(
          (total) =>
            `${statusIcon(total.status)} ${total.count} ${inlineText(total.status.name)}`
        )
        .join(" · "),
      ""
    );
  }

  if (content.rows.length > 0) {
    lines.push("| Test case | Result |", "| --- | --- |");
    for (const row of content.rows.slice(0, MAX_COMMENT_ROWS)) {
      lines.push(
        `| [${inlineText(row.caseName)}](${content.runUrl}?selectedCase=${row.caseId}) | ${statusIcon(row.status)} ${inlineText(row.status.name)} |`
      );
    }
    const more = content.rows.length - MAX_COMMENT_ROWS;
    if (more > 0) {
      lines.push("", `_…and ${more} more in the run._`);
    }
    lines.push("");
  }

  lines.push(
    "<sub>TestPlanIt updates this comment when a test run that covers this issue is completed.</sub>"
  );
  return lines.join("\n");
}

interface StoredIssue {
  id: number;
  externalId: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  externalData: unknown;
}

/**
 * `owner/repo#number` for a stored GitHub issue. Rows hold the number alone
 * or with a `#`, and the repository beside it in the data kept from the
 * last sync or in the issue's address.
 */
function githubIssueRef(issue: StoredIssue): string | null {
  const id = String(issue.externalId ?? "");
  if (/^[\w.-]+\/[\w.-]+#\d+$/.test(id)) return id;

  const number = (id || String(issue.externalKey ?? "")).replace(/^#/, "");
  if (!/^\d+$/.test(number)) return null;

  const data = (issue.externalData ?? {}) as Record<string, unknown>;
  let owner = typeof data._github_owner === "string" ? data._github_owner : "";
  let repo = typeof data._github_repo === "string" ? data._github_repo : "";
  if ((!owner || !repo) && issue.externalUrl) {
    const match = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/\d+/.exec(
      issue.externalUrl
    );
    if (match) {
      owner = match[1];
      repo = match[2];
    }
  }
  return owner && repo ? `${owner}/${repo}#${number}` : null;
}

const STATUS_SELECT = {
  name: true,
  isSuccess: true,
  isFailure: true,
  isCompleted: true,
} as const;

/** An automated result with no status mapped takes its meaning from its type. */
function automatedStatus(
  status: ResultCommentStatus | null,
  type: string
): ResultCommentStatus {
  if (status) return status;
  return {
    name: type,
    isSuccess: type === "PASSED",
    isFailure: type === "FAILURE" || type === "ERROR",
    isCompleted: true,
  };
}

export class ResultCommentService {
  /**
   * Posts a completed run's results on each tracker issue the run covers:
   * the issues linked to its test cases, to its results and their steps,
   * and to the run itself. Each issue holds one comment per project, which
   * later runs replace. One issue failing does not stop the others.
   */
  async postRunResultComments(
    runId: number,
    options: { dbClient?: DbClient; tenantId?: string } = {}
  ): Promise<ResultCommentsResult> {
    const db = options.dbClient || defaultDb;
    const result: ResultCommentsResult = {
      success: true,
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };
    const skip = (reason: string): ResultCommentsResult => ({
      ...result,
      skipped: reason,
    });

    const run = await db.testRuns.findUnique({
      where: { id: runId },
      select: {
        id: true,
        name: true,
        projectId: true,
        isCompleted: true,
        isDeleted: true,
        completedAt: true,
        testRunType: true,
      },
    });
    if (!run || run.isDeleted || !run.isCompleted) {
      return skip("the run is not a completed run");
    }

    const projectIntegration = await db.projectIntegration.findFirst({
      where: {
        projectId: run.projectId,
        isActive: true,
        integration: { isDeleted: false },
      },
      select: {
        config: true,
        integration: { select: { id: true, provider: true, authType: true } },
      },
    });
    const integration = projectIntegration?.integration;
    if (
      !integration ||
      !supportsResultComments(integration) ||
      !readResultCommentsConfig(projectIntegration?.config).enabled
    ) {
      return skip("result comments are not switched on for the project");
    }

    const issueWhere = { integrationId: integration.id, isDeleted: false };
    const rowsByIssue = new Map<number, ResultCommentRow[]>();
    const addRow = (issueIds: Iterable<number>, row: ResultCommentRow) => {
      for (const issueId of new Set(issueIds)) {
        const rows = rowsByIssue.get(issueId) ?? [];
        rows.push(row);
        rowsByIssue.set(issueId, rows);
      }
    };

    if (isAutomatedTestRunType(run.testRunType)) {
      const results = await db.jUnitTestResult.findMany({
        where: {
          testSuite: { testRunId: runId },
          repositoryCase: { caseIssues: { some: { issue: issueWhere } } },
        },
        orderBy: [{ executedAt: "asc" }, { id: "asc" }],
        select: {
          type: true,
          repositoryCaseId: true,
          status: { select: STATUS_SELECT },
          repositoryCase: {
            select: {
              name: true,
              caseIssues: {
                where: { issue: issueWhere },
                select: { issueId: true },
              },
            },
          },
        },
      });
      // A case run more than once shows its latest result.
      const latest = new Map<number, (typeof results)[number]>();
      for (const entry of results) latest.set(entry.repositoryCaseId, entry);
      for (const entry of latest.values()) {
        addRow(
          entry.repositoryCase.caseIssues.map((link) => link.issueId),
          {
            caseId: entry.repositoryCaseId,
            caseName: entry.repositoryCase.name,
            status: automatedStatus(entry.status, entry.type),
          }
        );
      }
    } else {
      const cases = await db.testRunCases.findMany({
        where: {
          testRunId: runId,
          isDeleted: false,
          OR: [
            { repositoryCase: { caseIssues: { some: { issue: issueWhere } } } },
            {
              results: {
                some: {
                  isDeleted: false,
                  OR: [
                    { issues: { some: issueWhere } },
                    {
                      stepResults: {
                        some: {
                          isDeleted: false,
                          issues: { some: issueWhere },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        select: {
          repositoryCaseId: true,
          status: { select: STATUS_SELECT },
          repositoryCase: {
            select: {
              name: true,
              caseIssues: {
                where: { issue: issueWhere },
                select: { issueId: true },
              },
            },
          },
          results: {
            where: { isDeleted: false },
            select: {
              issues: { where: issueWhere, select: { id: true } },
              stepResults: {
                where: { isDeleted: false },
                select: {
                  issues: { where: issueWhere, select: { id: true } },
                },
              },
            },
          },
        },
      });
      for (const runCase of cases) {
        const issueIds = [
          ...runCase.repositoryCase.caseIssues.map((link) => link.issueId),
          ...runCase.results.flatMap((entry) => [
            ...entry.issues.map((issue) => issue.id),
            ...entry.stepResults.flatMap((step) =>
              step.issues.map((issue) => issue.id)
            ),
          ]),
        ];
        addRow(issueIds, {
          caseId: runCase.repositoryCaseId,
          caseName: runCase.repositoryCase.name,
          status: runCase.status ?? {
            name: unexecutedStatusName(true),
            isSuccess: false,
            isFailure: false,
            isCompleted: false,
          },
        });
      }
    }

    const runLinks = await db.testRuns.findUnique({
      where: { id: runId },
      select: { issues: { where: issueWhere, select: { id: true } } },
    });
    const issueIds = Array.from(
      new Set([
        ...rowsByIssue.keys(),
        ...(runLinks?.issues ?? []).map((issue) => issue.id),
      ])
    );
    if (issueIds.length === 0) {
      return skip("the run covers no issue of the project's tracker");
    }

    // The issues the links above name, of either kind: a requirement's
    // tests and a defect's retest are both results its issue should show.
    const issues: StoredIssue[] = await db.issue.findMany({
      where: { id: { in: issueIds }, ...issueWhere },
      orderBy: { id: "asc" },
      select: {
        id: true,
        externalId: true,
        externalKey: true,
        externalUrl: true,
        externalData: true,
      },
    });

    let adapter;
    try {
      adapter = await integrationManager.getAdapter(String(integration.id), db);
    } catch (error: any) {
      return {
        ...result,
        success: false,
        errors: [error?.message ?? "The tracker connection could not be used"],
      };
    }
    if (!adapter?.upsertIssueComment) {
      return skip("the tracker connection cannot edit comments");
    }

    const baseUrl =
      (options.tenantId && getTenantConfig(options.tenantId)?.baseUrl) ||
      getAppUrl();
    // Locale-less: the app sends the reader on to their own language.
    const runUrl = `${baseUrl}/projects/runs/${run.projectId}/${run.id}`;
    const marker = `<!-- testplanit-results ${baseUrl}/projects/overview/${run.projectId} -->`;

    // An issue linked to the run alone shows the whole run's totals.
    let runTotals: ResultCommentTotal[] | null = null;
    const totalsOfRun = async () => {
      if (!runTotals) {
        const summary = await getTestRunSummary(runId, { client: db });
        runTotals = sortTotals(
          summary.statusCounts
            .filter((entry) => entry.count > 0)
            .map((entry) => ({
              count: entry.count,
              status: {
                name: entry.statusName,
                isSuccess: entry.isSuccess === true,
                isFailure: entry.isFailure === true,
                isCompleted: entry.isCompleted === true,
              },
            }))
        );
      }
      return runTotals;
    };

    if (issues.length > MAX_COMMENTED_ISSUES) {
      result.errors.push(
        `The run covers ${issues.length} issues; results were posted on the first ${MAX_COMMENTED_ISSUES}`
      );
    }

    for (const issue of issues.slice(0, MAX_COMMENTED_ISSUES)) {
      const label = issue.externalKey || issue.externalId || String(issue.id);
      try {
        const ref = githubIssueRef(issue);
        if (!ref) {
          throw new Error("the issue's repository is not known");
        }
        const rows = rowsByIssue.get(issue.id) ?? [];
        const written = await adapter.upsertIssueComment(
          ref,
          marker,
          renderResultComment({
            marker,
            runName: run.name,
            runUrl,
            completedAt: run.completedAt,
            rows,
            totals: rows.length > 0 ? totalsOfRows(rows) : await totalsOfRun(),
          })
        );
        if (written.created) result.created += 1;
        else if (written.changed) result.updated += 1;
        else result.unchanged += 1;
      } catch (error: any) {
        result.errors.push(
          `${label}: ${error?.message ?? "the comment could not be written"}`
        );
      }
    }

    return result;
  }
}

export const resultCommentService = new ResultCommentService();
