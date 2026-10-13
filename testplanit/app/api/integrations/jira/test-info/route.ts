import { baseDb as db } from "@/lib/db";
import {
  collectPanelSessionIds,
  collectPanelTestRunIds,
  getTestRunDisplayItems,
  panelIssueLinkSelect,
  panelIssueWhere,
  summarizeTestRuns,
} from "~/lib/services/jiraForgePanel";
import { authenticateForgeIntegration } from "~/lib/services/forge-jira-auth";
import { getLatestTestResultsByCase } from "~/lib/services/latestTestResults";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { NextRequest, NextResponse } from "next/server";

// How many executions the panel's result-history table shows per case.
const JIRA_PANEL_HISTORY_LIMIT = 5;

// Resolve a case's Jira-panel-enabled template fields into display-ready
// values, mirroring how the repository case table renders each field type:
// Dropdown/Multi-Select resolve to their option names + icons, Checkbox to a
// boolean, Text Long (TipTap JSON) to plain text, everything else passes
// through as a string.
function resolveJiraPanelFields(testCase: any) {
  const assignments = testCase.template?.caseFields || [];

  return assignments.map((assignment: any) => {
    const caseField = assignment.caseField;
    const fieldType = caseField.type?.type ?? null;
    const rawValue = testCase.caseFieldValues?.find(
      (v: any) => v.fieldId === caseField.id
    )?.value;

    let value: unknown = null;
    let options:
      | { name: string; icon: string | null; iconColor: string | null }[]
      | undefined;
    let steps: unknown[] | undefined;

    if (fieldType === "Steps") {
      // Steps come from the case's steps relation. Shared groups are resolved
      // inline (group name + its items); placeholders whose group was deleted
      // are dropped, matching the repository table.
      steps = (testCase.steps || [])
        .map((s: any) => {
          if (s.sharedStepGroupId) {
            if (!s.sharedStepGroup || s.sharedStepGroup.isDeleted) return null;
            return {
              group: s.sharedStepGroup.name,
              items: (s.sharedStepGroup.items || []).map((item: any) => ({
                step: extractTextFromNode(item.step),
                expected: extractTextFromNode(item.expectedResult),
              })),
            };
          }
          return {
            step: extractTextFromNode(s.step),
            expected: extractTextFromNode(s.expectedResult),
          };
        })
        .filter(Boolean);
    } else if (fieldType === "Dropdown" || fieldType === "Multi-Select") {
      const selectedIds =
        rawValue === null || rawValue === undefined
          ? []
          : (Array.isArray(rawValue) ? rawValue : [rawValue]).map((v: any) =>
              Number(v)
            );
      options = selectedIds
        .map(
          (optionId) =>
            caseField.fieldOptions.find(
              (fo: any) => fo.fieldOption.id === optionId
            )?.fieldOption
        )
        .filter(Boolean)
        .map((fieldOption: any) => ({
          name: fieldOption.name,
          icon: fieldOption.icon?.name || null,
          iconColor: fieldOption.iconColor?.value || null,
        }));
    } else if (fieldType === "Checkbox") {
      value = Boolean(rawValue);
    } else if (fieldType === "Text Long") {
      value =
        rawValue === null || rawValue === undefined
          ? null
          : extractTextFromNode(rawValue);
    } else if (rawValue !== null && rawValue !== undefined) {
      value =
        typeof rawValue === "object"
          ? JSON.stringify(rawValue)
          : rawValue.toString();
    }

    return {
      id: caseField.id,
      label: caseField.displayName,
      type: fieldType,
      value,
      ...(options ? { options } : {}),
      ...(steps ? { steps } : {}),
    };
  });
}

const PANEL_STATE_SELECT = {
  select: {
    name: true,
    icon: {
      select: {
        name: true,
      },
    },
    color: {
      select: {
        value: true,
      },
    },
  },
} as const;

// Status counts for one run's cases, in case order (like TestRunCasesSummary).
function summarizeDisplayItems(displayItems: any[]) {
  const statusCounts: Record<string, { name: string; count: number }> = {};
  displayItems.forEach((item) => {
    const statusName = item.status?.name || "Untested";
    if (!statusCounts[statusName]) {
      statusCounts[statusName] = { name: statusName, count: 0 };
    }
    statusCounts[statusName].count += 1;
  });

  return {
    total: displayItems.length,
    passedCount: statusCounts["Passed"]?.count ?? 0,
    summaryText: Object.values(statusCounts)
      .map((status) => `${status.count} ${status.name}`)
      .join(", "),
  };
}

// Linked runs in panel order, each loaded once. With lazy run cases the row
// carries only the collapsed-row totals (counted in SQL); otherwise it also
// carries every case's status-bar segment, as older panel builds expect.
async function loadPanelTestRuns(testRunIds: number[], lazyRunCases: boolean) {
  if (testRunIds.length === 0) return [];

  const [testRuns, caseData] = await Promise.all([
    db.testRuns.findMany({
      where: { id: { in: testRunIds } },
      select: {
        id: true,
        name: true,
        isDeleted: true,
        state: PANEL_STATE_SELECT,
        project: { select: { id: true } },
      },
    }),
    lazyRunCases
      ? summarizeTestRuns(testRunIds).then((summaries) => ({
          summaries,
          itemsByRun: null,
        }))
      : getTestRunDisplayItems(testRunIds).then((itemsByRun) => ({
          summaries: null,
          itemsByRun,
        })),
  ]);
  const runsById = new Map(testRuns.map((testRun) => [testRun.id, testRun]));

  return testRunIds.flatMap((testRunId) => {
    const testRun = runsById.get(testRunId);
    if (!testRun) return [];

    const displayItems = caseData.itemsByRun?.get(testRunId) ?? [];
    const summary = caseData.summaries
      ? (caseData.summaries.get(testRunId) ?? {
          total: 0,
          passedCount: 0,
          summaryText: "",
        })
      : summarizeDisplayItems(displayItems);

    return [
      {
        id: testRun.id,
        name: testRun.name,
        status: testRun.state.name,
        statusIcon: testRun.state.icon?.name,
        statusColor: testRun.state.color?.value,
        total: summary.total,
        passedCount: summary.passedCount,
        ...(lazyRunCases ? {} : { displayItems }),
        summaryText: summary.summaryText,
        projectId: testRun.project.id,
        isDeleted: testRun.isDeleted,
      },
    ];
  });
}

// Linked sessions in panel order, each loaded once with its live results.
async function loadPanelSessions(sessionIds: number[]) {
  if (sessionIds.length === 0) return [];

  const sessions = await db.sessions.findMany({
    where: { id: { in: sessionIds } },
    select: {
      id: true,
      name: true,
      estimate: true,
      isDeleted: true,
      state: PANEL_STATE_SELECT,
      project: { select: { id: true } },
      sessionResults: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          elapsed: true,
          createdAt: true,
          status: {
            include: {
              color: true,
            },
          },
        },
      },
    },
  });
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session])
  );

  return sessionIds
    .map((sessionId) => sessionsById.get(sessionId))
    .filter(Boolean)
    .map((session: any) => {
      // Process session results similar to SessionResultsSummary
      const sessionResults = session.sessionResults || [];

      // Calculate total elapsed time
      const totalElapsed = sessionResults.reduce(
        (acc: number, result: any) => acc + (result.elapsed || 0),
        0
      );
      const hasElapsed = totalElapsed > 0;

      // Count statuses for summary text
      const statusCounts: Record<string, { name: string; count: number }> = {};
      sessionResults.forEach((result: any) => {
        const statusName = result.status?.name || "Recorded";
        if (!statusCounts[statusName]) {
          statusCounts[statusName] = { name: statusName, count: 0 };
        }
        statusCounts[statusName].count += 1;
      });

      // Generate summary text from status counts
      const summaryText = Object.values(statusCounts)
        .map((status) => `${status.count} ${status.name}`)
        .join(", ");

      return {
        id: session.id,
        name: session.name,
        status: session.state.name,
        statusIcon: session.state.icon?.name,
        statusColor: session.state.color?.value,
        total: sessionResults.length,
        totalElapsed: totalElapsed,
        hasElapsed: hasElapsed,
        estimate: session.estimate,
        displayItems: sessionResults.map((result: any) => ({
          id: result.id,
          status: result.status,
          elapsed: result.elapsed,
          createdAt: result.createdAt,
        })),
        summaryText: summaryText,
        projectId: session.project.id,
        isDeleted: session.isDeleted,
      };
    });
}

// The case fields each template opts into the Jira panel (per-template toggle
// in Templates & Fields), plus the values and steps those fields render.
// Loaded once per distinct template, not once per case: an issue can link
// hundreds of cases that all share one template.
async function attachPanelFields(cases: any[]) {
  const templateIds = [
    ...new Set(
      cases
        .map((testCase) => testCase.templateId)
        .filter((id): id is number => id != null)
    ),
  ];
  const templates = templateIds.length
    ? await db.templates.findMany({
        where: { id: { in: templateIds } },
        select: {
          id: true,
          caseFields: {
            where: {
              jiraPanelEnabled: true,
              caseField: { isEnabled: true, isDeleted: false },
            },
            orderBy: { order: "asc" },
            select: {
              caseField: {
                select: {
                  id: true,
                  displayName: true,
                  type: { select: { type: true } },
                  fieldOptions: {
                    select: {
                      fieldOption: {
                        select: {
                          id: true,
                          name: true,
                          icon: { select: { name: true } },
                          iconColor: { select: { value: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
    : [];
  const templatesById = new Map(
    templates.map((template) => [template.id, template])
  );

  const panelFieldsOf = (testCase: any) =>
    templatesById.get(testCase.templateId)?.caseFields ?? [];
  const casesWithFields = cases.filter(
    (testCase) => panelFieldsOf(testCase).length > 0
  );
  // Steps live in their own relation, not CaseFieldValues; needed only when
  // the template's Steps field is panel-enabled.
  const casesWithSteps = casesWithFields.filter((testCase) =>
    panelFieldsOf(testCase).some(
      (assignment: any) => assignment.caseField.type?.type === "Steps"
    )
  );
  const panelFieldIds = [
    ...new Set(
      templates.flatMap((template) =>
        template.caseFields.map((assignment) => assignment.caseField.id)
      )
    ),
  ];

  const [values, steps] = await Promise.all([
    casesWithFields.length
      ? db.caseFieldValues.findMany({
          where: {
            testCaseId: { in: casesWithFields.map((testCase) => testCase.id) },
            fieldId: { in: panelFieldIds },
          },
          select: {
            testCaseId: true,
            fieldId: true,
            value: true,
          },
        })
      : [],
    casesWithSteps.length
      ? db.steps.findMany({
          where: {
            testCaseId: { in: casesWithSteps.map((testCase) => testCase.id) },
            isDeleted: false,
          },
          orderBy: { order: "asc" },
          select: {
            testCaseId: true,
            id: true,
            step: true,
            expectedResult: true,
            order: true,
            sharedStepGroupId: true,
            sharedStepGroup: {
              select: {
                name: true,
                isDeleted: true,
                items: {
                  orderBy: { order: "asc" },
                  select: {
                    step: true,
                    expectedResult: true,
                  },
                },
              },
            },
          },
        })
      : [],
  ]);

  const valuesByCase = Map.groupBy(values, (value) => value.testCaseId);
  const stepsByCase = Map.groupBy(steps, (step) => step.testCaseId);

  return cases.map((testCase) => ({
    ...testCase,
    template: templatesById.get(testCase.templateId) ?? null,
    caseFieldValues: valuesByCase.get(testCase.id) ?? [],
    steps: stepsByCase.get(testCase.id) ?? [],
  }));
}

// Linked cases in panel order with their panel fields, latest result and
// result history. Deleted cases are kept only while they have live results.
async function loadPanelTestCases(
  repositoryCases: any[],
  firstStatus: { name: string; color: { value: string } | null } | null
) {
  // A soft-deleted case only keeps its Jira link because the row survives
  // the delete. With no live results it has nothing to show in the panel,
  // so it is dropped. With results it stays so the execution history
  // remains attached to the issue; the panel renders it as deleted.
  const deletedCaseIds = [
    ...new Set(
      repositoryCases
        .filter((testCase: any) => testCase.isDeleted)
        .map((testCase: any) => testCase.id)
    ),
  ];
  const deletedCasesWithLiveResults = new Set(
    deletedCaseIds.length
      ? (
          await db.testRunCases.findMany({
            where: {
              repositoryCaseId: { in: deletedCaseIds },
              results: { some: { isDeleted: false } },
            },
            select: { repositoryCaseId: true },
          })
        ).map((runCase) => runCase.repositoryCaseId)
      : []
  );
  const visibleCases = await attachPanelFields(
    repositoryCases.filter(
      (testCase: any) =>
        !testCase.isDeleted || deletedCasesWithLiveResults.has(testCase.id)
    )
  );

  // Latest executions per case, across BOTH sources. The panel used to derive
  // these from the loaded `testRuns` relation alone, which only ever holds
  // TestRunResults -- manual executions. Automated runs write to
  // JUnitTestResult, so an automated case reported whatever manual result it
  // last had, often years stale, and never showed a CI failure at all.
  // getLatestTestResultsByCase ranks both tables together; it is the same
  // service the repository table's Latest Results column uses, so the panel
  // and the app now agree by construction.
  const visibleCaseIds = visibleCases.map((testCase: any) => testCase.id);
  const latestByCase = await getLatestTestResultsByCase(
    visibleCaseIds,
    JIRA_PANEL_HISTORY_LIMIT
  );

  // `resultId` is unique only WITHIN a source, so the two id sets are
  // hydrated separately and never merged into one lookup.
  const executions = [...latestByCase.values()].flat();
  const manualIds = executions
    .filter((e) => e.executionSource === "manual")
    .map((e) => e.resultId);
  const automatedIds = executions
    .filter((e) => e.executionSource === "automated")
    .map((e) => e.resultId);

  const [manualRows, automatedRows] = await Promise.all([
    manualIds.length
      ? db.testRunResults.findMany({
          where: { id: { in: manualIds } },
          select: {
            id: true,
            executedAt: true,
            editedAt: true,
            elapsed: true,
            testRunCaseVersion: true,
            attempt: true,
            executedBy: { select: { id: true, name: true } },
            editedBy: { select: { id: true, name: true } },
            testRunCase: {
              select: {
                id: true,
                testRun: {
                  select: { id: true, name: true, isCompleted: true },
                },
              },
            },
          },
        })
      : [],
    automatedIds.length
      ? db.jUnitTestResult.findMany({
          where: { id: { in: automatedIds } },
          select: {
            id: true,
            executedAt: true,
            time: true,
            testSuite: {
              select: {
                testRun: {
                  select: { id: true, name: true, isCompleted: true },
                },
              },
            },
          },
        })
      : [],
  ]);
  const manualById = new Map(manualRows.map((r: any) => [r.id, r]));
  const automatedById = new Map(automatedRows.map((r: any) => [r.id, r]));

  const formattedTestCases = visibleCases.map((testCase: any) => {
    // Already ranked newest-first across manual and automated sources.
    const caseExecutions = latestByCase.get(testCase.id) ?? [];
    const latestResult = caseExecutions[0] ?? null;

    return {
      id: testCase.id,
      name: testCase.name,
      // The panel draws the manual/automated icon from this. It is a real
      // column, not inferable from `source`: an imported case stays
      // source=MANUAL after automation is attached to it.
      automated: testCase.automated ?? false,
      status: testCase.state.name,
      statusIcon: testCase.state.icon?.name,
      statusColor: testCase.state.color?.value,
      projectId: testCase.project.id,
      isDeleted: testCase.isDeleted,
      isArchived: testCase.isArchived,
      source: testCase.source,
      estimate: testCase.estimate,
      forecastManual: testCase.forecastManual,
      forecastAutomated: testCase.forecastAutomated,
      // Use latest result if available, otherwise use the first status from database
      lastResult: latestResult
        ? latestResult.statusName
        : firstStatus?.name || null,
      lastResultColor: latestResult
        ? latestResult.statusColor
        : firstStatus?.color?.value || null,
      // Case fields opted into the Jira panel via the template's per-field
      // toggle, resolved server-side so the panel just renders them.
      fields: resolveJiraPanelFields(testCase),
      // Same merged ranking as `lastResult`, so the headline and the table
      // below it can never disagree. Automated rows carry no executing user,
      // no edit trail and no per-case version -- CI wrote them -- so those
      // columns stay empty rather than borrowing a manual result's values.
      resultHistory: caseExecutions.map((execution) => {
        if (execution.executionSource === "automated") {
          const detail = automatedById.get(execution.resultId);
          const testRun = detail?.testSuite?.testRun;

          return {
            resultId: execution.resultId,
            testRunId: testRun?.id ?? execution.testRunId,
            testRunName: testRun?.name || "Automated Run",
            testRunIsCompleted: testRun?.isCompleted || false,
            testRunCaseId: null,
            status: execution.statusName,
            statusColor: execution.statusColor,
            executedAt: execution.executedAt,
            executedBy: { id: null, name: "Automation" },
            editedAt: null,
            editedBy: null,
            // JUnit records seconds; the panel renders milliseconds.
            elapsed:
              detail?.time != null ? Math.round(detail.time * 1000) : null,
            testRunCaseVersion: null,
            attempt: null,
          };
        }

        const detail = manualById.get(execution.resultId);
        const testRun = detail?.testRunCase?.testRun;

        return {
          resultId: execution.resultId,
          testRunId: testRun?.id ?? execution.testRunId,
          testRunName: testRun?.name || "Unknown Test Run",
          testRunIsCompleted: testRun?.isCompleted || false,
          testRunCaseId: detail?.testRunCase?.id ?? null,
          status: execution.statusName,
          statusColor: execution.statusColor,
          executedAt: execution.executedAt,
          executedBy: {
            id: detail?.executedBy?.id,
            name: detail?.executedBy?.name || "Unknown",
          },
          editedAt: detail?.editedAt ?? null,
          editedBy: detail?.editedBy
            ? { id: detail.editedBy.id, name: detail.editedBy.name }
            : null,
          elapsed: detail?.elapsed ?? null,
          testRunCaseVersion: detail?.testRunCaseVersion || 1,
          attempt: detail?.attempt || 1,
        };
      }),
    };
  });

  return formattedTestCases;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const issueKey = searchParams.get("issueKey");
  const issueId = searchParams.get("issueId");

  if (!issueKey && !issueId) {
    return NextResponse.json(
      { error: "issueKey or issueId is required" },
      { status: 400 }
    );
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Forge-Api-Key",
  };

  try {
    const authenticatedIntegration = await authenticateForgeIntegration(
      request.headers.get("X-Forge-Api-Key")
    );

    if (!authenticatedIntegration) {
      return NextResponse.json(
        {
          error:
            "Invalid or missing API key. Configure a Forge API key in your Jira integration settings.",
        },
        { status: 401, headers }
      );
    }

    // Panel builds from before lazy run cases get every run's per-case bar
    // inline; current builds fetch it from test-run-cases when a run expands.
    const lazyRunCases = searchParams.get("runCases") === "lazy";

    // Get the first status (typically "Untested" or similar) for test cases with no results
    const firstStatus = await db.status.findFirst({
      where: {
        isDeleted: false,
        isEnabled: true,
      },
      orderBy: {
        order: "asc",
      },
      include: {
        color: true,
      },
    });

    // Find ALL issues with matching key (there may be duplicates). Runs and
    // sessions come back as ids only: one run can be reached through many
    // links, so each is loaded once below rather than once per link.
    let allMatchingIssues;

    try {
      allMatchingIssues = await db.issue.findMany({
        where: panelIssueWhere(issueKey, issueId),
        select: {
          id: true,
          caseIssues: {
            select: {
              case: {
                include: {
                  state: {
                    select: {
                      name: true,
                      icon: {
                        select: {
                          name: true,
                        },
                      },
                      color: {
                        select: {
                          value: true,
                        },
                      },
                    },
                  },
                  project: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          },
          ...panelIssueLinkSelect,
        },
      });
    } catch (dbError) {
      console.error(
        "Forge test-info DB error:",
        dbError instanceof Error ? dbError.message : dbError
      );
      return NextResponse.json(
        { error: "Database query failed" },
        { status: 500, headers }
      );
    }

    if (allMatchingIssues.length === 0) {
      return NextResponse.json(
        {
          testCases: [],
          sessions: [],
          testRuns: [],
        },
        { headers }
      );
    }

    const repositoryCases = allMatchingIssues.flatMap((i) =>
      i.caseIssues.map((ci) => ci.case)
    );
    const testRunIds = collectPanelTestRunIds(allMatchingIssues);
    const sessionIds = collectPanelSessionIds(allMatchingIssues);

    // Cases, runs and sessions are independent, so they load concurrently.
    const [formattedTestCases, formattedTestRuns, formattedSessions] =
      await Promise.all([
        loadPanelTestCases(repositoryCases, firstStatus),
        loadPanelTestRuns(testRunIds, lazyRunCases),
        loadPanelSessions(sessionIds),
      ]);

    return NextResponse.json(
      {
        testCases: formattedTestCases,
        sessions: formattedSessions,
        testRuns: formattedTestRuns,
      },
      { headers }
    );
  } catch (error) {
    console.error("Error fetching test info:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Forge-Api-Key",
    },
  });
}
