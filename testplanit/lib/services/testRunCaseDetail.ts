import { baseDb } from "~/lib/db";
import type {
  RepositoryCasesGetPayload,
  RepositoryCasesSelect,
} from "~/zenstack/input";

/**
 * Full case-detail shape for the test-run results panel (the sheet driven by
 * TestRunCaseDetails, plus the run page's own "did the next case load yet"
 * check). Previously fetched via the ZenStack policy-enforced client hook in
 * both places independently -- ~10 nested relations (steps, caseFieldValues,
 * caseTags, caseIssues, testRuns+results, template+caseFields+fieldOptions),
 * plus `project`/`folder`/`creator` full-object includes nobody read, made
 * ZenStack re-inline the `Projects` `@@allow('read', ...)` ladder as a
 * correlated per-row subquery at every relation-filter site: mean 10.6s / max
 * 65s in prod pg_stat_statements (170KB SQL, 481 "Projects" references) --
 * the same pathology as testplanit-acl-overhead-investigation's Tags
 * recurrence. `project`/`folder`/`creator` are dropped here: grepping every
 * consumer of this shape found no read of any of the three.
 *
 * This runs off `baseDb` (no policy plugin) after a single project-access
 * check in the route, same recipe as app/api/tags/for-project/route.ts.
 */
export const testRunCaseDetailSelect = {
  id: true,
  name: true,
  estimate: true,
  forecastManual: true,
  forecastAutomated: true,
  currentVersion: true,
  state: {
    select: {
      id: true,
      name: true,
      icon: { select: { name: true } },
      color: { select: { value: true } },
    },
  },
  template: {
    select: {
      id: true,
      templateName: true,
      caseFields: {
        select: {
          caseFieldId: true,
          order: true,
          caseField: {
            select: {
              id: true,
              defaultValue: true,
              displayName: true,
              type: { select: { type: true } },
              fieldOptions: {
                select: {
                  fieldOption: {
                    select: {
                      id: true,
                      icon: true,
                      iconColor: true,
                      name: true,
                      order: true,
                    },
                  },
                },
                orderBy: { fieldOption: { order: "asc" } },
              },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  },
  caseFieldValues: {
    select: {
      id: true,
      value: true,
      fieldId: true,
      field: {
        select: {
          id: true,
          displayName: true,
          type: { select: { type: true } },
        },
      },
    },
    where: { field: { isEnabled: true, isDeleted: false } },
  },
  attachments: {
    orderBy: { createdAt: "desc" },
    where: { isDeleted: false },
    select: {
      id: true,
      name: true,
      url: true,
      createdAt: true,
      mimeType: true,
      size: true,
      note: true,
      createdBy: { select: { name: true, id: true } },
      testCaseId: true,
      isDeleted: true,
      deletedAt: true,
      createdById: true,
      sessionId: true,
      sessionResultsId: true,
      testRunsId: true,
      testRunResultsId: true,
      testRunStepResultId: true,
      junitTestResultId: true,
    },
  },
  steps: {
    where: { isDeleted: false },
    orderBy: { order: "asc" },
    select: {
      id: true,
      step: true,
      testCaseId: true,
      order: true,
      expectedResult: true,
      isDeleted: true,
      deletedAt: true,
      sharedStepGroupId: true,
      sharedStepGroup: {
        select: {
          id: true,
          name: true,
          projectId: true,
          isDeleted: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
          createdById: true,
        },
      },
    },
  },
  caseTags: {
    where: { tag: { isDeleted: false } },
    orderBy: { tag: { name: "asc" } },
    select: {
      tag: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  caseIssues: {
    include: {
      issue: {
        include: {
          integration: {
            select: {
              id: true,
              provider: true,
              name: true,
            },
          },
        },
      },
    },
  },
  source: true,
  automated: true,
  hasParameters: true,
} satisfies RepositoryCasesSelect;

/**
 * `testRuns` is scoped to a single run and so depends on the caller's
 * `testRunId` -- kept out of the `satisfies`-checked base shape above (which
 * has no `testRunId` in scope) and merged in per-call.
 */
function selectFor(testRunId: number | undefined) {
  return {
    ...testRunCaseDetailSelect,
    testRuns: {
      where: { testRunId: testRunId ?? undefined },
      select: {
        id: true,
        testRun: {
          select: {
            id: true,
            name: true,
            milestone: {
              select: {
                name: true,
                completedAt: true,
              },
            },
            configuration: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        results: {
          select: {
            id: true,
            status: {
              select: {
                name: true,
                color: { select: { value: true } },
              },
            },
            executedBy: { select: { id: true, name: true } },
            editedBy: { select: { id: true, name: true } },
            editedAt: true,
            executedAt: true,
            elapsed: true,
            attempt: true,
          },
        },
        assignedTo: { select: { id: true, name: true } },
      },
    },
  } satisfies RepositoryCasesSelect;
}

export type TestRunCaseDetail = RepositoryCasesGetPayload<{
  select: ReturnType<typeof selectFor>;
}>;

/**
 * Fetches one case's full result-panel detail. Caller is responsible for the
 * project-access check (the route resolves the case's `projectId` and checks
 * it against `resolveViewerProjectScope` before calling this).
 */
export async function getTestRunCaseDetail(
  caseId: number,
  testRunId: number | undefined
): Promise<TestRunCaseDetail | null> {
  return baseDb.repositoryCases.findFirst({
    where: { id: caseId, isDeleted: false },
    select: selectFor(testRunId),
  }) as Promise<TestRunCaseDetail | null>;
}
