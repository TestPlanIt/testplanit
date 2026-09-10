import { stripEphemeralHash } from "~/lib/services/automatedTestName";
import type { AutomationPlan, AutomationPlanCase } from "./types";

/**
 * The plan a CI job pulls after TestPlanIt dispatches it: the run's automated
 * cases with every identifier a shim script might match on. Selection is
 * decided here, once, so the dispatch payload never has to carry case ids.
 *
 * "Automated cases in the run" = live TestRunCases rows whose repository
 * case is live and flagged `automated`, optionally intersected with the ids
 * an ad-hoc execution asked for. Ordered by the run's own case order.
 */

export type PlanDb = {
  testRuns: {
    findFirst: (args: {
      where: { id: number; isDeleted: boolean };
      select: {
        id: true;
        projectId: true;
        name: true;
        testRunType: true;
        configuration: { select: { name: true } };
        milestone: { select: { name: true } };
      };
    }) => Promise<{
      id: number;
      projectId: number;
      name: string;
      testRunType: string;
      configuration: { name: string } | null;
      milestone: { name: string } | null;
    } | null>;
  };
  testRunCases: {
    findMany: (args: {
      where: {
        testRunId: number;
        isDeleted: boolean;
        repositoryCase: {
          isDeleted: boolean;
          automated: boolean;
          id?: { in: number[] };
        };
      };
      orderBy: Array<{ order: "asc" } | { id: "asc" }>;
      select: {
        repositoryCase: {
          select: {
            id: true;
            name: true;
            className: true;
            source: true;
            automated: true;
            caseTags: { select: { tag: { select: { name: true } } } };
          };
        };
      };
    }) => Promise<
      Array<{
        repositoryCase: {
          id: number;
          name: string;
          className: string | null;
          source: string;
          automated: boolean;
          caseTags: Array<{ tag: { name: string } }>;
        };
      }>
    >;
  };
};

export interface BuildPlanOptions {
  /** Ad-hoc subset; empty or undefined = every automated case in the run. */
  requestedCaseIds?: number[];
  executionId?: number | null;
  ref?: string | null;
  now?: () => Date;
}

export function selectorFor(testCase: {
  id: number;
  name: string;
  className: string | null;
}): AutomationPlanCase["selector"] {
  const name = stripEphemeralHash(testCase.name);
  const className = testCase.className?.trim() ? testCase.className : null;
  return {
    name,
    className,
    fullName: className ? `${className}.${name}` : name,
    idTokens: {
      brackets: `[${testCase.id}]`,
      c: `C${testCase.id}`,
      tc: `TC${testCase.id}`,
    },
  };
}

/** Returns null when the run does not exist (the caller decides on 404). */
export async function buildAutomationPlan(
  db: PlanDb,
  runId: number,
  options: BuildPlanOptions = {}
): Promise<AutomationPlan | null> {
  const run = await db.testRuns.findFirst({
    where: { id: runId, isDeleted: false },
    select: {
      id: true,
      projectId: true,
      name: true,
      testRunType: true,
      configuration: { select: { name: true } },
      milestone: { select: { name: true } },
    },
  });
  if (!run) return null;

  const requested = (options.requestedCaseIds ?? []).filter(
    (id) => Number.isInteger(id) && id > 0
  );
  const rows = await db.testRunCases.findMany({
    where: {
      testRunId: runId,
      isDeleted: false,
      repositoryCase: {
        isDeleted: false,
        automated: true,
        ...(requested.length > 0 ? { id: { in: requested } } : {}),
      },
    },
    orderBy: [{ order: "asc" }, { id: "asc" }],
    select: {
      repositoryCase: {
        select: {
          id: true,
          name: true,
          className: true,
          source: true,
          automated: true,
          caseTags: { select: { tag: { select: { name: true } } } },
        },
      },
    },
  });

  const cases: AutomationPlanCase[] = rows.map(({ repositoryCase: c }) => ({
    id: c.id,
    title: c.name,
    className: c.className,
    source: c.source,
    automated: c.automated,
    selector: selectorFor(c),
    tags: c.caseTags.map((t) => t.tag.name),
  }));

  return {
    runId: run.id,
    projectId: run.projectId,
    executionId: options.executionId ?? null,
    ref: options.ref ?? null,
    run: {
      name: run.name,
      testRunType: run.testRunType,
      configuration: run.configuration?.name ?? null,
      milestone: run.milestone?.name ?? null,
    },
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    cases,
    totals: { cases: cases.length },
  };
}

/** Count only — used by the execute route to refuse an empty dispatch. */
export async function countAutomatedCasesInRun(
  db: PlanDb,
  runId: number,
  requestedCaseIds?: number[]
): Promise<number> {
  const plan = await buildAutomationPlan(db, runId, { requestedCaseIds });
  return plan?.totals.cases ?? 0;
}
