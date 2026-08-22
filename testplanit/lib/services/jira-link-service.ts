import { baseDb } from "@/lib/db";
import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { upsertLinkedIssueShell } from "~/lib/services/linkedIssueUpsert";
import { IntegrationProvider } from "~/zenstack/models";

// Supported issue tracking providers (every provider routed through
// ManageExternalIssues — i.e. all issue trackers except SIMPLE_URL, which has
// its own ManageSimpleUrlIssues path).
const ISSUE_TRACKING_PROVIDERS = [
  IntegrationProvider.JIRA,
  IntegrationProvider.GITHUB,
  IntegrationProvider.AZURE_DEVOPS,
  IntegrationProvider.GITLAB,
  IntegrationProvider.GITEA,
  IntegrationProvider.REDMINE,
  IntegrationProvider.MANTISBT,
];

/**
 * Retire the tracker shell row an unlink may have just orphaned.
 *
 * A shell row exists only as the local anchor for a tracker ticket some test
 * artifact points at, so once nothing points at it there is nothing left to
 * anchor. Three constraints bound that cleanup, and every unlink path shares
 * this one implementation of them rather than restating them six times:
 *
 *   - It is a soft delete. `Issue.parent` is declared `onDelete: Cascade`, so
 *     a row delete here would take the whole descendant subtree with it on
 *     behalf of a caller that asked only to unlink a single artifact.
 *   - It is scoped to defects, on the read and again on the write. A
 *     requirement is an authored entity whose lifetime is owned by the
 *     requirement tree, not by whichever test artifact happens to reference
 *     it, so it is never link-lifecycle garbage.
 *   - `children` counts as a reference. A node with descendants beneath it is
 *     still reachable through the tree and is not an orphan.
 */
async function softDeleteOrphanedIssueShell(issueId: number): Promise<void> {
  const shell = await baseDb.issue.findFirst({
    where: { id: issueId, ...DEFECT_SCOPE_WHERE },
    include: {
      caseIssues: true,
      testRuns: true,
      sessions: true,
      testRunResults: true,
      sessionResults: true,
      testRunStepResults: true,
      children: true,
    },
  });

  if (!shell) {
    return;
  }

  const remainingReferences =
    (shell.caseIssues?.length || 0) +
    (shell.testRuns?.length || 0) +
    (shell.sessions?.length || 0) +
    (shell.testRunResults?.length || 0) +
    (shell.sessionResults?.length || 0) +
    (shell.testRunStepResults?.length || 0) +
    (shell.children?.length || 0);

  if (remainingReferences > 0) {
    return;
  }

  // updateMany rather than update: the row-kind scope is re-evaluated inside
  // the write itself, so a row reclassified as a requirement between the read
  // above and this statement is left alone instead of being retired on the
  // strength of a stale read.
  await baseDb.issue.updateMany({
    where: { id: issueId, ...DEFECT_SCOPE_WHERE },
    data: { isDeleted: true },
  });
}

export class JiraLinkService {
  /**
   * Link a TestPlanIt test case to a Jira issue
   */
  static async linkTestCaseToJiraIssue(
    testCaseId: number,
    jiraIssueKey: string,
    jiraIssueId: string,
    integrationId: number,
    issueTitle?: string,
    issueUrl?: string
  ): Promise<void> {
    try {
      // First, check if the integration is valid and active
      const integration = await baseDb.integration.findFirst({
        where: {
          id: integrationId,
          provider: { in: ISSUE_TRACKING_PROVIDERS },
          status: "ACTIVE",
        },
      });

      if (!integration) {
        throw new Error("Invalid or inactive issue tracking integration");
      }

      // Check if the test case exists
      const testCase = await baseDb.repositoryCases.findUnique({
        where: { id: testCaseId },
        include: { caseIssues: { include: { issue: true } } },
      });

      if (!testCase) {
        throw new Error("Test case not found");
      }

      // Use upsert to create or find the issue atomically
      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: jiraIssueId,
        integrationId: integrationId,
        create: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalId: jiraIssueId,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          integrationId: integrationId,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
          createdById: testCase.creatorId,
          projectId: testCase.projectId,
        },
        update: {
          // Update the issue data when found (optional: sync latest data)
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Link the test case to the issue (if not already linked)
      // Create the join row connecting the repository case to the issue
      await baseDb.repositoryCaseIssue.createMany({
        data: [{ caseId: testCaseId, issueId: issue.id }],
        skipDuplicates: true,
      });
    } catch (error) {
      console.error("Error linking test case to Jira issue:", error);
      throw error;
    }
  }

  /**
   * Link a TestPlanIt test run to a Jira issue
   */
  static async linkTestRunToJiraIssue(
    testRunId: number,
    jiraIssueKey: string,
    jiraIssueId: string,
    integrationId: number,
    issueTitle?: string,
    issueUrl?: string
  ): Promise<void> {
    try {
      const integration = await baseDb.integration.findFirst({
        where: {
          id: integrationId,
          provider: { in: ISSUE_TRACKING_PROVIDERS },
          status: "ACTIVE",
        },
      });

      if (!integration) {
        throw new Error("Invalid or inactive issue tracking integration");
      }

      const testRun = await baseDb.testRuns.findUnique({
        where: { id: testRunId },
        include: { issues: true },
      });

      if (!testRun) {
        throw new Error("Test run not found");
      }

      // Use upsert to create or find the issue atomically
      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: jiraIssueId,
        integrationId: integrationId,
        create: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalId: jiraIssueId,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          integrationId: integrationId,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
          createdById: testRun.createdById,
          projectId: testRun.projectId,
        },
        update: {
          // Update the issue data when found
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Link the test run to the issue
      await baseDb.testRuns.update({
        where: { id: testRunId },
        data: {
          issues: {
            connect: { id: issue.id },
          },
        },
      });
    } catch (error) {
      console.error("Error linking test run to Jira issue:", error);
      throw error;
    }
  }

  /**
   * Get linked Jira issues for a test run
   */
  static async getLinkedJiraIssuesForTestRun(
    testRunId: number
  ): Promise<any[]> {
    try {
      const testRun = await baseDb.testRuns.findUnique({
        where: { id: testRunId },
        include: {
          issues: {
            where: {
              integration: {
                provider: { in: ISSUE_TRACKING_PROVIDERS },
                status: "ACTIVE",
              },
            },
            include: {
              integration: true,
            },
          },
        },
      });

      if (!testRun) {
        return [];
      }

      return testRun.issues.map((issue) => ({
        id: issue.id,
        key: issue.name,
        title: issue.title,
        summary: issue.title,
        externalId: issue.externalId,
        data: issue.data,
        url: issue.externalUrl,
        status: issue.externalStatus,
        integration: {
          id: issue.integration?.id,
          name: issue.integration?.name,
          provider: issue.integration?.provider,
        },
      }));
    } catch (error) {
      console.error("Error getting linked Jira issues for test run:", error);
      throw error;
    }
  }

  /**
   * Link a TestPlanIt session to a Jira issue
   */
  static async linkSessionToJiraIssue(
    sessionId: number,
    jiraIssueKey: string,
    jiraIssueId: string,
    integrationId: number,
    issueTitle?: string,
    issueUrl?: string
  ): Promise<void> {
    try {
      const integration = await baseDb.integration.findFirst({
        where: {
          id: integrationId,
          provider: { in: ISSUE_TRACKING_PROVIDERS },
          status: "ACTIVE",
        },
      });

      if (!integration) {
        throw new Error("Invalid or inactive issue tracking integration");
      }

      const session = await baseDb.sessions.findUnique({
        where: { id: sessionId },
        include: { issues: true },
      });

      if (!session) {
        throw new Error("Session not found");
      }

      // Use upsert to create or update the issue atomically
      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: jiraIssueId,
        integrationId: integrationId,
        create: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalId: jiraIssueId,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          integrationId: integrationId,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
          createdById: session.createdById,
          projectId: session.projectId,
        },
        update: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Link the session to the issue
      await baseDb.sessions.update({
        where: { id: sessionId },
        data: {
          issues: {
            connect: { id: issue.id },
          },
        },
      });
    } catch (error) {
      console.error("Error linking session to Jira issue:", error);
      throw error;
    }
  }

  /**
   * Get linked Jira issues for a session
   */
  static async getLinkedJiraIssuesForSession(
    sessionId: number
  ): Promise<any[]> {
    try {
      const session = await baseDb.sessions.findUnique({
        where: { id: sessionId },
        include: {
          issues: {
            where: {
              integration: {
                provider: { in: ISSUE_TRACKING_PROVIDERS },
                status: "ACTIVE",
              },
            },
            include: {
              integration: true,
            },
          },
        },
      });

      if (!session) {
        return [];
      }

      return session.issues.map((issue) => ({
        id: issue.id,
        key: issue.name,
        title: issue.title,
        summary: issue.title,
        externalId: issue.externalId,
        data: issue.data,
        url: issue.externalUrl,
        status: issue.externalStatus,
        integration: {
          id: issue.integration?.id,
          name: issue.integration?.name,
          provider: issue.integration?.provider,
        },
      }));
    } catch (error) {
      console.error("Error fetching linked Jira issues for session:", error);
      return [];
    }
  }

  /**
   * Get linked Jira issues for a test case
   */
  static async getLinkedJiraIssues(testCaseId: number): Promise<any[]> {
    try {
      const linkedIssues = await baseDb.issue.findMany({
        where: {
          caseIssues: {
            some: {
              case: {
                id: testCaseId,
              },
            },
          },
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
            status: "ACTIVE",
          },
        },
        include: {
          integration: true,
        },
      });

      return linkedIssues.map((issue) => ({
        id: issue.id,
        key: issue.name,
        title: issue.title,
        summary: issue.title, // Include as summary for consistency
        externalId: issue.externalId,
        data: issue.data,
        url: issue.externalUrl,
        status: issue.externalStatus,
        integration: {
          id: issue.integration?.id,
          name: issue.integration?.name,
          provider: issue.integration?.provider,
        },
      }));
    } catch (error) {
      console.error("Error getting linked Jira issues:", error);
      throw error;
    }
  }

  /**
   * Unlink a test case from a Jira issue
   */
  static async unlinkTestCaseFromJiraIssue(
    testCaseId: number,
    jiraIssueId: string
  ): Promise<void> {
    try {
      const issue = await baseDb.issue.findFirst({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
      });

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Disconnect the test case from the issue
      await baseDb.repositoryCaseIssue.deleteMany({
        where: { caseId: testCaseId, issueId: issue.id },
      });

      await softDeleteOrphanedIssueShell(issue.id);
    } catch (error) {
      console.error("Error unlinking test case from Jira issue:", error);
      throw error;
    }
  }

  /**
   * Unlink a test run from a Jira issue
   */
  static async unlinkTestRunFromJiraIssue(
    testRunId: number,
    jiraIssueId: string
  ): Promise<void> {
    try {
      const issue = await baseDb.issue.findFirst({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
      });

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Disconnect the test run from the issue
      await baseDb.testRuns.update({
        where: { id: testRunId },
        data: {
          issues: {
            disconnect: { id: issue.id },
          },
        },
      });

      await softDeleteOrphanedIssueShell(issue.id);
    } catch (error) {
      console.error("Error unlinking test run from Jira issue:", error);
      throw error;
    }
  }

  /**
   * Unlink a session from a Jira issue
   */
  static async unlinkSessionFromJiraIssue(
    sessionId: number,
    jiraIssueId: string
  ): Promise<void> {
    try {
      const issue = await baseDb.issue.findFirst({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
      });

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Disconnect the session from the issue
      await baseDb.sessions.update({
        where: { id: sessionId },
        data: {
          issues: {
            disconnect: { id: issue.id },
          },
        },
      });

      await softDeleteOrphanedIssueShell(issue.id);
    } catch (error) {
      console.error("Error unlinking session from Jira issue:", error);
      throw error;
    }
  }

  /**
   * Unlink a test run result from a Jira issue
   */
  static async unlinkTestRunResultFromJiraIssue(
    testRunResultId: number,
    jiraIssueId: string
  ): Promise<void> {
    try {
      const issue = await baseDb.issue.findFirst({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
      });

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Disconnect the test run result from the issue
      await baseDb.testRunResults.update({
        where: { id: testRunResultId },
        data: {
          issues: {
            disconnect: { id: issue.id },
          },
        },
      });

      await softDeleteOrphanedIssueShell(issue.id);
    } catch (error) {
      console.error("Error unlinking test run result from Jira issue:", error);
      throw error;
    }
  }

  /**
   * Unlink a session result from a Jira issue
   */
  static async unlinkSessionResultFromJiraIssue(
    sessionResultId: number,
    jiraIssueId: string
  ): Promise<void> {
    try {
      const issue = await baseDb.issue.findFirst({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
      });

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Disconnect the session result from the issue
      await baseDb.sessionResults.update({
        where: { id: sessionResultId },
        data: {
          issues: {
            disconnect: { id: issue.id },
          },
        },
      });

      await softDeleteOrphanedIssueShell(issue.id);
    } catch (error) {
      console.error("Error unlinking session result from Jira issue:", error);
      throw error;
    }
  }

  /**
   * Link a TestPlanIt test run result to a Jira issue
   */
  static async linkTestRunResultToJiraIssue(
    testRunResultId: number,
    jiraIssueKey: string,
    jiraIssueId: string,
    integrationId: number,
    issueTitle?: string,
    issueUrl?: string
  ): Promise<void> {
    try {
      const integration = await baseDb.integration.findFirst({
        where: {
          id: integrationId,
          provider: { in: ISSUE_TRACKING_PROVIDERS },
          status: "ACTIVE",
        },
      });

      if (!integration) {
        throw new Error("Invalid or inactive issue tracking integration");
      }

      const testRunResult = await baseDb.testRunResults.findUnique({
        where: { id: testRunResultId },
        include: {
          issues: true,
          testRunCase: {
            include: {
              testRun: true,
            },
          },
        },
      });

      if (!testRunResult) {
        throw new Error("Test run result not found");
      }

      const projectId = testRunResult.testRunCase.testRun.projectId;

      // Use upsert to create or update the issue atomically
      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: jiraIssueId,
        integrationId: integrationId,
        create: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalId: jiraIssueId,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          integrationId: integrationId,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
          createdById: testRunResult.testRunCase.testRun.createdById,
          projectId: projectId,
        },
        update: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Link the test run result to the issue
      await baseDb.testRunResults.update({
        where: { id: testRunResultId },
        data: {
          issues: {
            connect: { id: issue.id },
          },
        },
      });
    } catch (error) {
      console.error("Error linking test run result to Jira issue:", error);
      throw error;
    }
  }

  /**
   * Link a TestPlanIt session result to a Jira issue
   */
  static async linkSessionResultToJiraIssue(
    sessionResultId: number,
    jiraIssueKey: string,
    jiraIssueId: string,
    integrationId: number,
    issueTitle?: string,
    issueUrl?: string
  ): Promise<void> {
    try {
      const integration = await baseDb.integration.findFirst({
        where: {
          id: integrationId,
          provider: { in: ISSUE_TRACKING_PROVIDERS },
          status: "ACTIVE",
        },
      });

      if (!integration) {
        throw new Error("Invalid or inactive issue tracking integration");
      }

      const sessionResult = await baseDb.sessionResults.findUnique({
        where: { id: sessionResultId },
        include: {
          issues: true,
          session: true,
        },
      });

      if (!sessionResult) {
        throw new Error("Session result not found");
      }

      const projectId = sessionResult.session.projectId;

      // Use upsert to create or update the issue atomically
      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: jiraIssueId,
        integrationId: integrationId,
        create: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalId: jiraIssueId,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          integrationId: integrationId,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
          createdById: sessionResult.createdById,
          projectId: projectId,
        },
        update: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Link the session result to the issue
      await baseDb.sessionResults.update({
        where: { id: sessionResultId },
        data: {
          issues: {
            connect: { id: issue.id },
          },
        },
      });
    } catch (error) {
      console.error("Error linking session result to Jira issue:", error);
      throw error;
    }
  }

  /**
   * Get linked Jira issues for a test run result
   */
  static async getLinkedJiraIssuesForTestRunResult(
    testRunResultId: number
  ): Promise<any[]> {
    try {
      const testRunResult = await baseDb.testRunResults.findUnique({
        where: { id: testRunResultId },
        include: {
          issues: {
            where: {
              integration: {
                provider: { in: ISSUE_TRACKING_PROVIDERS },
                status: "ACTIVE",
              },
            },
            include: {
              integration: true,
            },
          },
        },
      });

      if (!testRunResult) {
        return [];
      }

      return testRunResult.issues.map((issue) => ({
        id: issue.id,
        key: issue.name,
        title: issue.title,
        summary: issue.title,
        externalId: issue.externalId,
        data: issue.data,
        url: issue.externalUrl,
        status: issue.externalStatus,
        integration: {
          id: issue.integration?.id,
          name: issue.integration?.name,
          provider: issue.integration?.provider,
        },
      }));
    } catch (error) {
      console.error(
        "Error fetching linked Jira issues for test run result:",
        error
      );
      return [];
    }
  }

  /**
   * Get linked Jira issues for a session result
   */
  static async getLinkedJiraIssuesForSessionResult(
    sessionResultId: number
  ): Promise<any[]> {
    try {
      const sessionResult = await baseDb.sessionResults.findUnique({
        where: { id: sessionResultId },
        include: {
          issues: {
            where: {
              integration: {
                provider: { in: ISSUE_TRACKING_PROVIDERS },
                status: "ACTIVE",
              },
            },
            include: {
              integration: true,
            },
          },
        },
      });

      if (!sessionResult) {
        return [];
      }

      return sessionResult.issues.map((issue) => ({
        id: issue.id,
        key: issue.name,
        title: issue.title,
        summary: issue.title,
        externalId: issue.externalId,
        data: issue.data,
        url: issue.externalUrl,
        status: issue.externalStatus,
        integration: {
          id: issue.integration?.id,
          name: issue.integration?.name,
          provider: issue.integration?.provider,
        },
      }));
    } catch (error) {
      console.error(
        "Error fetching linked Jira issues for session result:",
        error
      );
      return [];
    }
  }

  /**
   * Link a TestPlanIt test run step result to a Jira issue
   */
  static async linkTestRunStepResultToJiraIssue(
    testRunStepResultId: number,
    jiraIssueKey: string,
    jiraIssueId: string,
    integrationId: number,
    issueTitle?: string,
    issueUrl?: string
  ): Promise<void> {
    try {
      const integration = await baseDb.integration.findFirst({
        where: {
          id: integrationId,
          provider: { in: ISSUE_TRACKING_PROVIDERS },
          status: "ACTIVE",
        },
      });

      if (!integration) {
        throw new Error("Invalid or inactive issue tracking integration");
      }

      const testRunStepResult = await baseDb.testRunStepResults.findUnique({
        where: { id: testRunStepResultId },
        include: {
          issues: true,
          testRunResult: {
            include: {
              testRunCase: {
                include: {
                  testRun: true,
                },
              },
            },
          },
        },
      });

      if (!testRunStepResult) {
        throw new Error("Test run step result not found");
      }

      const projectId =
        testRunStepResult.testRunResult.testRunCase.testRun.projectId;

      // Use upsert to create or update the issue atomically
      const issue = await upsertLinkedIssueShell(baseDb, {
        externalId: jiraIssueId,
        integrationId: integrationId,
        create: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalId: jiraIssueId,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          integrationId: integrationId,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
          createdById: testRunStepResult.testRunResult.executedById,
          projectId: projectId,
        },
        update: {
          name: jiraIssueKey,
          title: issueTitle || jiraIssueKey,
          externalKey: jiraIssueKey,
          externalUrl: issueUrl,
          data: {
            jiraKey: jiraIssueKey,
            jiraId: jiraIssueId,
            linkedAt: new Date().toISOString(),
          },
        },
      });

      // Link the test run step result to the issue
      await baseDb.testRunStepResults.update({
        where: { id: testRunStepResultId },
        data: {
          issues: {
            connect: { id: issue.id },
          },
        },
      });
    } catch (error) {
      console.error("Error linking test run step result to Jira issue:", error);
      throw error;
    }
  }

  /**
   * Unlink a test run step result from a Jira issue
   */
  static async unlinkTestRunStepResultFromJiraIssue(
    testRunStepResultId: number,
    jiraIssueId: string
  ): Promise<void> {
    try {
      const issue = await baseDb.issue.findFirst({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
      });

      if (!issue) {
        throw new Error("Issue not found");
      }

      // Disconnect the test run step result from the issue
      await baseDb.testRunStepResults.update({
        where: { id: testRunStepResultId },
        data: {
          issues: {
            disconnect: { id: issue.id },
          },
        },
      });

      await softDeleteOrphanedIssueShell(issue.id);
    } catch (error) {
      console.error(
        "Error unlinking test run step result from Jira issue:",
        error
      );
      throw error;
    }
  }

  /**
   * Get linked Jira issues for a test run step result
   */
  static async getLinkedJiraIssuesForTestRunStepResult(
    testRunStepResultId: number
  ): Promise<any[]> {
    try {
      const testRunStepResult = await baseDb.testRunStepResults.findUnique({
        where: { id: testRunStepResultId },
        include: {
          issues: {
            where: {
              integration: {
                provider: { in: ISSUE_TRACKING_PROVIDERS },
                status: "ACTIVE",
              },
            },
            include: {
              integration: true,
            },
          },
        },
      });

      if (!testRunStepResult) {
        return [];
      }

      return testRunStepResult.issues.map((issue) => ({
        id: issue.id,
        key: issue.name,
        title: issue.title,
        summary: issue.title,
        externalId: issue.externalId,
        data: issue.data,
        url: issue.externalUrl,
        status: issue.externalStatus,
        integration: {
          id: issue.integration?.id,
          name: issue.integration?.name,
          provider: issue.integration?.provider,
        },
      }));
    } catch (error) {
      console.error(
        "Error fetching linked Jira issues for test run step result:",
        error
      );
      return [];
    }
  }

  /**
   * Sync Jira issue data with latest information
   */
  static async syncJiraIssueData(
    jiraIssueId: string,
    issueData: any
  ): Promise<void> {
    try {
      // Deliberately NOT routed through upsertLinkedIssueShell (PROV-06):
      // this write touches only the `data` JSON blob, which is not one of
      // LOCKED_ISSUE_FIELDS, so migrating it would add churn with no
      // security value.
      await baseDb.issue.updateMany({
        where: {
          externalId: jiraIssueId,
          integration: {
            provider: { in: ISSUE_TRACKING_PROVIDERS },
          },
        },
        data: {
          data: {
            ...issueData,
            lastSynced: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error("Error syncing Jira issue data:", error);
      throw error;
    }
  }
}
