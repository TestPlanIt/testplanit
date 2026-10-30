/**
 * Live-DB smoke sweep of every report-builder handler: each report type,
 * every dimension and metric a generic report advertises (singly, and
 * paired with the date dimension), every dimension's value lookup, and
 * every pre-built report in its default and non-default shapes, project-
 * and cross-project. Each call must return 200 with a well-formed body.
 *
 * Why live: the handlers' queries go through ZenStack, which validates
 * relation keys and filters at RUN time — a renamed relation inside a
 * where clause compiles and passes mocked unit tests, then fails on the
 * first real request (the #721 `testRuns` -> `testRunCases` miss in the
 * Test Case dimension was found exactly this way).
 *
 * Opt-in: RUN_DB_INTEGRATION=1 + DATABASE_URL pointing at a seeded
 * database that has at least one ADMIN user. Read-only. Failures are
 * collected and reported together so one bug does not hide the next.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Authenticate as a real ADMIN from the database: the session is mocked,
// everything after it (user lookup, admin check, project scope) is real.
const session = vi.hoisted(() => ({
  current: null as null | { user: { id: string; access: string } },
}));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => session.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

type Failure = { label: string; status: number; detail: string };

// Error messages the handlers use for a metric/dimension pairing their
// rules forbid; such a 400 is recorded as a constraint, not a failure.
const CONSTRAINT_400 = /can only be used with|cannot be combined with/i;
const constraints: string[] = [];

const BASE = "http://localhost/api/report-builder";
const post = (path: string, body: unknown) =>
  new NextRequest(`${BASE}/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const get = (path: string, query: Record<string, string | number> = {}) => {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query))
    url.searchParams.set(k, String(v));
  return new NextRequest(url);
};

/** Run one call; record a failure unless it returns 200 with a body the
 *  shape check accepts. Returns the parsed body (or null). */
async function check(
  failures: Failure[],
  label: string,
  run: () => Promise<Response>,
  shape: (body: any) => string | null = () => null,
  okStatuses: number[] = [200]
): Promise<any> {
  let res: Response;
  try {
    res = await run();
  } catch (e) {
    failures.push({
      label,
      status: -1,
      detail: `threw: ${(e as Error).message}`,
    });
    return null;
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 400 && CONSTRAINT_400.test(String(body?.error ?? ""))) {
    // The handler refused a combination its own rules forbid (a metric
    // bound to one dimension) — a constraint, not a defect.
    constraints.push(`${label} — ${body.error}`);
    return null;
  }
  if (!okStatuses.includes(res.status)) {
    failures.push({
      label,
      status: res.status,
      detail: String(body?.error ?? body?.message ?? "").slice(0, 300),
    });
    return null;
  }
  const problem = res.status === 200 ? shape(body) : null;
  if (problem) failures.push({ label, status: res.status, detail: problem });
  return body;
}

const rowsShape = (key: string) => (body: any) =>
  Array.isArray(body?.[key]) ? null : `missing ${key}[]`;

describeIntegration("report handlers: live smoke sweep", () => {
  it(
    "every report type, dimension, metric and lookup answers 200 with a well-formed body",
    async () => {
      const { sql } = await import("kysely");
      const { baseDb } = await import("~/lib/db");
      const q = async <T>(query: any): Promise<T[]> =>
        (await query.execute(baseDb.$qb)).rows;

      // ---- discover the data ------------------------------------------
      const [admin] = await q<{ id: string; access: string }>(
        sql`SELECT id, access FROM "User" WHERE access = 'ADMIN' AND "isDeleted" = false ORDER BY "createdAt" LIMIT 1`
      );
      expect(admin, "an ADMIN user to run as").toBeTruthy();
      session.current = { user: { id: admin.id, access: admin.access } };

      const projects = await q<{
        id: number;
        cases: number;
        requirements: boolean;
      }>(
        sql`SELECT p.id, p."requirementsEnabled" AS requirements,
                   (SELECT count(*) FROM "RepositoryCases" c WHERE c."projectId" = p.id AND c."isDeleted" = false) AS cases
            FROM "Projects" p WHERE p."isDeleted" = false ORDER BY cases DESC`
      );
      const bigProject = projects[0].id;
      const smallProject =
        projects
          .filter((p) => Number(p.cases) > 0 && Number(p.cases) < 500)
          .at(-1)?.id ?? projects.at(-1)!.id;
      const requirementProjects = projects
        .filter((p) => p.requirements)
        .map((p) => p.id);
      const snapshots = await q<{ id: number; projectId: number }>(
        sql`SELECT id, "projectId" FROM "RequirementTraceabilitySnapshot" WHERE "isDeleted" = false ORDER BY "capturedAt"`
      );

      const failures: Failure[] = [];
      let calls = 0;
      const report: string[] = [];
      const tick = async (
        label: string,
        run: () => Promise<Response>,
        shape?: (b: any) => string | null,
        ok?: number[]
      ) => {
        calls++;
        const t0 = performance.now();
        const body = await check(failures, label, run, shape, ok);
        report.push(
          `${Math.round(performance.now() - t0)
            .toString()
            .padStart(6)}ms  ${label}`
        );
        return body;
      };

      // ---- generic (dimension x metric) reports ----------------------
      const api = await import("~/utils/reportApiUtils");
      const ru = await import("~/utils/reportUtils");
      const llm = await import("~/utils/llmUsageReportUtils");
      const generic: Array<{ type: string; config: any; projectId?: number }> =
        [];
      const addGeneric = (
        base: string,
        dims: (x: boolean) => any,
        mets: (x: boolean) => any,
        opts: { crossOnly?: boolean; projectOnly?: boolean } = {}
      ) => {
        if (!opts.projectOnly) {
          generic.push({
            type: `cross-project-${base}`,
            config: {
              reportType: `cross-project-${base}`,
              requiresProjectId: false,
              requiresAdmin: true,
              createDimensionRegistry: () => dims(false),
              createMetricRegistry: () => mets(false),
            },
          });
        }
        if (!opts.crossOnly) {
          generic.push({
            type: base,
            projectId: bigProject,
            config: {
              reportType: base,
              requiresProjectId: true,
              requiresAdmin: false,
              createDimensionRegistry: () => dims(true),
              createMetricRegistry: () => mets(true),
            },
          });
        }
      };
      addGeneric(
        "test-execution",
        ru.createTestExecutionDimensionRegistry,
        ru.createTestExecutionMetricRegistry
      );
      addGeneric(
        "repository-stats",
        ru.createRepositoryStatsDimensionRegistry,
        ru.createRepositoryStatsMetricRegistry
      );
      addGeneric(
        "user-engagement",
        ru.createUserEngagementDimensionRegistry,
        ru.createUserEngagementMetricRegistry
      );
      addGeneric(
        "issue-tracking",
        ru.createIssueTrackingDimensionRegistry,
        ru.createIssueTrackingMetricRegistry
      );
      addGeneric(
        "llm-usage",
        llm.createLlmUsageDimensionRegistry,
        llm.createLlmUsageMetricRegistry,
        { crossOnly: true }
      );

      for (const g of generic) {
        const scope: Record<string, number> = g.projectId
          ? { projectId: g.projectId }
          : {};
        const meta = await tick(
          `${g.type}: metadata`,
          () => api.handleReportGET(get(g.type, scope), g.config),
          (b) =>
            Array.isArray(b?.dimensions) && Array.isArray(b?.metrics)
              ? null
              : "missing dimensions/metrics"
        );
        if (!meta) continue;
        const dimIds: string[] = meta.dimensions.map((d: any) => d.id);
        const metricIds: string[] = meta.metrics.map((m: any) => m.id);

        for (const dim of dimIds) {
          // Every metric, one at a time, by this one dimension.
          for (const metric of metricIds) {
            await tick(
              `${g.type}: ${dim} x ${metric}`,
              () =>
                api.handleReportPOST(
                  post(g.type, {
                    ...scope,
                    dimensions: [dim],
                    metrics: [metric],
                  }),
                  g.config
                ),
              (b) =>
                Array.isArray(b?.results) && typeof b?.totalCount === "number"
                  ? null
                  : "missing results/totalCount"
            );
          }
          // Paired with the date dimension, grouped by month.
          if (dim !== "date" && dimIds.includes("date")) {
            await tick(
              `${g.type}: ${dim} x date(monthly) x [${metricIds[0]}]`,
              () =>
                api.handleReportPOST(
                  post(g.type, {
                    ...scope,
                    dimensions: [dim, "date"],
                    metrics: [metricIds[0]],
                    dateGrouping: "monthly",
                    page: 1,
                    pageSize: 50,
                  }),
                  g.config
                ),
              rowsShape("results")
            );
          }
          // The picker's value lookup, then the label resolution for the
          // first values it returned.
          const values = await tick(
            `${g.type}: values of ${dim}`,
            () =>
              api.handleReportGET(
                get(g.type, { ...scope, dimensionId: dim, pageSize: 20 }),
                g.config
              ),
            (b) =>
              Array.isArray(b?.values ?? b?.results ?? b)
                ? null
                : "missing values[]"
          );
          const list: any[] =
            values?.values ??
            values?.results ??
            (Array.isArray(values) ? values : []);
          const ids = list
            .slice(0, 5)
            .map((v: any) => v.id ?? v.value)
            .filter((v: any) => v != null);
          if (ids.length > 0) {
            await tick(`${g.type}: resolve ${dim} ids`, () =>
              api.handleReportPOST(
                post(g.type, { ...scope, dimensionId: dim, ids }),
                g.config
              )
            );
          }
        }
        // Every metric at once, by the first dimension.
        await tick(
          `${g.type}: ${dimIds[0]} x [${metricIds.join(",")}]`,
          () =>
            api.handleReportPOST(
              post(g.type, {
                ...scope,
                dimensions: [dimIds[0]],
                metrics: metricIds,
              }),
              g.config
            ),
          rowsShape("results")
        );
      }

      // ---- pre-built reports -----------------------------------------
      const health = await import("~/utils/testCaseHealthUtils");
      const flaky = await import("~/utils/flakyTestsUtils");
      const issueCov = await import("~/utils/issueTestCoverageUtils");
      const execLog = await import("~/utils/executionLogUtils");
      const trend = await import("~/utils/resultsTrendUtils");
      const autoTrends = await import("~/utils/automationTrendsUtils");
      const impact = await import("~/utils/impactAnalysisReportUtils");
      const codePin = await import("~/utils/codePinCoverageReportUtils");
      const req = await import("~/utils/requirementCoverageReportUtils");

      const both = async (
        base: string,
        handler: (r: NextRequest, cross: boolean) => Promise<Response>,
        bodies: Array<Record<string, unknown>>,
        shape: (b: any) => string | null = rowsShape("data")
      ) => {
        for (const body of bodies) {
          const suffix = Object.keys(body).length
            ? ` ${JSON.stringify(body)}`
            : "";
          await tick(
            `cross-project-${base}${suffix}`,
            () =>
              handler(
                post(`cross-project-${base}`, {
                  dimensions: ["project"],
                  ...body,
                }),
                true
              ),
            shape
          );
          await tick(
            `${base} p${bigProject}${suffix}`,
            () =>
              handler(post(base, { projectId: bigProject, ...body }), false),
            shape
          );
          await tick(
            `${base} p${smallProject}${suffix}`,
            () =>
              handler(post(base, { projectId: smallProject, ...body }), false),
            shape
          );
        }
      };

      await both("test-case-health", health.handleTestCaseHealthPOST, [
        {},
        { lookbackDays: 0, staleDaysThreshold: 7, minExecutionsForRate: 3 },
        {
          healthStatusFilter: ["always_failing", "never_executed"],
          staleFilter: ["stale"],
          automatedFilter: "automated",
          pageSize: 50,
          sortColumn: "healthScore",
          sortDirection: "desc",
        },
      ]);
      await both("flaky-tests", flaky.handleFlakyTestsPOST, [
        {},
        { consecutiveRuns: 5, flipThreshold: 2, automatedFilter: "automated" },
      ]);
      await tick("cross-project-flaky-tests options", () =>
        flaky.handleFlakyTestsOptionsGET(get("cross-project-flaky-tests"), true)
      );
      await tick(`flaky-tests options p${bigProject}`, () =>
        flaky.handleFlakyTestsOptionsGET(
          get("flaky-tests", { projectId: bigProject }),
          false
        )
      );
      await both("issue-test-coverage", issueCov.handleIssueTestCoveragePOST, [
        {},
        { pageSize: 100, sortColumn: "passRate", sortDirection: "asc" },
      ]);
      await both("execution-log", execLog.handleExecutionLogPOST, [
        { page: 1, pageSize: 50 },
        {
          page: 2,
          pageSize: 100,
          sortColumn: "testCaseName",
          sortDirection: "asc",
        },
        {
          pageSize: "All",
          startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
        },
      ]);
      await both("results-trend", trend.handleResultsTrendPOST, [
        {},
        {
          showCounts: true,
          showPassRate: true,
          countSkipped: true,
          includeAborted: false,
        },
      ]);
      await both(
        "automation-trends",
        autoTrends.handleAutomationTrendsPOST,
        [{}, { dateGrouping: "monthly" }],
        rowsShape("data")
      );
      await both("impact-analysis", impact.handleImpactAnalysisReportPOST, [
        {},
        { lookbackDays: 0 },
      ]);
      await both("code-pin-coverage", codePin.handleCodePinCoverageReportPOST, [
        {},
        { lookbackDays: 0 },
      ]);

      // Requirement reports: cross-project and each requirements-enabled project.
      for (const variant of ["gaps", "traceability"] as const) {
        const path = `requirement-${variant}`;
        await tick(`cross-project-${path}`, () =>
          req.handleRequirementCoverageReportPOST(
            post(`cross-project-${path}`, {}),
            variant,
            true
          )
        );
        await tick(`cross-project-${path} options`, () =>
          req.handleRequirementReportOptionsGET(
            get(`cross-project-${path}`),
            true
          )
        );
        for (const pid of requirementProjects) {
          await tick(`${path} p${pid}`, () =>
            req.handleRequirementCoverageReportPOST(
              post(path, { projectId: pid }),
              variant,
              false
            )
          );
          await tick(`${path} p${pid} options`, () =>
            req.handleRequirementReportOptionsGET(
              get(path, { projectId: pid }),
              false
            )
          );
          await tick(`${path} p${pid} filtered`, () =>
            req.handleRequirementCoverageReportPOST(
              post(path, {
                projectId: pid,
                ...(variant === "gaps"
                  ? { includeNotRun: true }
                  : { coverageStates: ["FAILED", "NOT_RUN"] }),
                pageSize: 100,
                sortColumn: "requirement",
                sortDirection: "asc",
              }),
              variant,
              false
            )
          );
        }
      }
      if (snapshots.length > 0) {
        const first = snapshots[0];
        await tick(`requirement-traceability snapshot ${first.id}`, () =>
          req.handleRequirementCoverageReportPOST(
            post("requirement-traceability", {
              projectId: first.projectId,
              snapshotId: first.id,
            }),
            "traceability",
            false
          )
        );
        await tick(
          `requirement-coverage-changes baseline ${first.id} vs live`,
          () =>
            req.handleRequirementCoverageChangesPOST(
              post("requirement-coverage-changes", {
                projectId: first.projectId,
                baselineSnapshotId: first.id,
                includeUnchanged: true,
              })
            )
        );
      }

      // ---- route-local reports ---------------------------------------
      const projectHealth =
        await import("~/app/api/report-builder/project-health/route");
      for (const dim of ["milestone", "creator", "date"]) {
        await tick(
          `project-health p${bigProject}: ${dim} x all`,
          () =>
            projectHealth.POST(
              post("project-health", {
                projectId: bigProject,
                dimensions: [dim],
                metrics: [
                  "milestoneCompletion",
                  "totalMilestones",
                  "activeMilestones",
                ],
              })
            ),
          rowsShape("results")
        );
      }
      await tick(`project-health p${bigProject}: metadata`, () =>
        projectHealth.GET(get("project-health", { projectId: bigProject }))
      );

      const sessionAnalysis =
        await import("~/app/api/report-builder/session-analysis/route");
      for (const dim of [
        "session",
        "assignedTo",
        "milestone",
        "template",
        "state",
        "creator",
        "date",
      ]) {
        await tick(
          `session-analysis p${bigProject}: ${dim} x all`,
          () =>
            sessionAnalysis.POST(
              post("session-analysis", {
                projectId: bigProject,
                dimensions: [dim],
                metrics: [
                  "sessionCount",
                  "activeSessions",
                  "averageDuration",
                  "totalDuration",
                ],
              })
            ),
          rowsShape("results")
        );
      }
      await tick(`session-analysis p${bigProject}: metadata`, () =>
        sessionAnalysis.GET(get("session-analysis", { projectId: bigProject }))
      );

      const readiness =
        await import("~/app/api/report-builder/milestone-readiness/route");
      await tick(
        `milestone-readiness p${bigProject}`,
        () =>
          readiness.POST(
            post("milestone-readiness", {
              projectId: bigProject,
              dimensions: ["milestone"],
            })
          ),
        rowsShape("results")
      );
      await tick(`milestone-readiness p${bigProject}: metadata`, () =>
        readiness.GET(get("milestone-readiness", { projectId: bigProject }))
      );

      const matrix =
        await import("~/app/api/report-builder/iteration-matrix/route");
      await tick(
        `iteration-matrix p${smallProject}`,
        () =>
          matrix.POST(
            post("iteration-matrix", { projectId: smallProject, filters: {} })
          ),
        () => null,
        [200, 422]
      );

      const drill = await import("~/app/api/report-builder/drill-down/route");
      const contexts = [
        {
          reportType: "cross-project-test-execution",
          mode: "cross-project",
          metricId: "testResults",
          dimensions: {},
        },
        {
          reportType: "test-execution",
          mode: "project",
          projectId: bigProject,
          metricId: "passRate",
          dimensions: {},
        },
        {
          reportType: "repository-stats",
          mode: "project",
          projectId: bigProject,
          metricId: "testCaseCount",
          dimensions: {},
        },
        {
          reportType: "cross-project-user-engagement",
          mode: "cross-project",
          metricId: "testResults",
          dimensions: {},
        },
      ];
      for (const context of contexts) {
        await tick(
          `drill-down ${context.reportType} ${context.metricId}`,
          () =>
            drill.POST(
              post("drill-down", {
                context: { metricLabel: "x", metricValue: 0, ...context },
                offset: 0,
                limit: 25,
              })
            ),
          (b) =>
            Array.isArray(b?.data ?? b?.rows ?? b?.results ?? b?.items)
              ? null
              : `missing rows (keys: ${Object.keys(b ?? {}).join(",")})`
        );
      }

      // ---- report --------------------------------------------------------
      console.log(
        `\nREPORT SMOKE SWEEP: ${calls} calls, ${failures.length} failures\n` +
          (failures.length
            ? "FAILURES:\n" +
              failures
                .map((f) => `  [${f.status}] ${f.label} — ${f.detail}`)
                .join("\n") +
              "\n"
            : "") +
          (constraints.length
            ? `CONSTRAINTS (${constraints.length}, expected 400s):\n` +
              constraints.map((c) => `  ${c}`).join("\n") +
              "\n"
            : "") +
          report.join("\n") +
          "\n"
      );
      expect(failures).toEqual([]);
    },
    30 * 60 * 1000
  );
});
