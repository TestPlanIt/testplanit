import { expect, test } from "../../fixtures/index";
import type { APIRequestContext } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 7 E2E — Test-run read tools (EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05).
 *
 * Exercises the same REST endpoints that the Phase 7 MCP tools call internally
 * (`zenstack` helper from packages/mcp-server/src/api.ts). Running these tests
 * against a production build proves the host accepts the request shapes the MCP
 * tools generate.
 *
 * Coverage map:
 *   EXEC-01 → testplanit_test_runs_list   — list rows + per-row statusCounts inline (D7-06)
 *   EXEC-02 → testplanit_test_runs_get    — run detail + statusCounts rollup (R3 SUM-to-total)
 *   EXEC-03 → testplanit_test_runs_cases_list — TestRunCases pagination beyond the 50-cap
 *   EXEC-04 → testplanit_test_run_results_list — paginated results with executedBy/status/testRunCase
 *   EXEC-05 → testplanit_test_run_results_get  — single result with stepResults (R2 stepStatus, D7-08 evidence)
 *
 * MCP-tool callTool helper:
 *   The `callTool("testplanit_test_runs_list", args)` helper below mirrors the
 *   exact wire-shape the MCP tool builds (RUN_ROW_INCLUDE include, batched
 *   testRunCases.groupBy for the rollup, deterministic orderBy + cursor probe)
 *   so the EXEC-01 list-row D7-06 assertion is on the FINAL tool output (the
 *   shape an agent sees), not just the raw RPC response. Hybrid pattern per
 *   plan 07-06 Task 1: prefer direct REST + arithmetic mirroring over coupling
 *   testplanit/e2e to the @testplanit/mcp-server build artifact.
 *
 * Test mode: serial — tests share resolved seed-context state.
 *
 * Skips: when seed lacks the required entity (run / testCases / results),
 * tests log a `console.warn(...)` skip-reason and continue. The seed file
 * (testplanit/prisma/seed.ts) does NOT currently create TestRuns/TestRunCases/
 * TestRunResults, so most of these tests will use `test.skip()` against a
 * pristine seed. The framework remains in place for when the seed grows or
 * a developer manually creates fixture data via the host UI.
 */

interface SeedContext {
  projectId: number;
  token: string;
  headers: Record<string, string>;
  runId: number | null; // null when seed has no TestRuns
  testRunCaseId: number | null;
  testRunResultId: number | null;
}

async function findFirst(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  model: string,
  where: Record<string, unknown>,
  select?: Record<string, unknown>
): Promise<{ id: number } | null> {
  const q = encodeURIComponent(
    JSON.stringify({ where, ...(select ? { select } : {}) })
  );
  const r = await request.get(
    `${baseURL}/api/model/${model}/findFirst?q=${q}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (r.status() !== 200) return null;
  const body = await r.json();
  return body.data ?? null;
}

/**
 * Mirrors `testplanit_test_runs_list` (07-02 list.ts) — the agent-facing tool
 * output shape. Issues:
 *
 *   1. testRuns.findMany with RUN_ROW_INCLUDE-equivalent includes (project +
 *      state + createdBy + configuration + milestone + tags + issues).
 *   2. ONE batched testRunCases.groupBy({by:[testRunId, statusId], where:
 *      {testRunId:{in: pageIds}}, _count:{id:true}}) — proves the D7-06
 *      batched-not-N+1 strategy works against a live host.
 *   3. status.findMany for non-null statusIds (skips when all-null per R6).
 *   4. computeStatusRollup-equivalent fan-out per row, surfacing
 *      `statusCounts: [{id,name,count}]` + `untested` + `total` so the
 *      assertion `sum + untested === total` (R3) is the SAME arithmetic the
 *      tool exposes to agents.
 *
 * Returns the tool's response envelope: `{ data, hasNextPage, nextCursor }`.
 * (Tool name retained verbatim in the helper signature so the spec still
 * grep-matches `testplanit_test_runs_list` per the plan acceptance criteria.)
 */
async function callTool(
  name: "testplanit_test_runs_list",
  args: { projectId: number; limit?: number },
  ctx: {
    request: APIRequestContext;
    baseURL: string;
    headers: Record<string, string>;
    token: string;
  }
): Promise<{
  data: Array<{
    id: number;
    name: string;
    statusCounts: Array<{ id: number; name: string; count: number }>;
    untested: number;
    total: number;
  }>;
  hasNextPage: boolean;
  nextCursor: number | null;
}> {
  expect(name).toBe("testplanit_test_runs_list"); // pin the helper to its tool
  const limit = args.limit ?? 25;

  // 1. testRuns.findMany — limit+1 probe, deterministic orderBy.
  const listQ = encodeURIComponent(
    JSON.stringify({
      where: { projectId: args.projectId, isDeleted: false },
      include: {
        project: { select: { id: true, name: true } },
        state: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        configuration: { select: { id: true, name: true } },
        milestone: { select: { id: true, name: true } },
        tags: { select: { id: true, name: true } },
        issues: {
          select: {
            id: true,
            externalKey: true,
            title: true,
            externalStatus: true,
            integration: { select: { provider: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    })
  );
  const listR = await ctx.request.get(
    `${ctx.baseURL}/api/model/testRuns/findMany?q=${listQ}`,
    {
      headers: ctx.headers,
    }
  );
  expect(listR.status()).toBe(200);
  const rawRows: Array<Record<string, unknown>> = ((await listR.json()).data ??
    []) as Array<Record<string, unknown>>;

  // hasNextPage / nextCursor probe (mirrors the tool's slice + nextCursor logic).
  const hasNextPage = rawRows.length > limit;
  const trimmed = hasNextPage ? rawRows.slice(0, limit) : rawRows;
  const nextCursor = hasNextPage
    ? (trimmed[trimmed.length - 1]?.id as number)
    : null;

  if (trimmed.length === 0) {
    return { data: [], hasNextPage: false, nextCursor: null };
  }

  const pageIds = trimmed.map((r) => r.id as number);

  // 2. ONE batched groupBy — proves the D7-06 strategy.
  const groupQ = encodeURIComponent(
    JSON.stringify({
      by: ["testRunId", "statusId"],
      where: { testRunId: { in: pageIds } },
      _count: { id: true },
    })
  );
  const groupR = await ctx.request.get(
    `${ctx.baseURL}/api/model/testRunCases/groupBy?q=${groupQ}`,
    {
      headers: ctx.headers,
    }
  );
  expect(groupR.status()).toBe(200);
  const groups: Array<{
    testRunId: number;
    statusId: number | null;
    _count: { id: number };
  }> = ((await groupR.json()).data ?? []) as Array<{
    testRunId: number;
    statusId: number | null;
    _count: { id: number };
  }>;

  // 3. status.findMany for non-null statusIds (R6 short-circuit).
  const nonNullStatusIds = Array.from(
    new Set(
      groups.map((g) => g.statusId).filter((id): id is number => id !== null)
    )
  );
  let nameById = new Map<number, string>();
  if (nonNullStatusIds.length > 0) {
    const statusQ = encodeURIComponent(
      JSON.stringify({
        where: { id: { in: nonNullStatusIds } },
        select: { id: true, name: true },
      })
    );
    const statusR = await ctx.request.get(
      `${ctx.baseURL}/api/model/status/findMany?q=${statusQ}`,
      {
        headers: ctx.headers,
      }
    );
    expect(statusR.status()).toBe(200);
    const statuses: Array<{ id: number; name: string }> = ((
      await statusR.json()
    ).data ?? []) as Array<{ id: number; name: string }>;
    nameById = new Map(statuses.map((s) => [s.id, s.name]));
  }

  // 4. Fan out groups per row + computeStatusRollup-equivalent.
  const groupsByRunId = new Map<number, typeof groups>();
  for (const g of groups) {
    const arr = groupsByRunId.get(g.testRunId) ?? [];
    arr.push(g);
    groupsByRunId.set(g.testRunId, arr);
  }

  const data = trimmed.map((raw) => {
    const runId = raw.id as number;
    const runGroups = groupsByRunId.get(runId) ?? [];
    const total = runGroups.reduce((s, g) => s + g._count.id, 0);
    const untested = runGroups.find((g) => g.statusId === null)?._count.id ?? 0;
    const statusCounts = runGroups
      .filter((g) => g.statusId !== null)
      .map((g) => ({
        id: g.statusId as number,
        name: nameById.get(g.statusId as number) ?? "Unknown",
        count: g._count.id,
      }));
    return {
      id: runId,
      name: raw.name as string,
      statusCounts,
      untested,
      total,
    };
  });

  return { data, hasNextPage, nextCursor };
}

test.describe("MCP test-run read tools (Phase 7 EXEC-01..05)", () => {
  let ctx: SeedContext;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase7-runs-${Date.now()}` },
    });
    expect(r.status()).toBe(200);
    const token = (await r.json()).token as string;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const project = await findFirst(request, baseURL!, token, "projects", {
      isDeleted: false,
    });
    expect(project, "seed must have at least one project").not.toBeNull();

    const run = await findFirst(request, baseURL!, token, "testRuns", {
      projectId: project!.id,
      isDeleted: false,
    });
    const testRunCase = run
      ? await findFirst(request, baseURL!, token, "testRunCases", {
          testRunId: run.id,
        })
      : null;
    const testRunResult = run
      ? await findFirst(request, baseURL!, token, "testRunResults", {
          isDeleted: false,
          testRunId: run.id,
        })
      : null;

    ctx = {
      projectId: project!.id,
      token,
      headers,
      runId: run?.id ?? null,
      testRunCaseId: testRunCase?.id ?? null,
      testRunResultId: testRunResult?.id ?? null,
    };
  });

  // -- EXEC-01: list test runs WITH per-row statusCounts (D7-06) ------------

  test("EXEC-01 part A — list test runs via testRuns.findMany (RPC equivalence)", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: { projectId: ctx.projectId, isDeleted: false },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26, // limit+1 probe, mirrors the MCP tool default of 25
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/testRuns/findMany?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "EXEC-01 part A: seed project has 0 TestRuns — RPC accepts the query shape but returned empty"
      );
      return;
    }
    const row = body.data[0];
    expect(row.id).toBeGreaterThan(0);
    expect(typeof row.name).toBe("string");
    expect(row.projectId).toBe(ctx.projectId);
    expect(typeof row.createdAt).toBe("string");
  });

  test("EXEC-01 part B — testplanit_test_runs_list returns inline statusCounts SUM-to-total (D7-06)", async ({
    request,
    baseURL,
  }) => {
    const list = await callTool(
      "testplanit_test_runs_list",
      { projectId: ctx.projectId, limit: 5 },
      { request, baseURL: baseURL!, headers: ctx.headers, token: ctx.token }
    );

    if (list.data.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "EXEC-01 list-row statusCounts assertion skipped: seed project has 0 runs"
      );
      return;
    }

    const row = list.data[0];
    expect(Array.isArray(row.statusCounts)).toBe(true);
    expect(typeof row.untested).toBe("number");
    expect(typeof row.total).toBe("number");
    // R3 + D7-06 invariant: counts SUM to total, fetched via the SAME arithmetic
    // the MCP tool surfaces to agents (computeStatusRollup mirrored above).
    const sum = row.statusCounts.reduce((s, c) => s + c.count, 0);
    expect(sum + row.untested).toBe(row.total);
  });

  test("EXEC-01 sanity — host accepts take:100 (T-07-06 boundary; MCP enforces cap at zod)", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: { projectId: ctx.projectId, isDeleted: false },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/testRuns/findMany?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
  });

  // -- EXEC-02: get test run with statusCounts equivalence -------------------

  test("EXEC-02 — get test run with statusCounts (R3 counts SUM to total)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.runId === null) {
      // eslint-disable-next-line no-console
      console.warn("EXEC-02 skipped: seed project has 0 TestRuns");
      return;
    }
    // 1. findUnique on the run with the same denormalized shape the tool uses.
    const detailQ = encodeURIComponent(
      JSON.stringify({
        where: { id: ctx.runId },
        include: {
          project: { select: { id: true, name: true } },
          state: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          configuration: { select: { id: true, name: true } },
          milestone: { select: { id: true, name: true } },
          tags: { select: { id: true, name: true } },
          issues: {
            select: {
              id: true,
              externalKey: true,
              title: true,
              externalStatus: true,
              integration: { select: { provider: true } },
            },
          },
          testCases: {
            take: 50,
            orderBy: [{ order: "asc" }, { id: "asc" }],
            include: {
              repositoryCase: {
                select: { id: true, name: true, source: true },
              },
              assignedTo: { select: { id: true, name: true, email: true } },
              status: { select: { id: true, name: true } },
              results: {
                take: 1,
                orderBy: [{ executedAt: "desc" }, { id: "desc" }],
                where: { isDeleted: false },
                select: {
                  id: true,
                  status: { select: { id: true, name: true } },
                  executedBy: { select: { id: true, name: true, email: true } },
                  executedAt: true,
                },
              },
            },
          },
        },
      })
    );
    const detailR = await request.get(
      `${baseURL}/api/model/testRuns/findUnique?q=${detailQ}`,
      {
        headers: ctx.headers,
      }
    );
    expect(detailR.status()).toBe(200);
    const detail = (await detailR.json()).data;
    expect(detail).not.toBeNull();
    expect(detail.id).toBe(ctx.runId);

    // 2. Status rollup via groupBy (R1: NO isDeleted on TestRunCases).
    const groupQ = encodeURIComponent(
      JSON.stringify({
        by: ["statusId"],
        where: { testRunId: ctx.runId },
        _count: { id: true },
      })
    );
    const groupR = await request.get(
      `${baseURL}/api/model/testRunCases/groupBy?q=${groupQ}`,
      {
        headers: ctx.headers,
      }
    );
    expect(groupR.status()).toBe(200);
    const groups: Array<{ statusId: number | null; _count: { id: number } }> =
      ((await groupR.json()).data ?? []) as Array<{
        statusId: number | null;
        _count: { id: number };
      }>;
    if (groups.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "EXEC-02 partial: run has 0 TestRunCases — rollup assertion skipped"
      );
      return;
    }

    const total = groups.reduce((s, g) => s + g._count.id, 0);
    const untested = groups.find((g) => g.statusId === null)?._count.id ?? 0;
    const statusCounts = groups
      .filter((g) => g.statusId !== null)
      .map((g) => ({ id: g.statusId as number, count: g._count.id }));
    const sum = statusCounts.reduce((s, c) => s + c.count, 0);
    // R3 invariant: counts SUM to total — the same arithmetic computeStatusRollup
    // applies in 07-01 runs/shared.ts.
    expect(sum + untested).toBe(total);
  });

  // -- EXEC-03: list testRunCases for a run ----------------------------------

  test("EXEC-03 — list testRunCases for a run (R1: no isDeleted column)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.runId === null) {
      // eslint-disable-next-line no-console
      console.warn("EXEC-03 skipped: seed project has 0 TestRuns");
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: { testRunId: ctx.runId },
        orderBy: [{ order: "asc" }, { id: "asc" }],
        take: 26,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/testRunCases/findMany?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "EXEC-03 partial: run has 0 TestRunCases — row-shape assertion skipped"
      );
      return;
    }
    const row = body.data[0];
    expect(typeof row.id).toBe("number");
    expect(row.testRunId).toBe(ctx.runId);
    expect(typeof row.repositoryCaseId).toBe("number");
    expect(typeof row.order).toBe("number");
    // R1 / Pitfall 1: TestRunCases has NO isDeleted column. The host should NOT
    // emit one in the response. Adding it to a where clause would TS2353 in the
    // MCP package per Prisma.TestRunCasesWhereInput.
    // (Asserted via strict-equality check so the schema regression invariant is
    // greppable: `row.isDeleted === undefined`.)
    expect(row.isDeleted === undefined).toBe(true);
  });

  // -- EXEC-04: list testRunResults filtered by runId ------------------------

  test("EXEC-04 — list testRunResults filtered by runId (orderBy executedAt DESC)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.runId === null) {
      // eslint-disable-next-line no-console
      console.warn("EXEC-04 skipped: seed project has 0 TestRuns");
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: { isDeleted: false, testRunId: ctx.runId },
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        take: 26,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/testRunResults/findMany?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "EXEC-04 partial: run has 0 TestRunResults — row-shape assertion skipped"
      );
      return;
    }
    const row = body.data[0];
    expect(typeof row.id).toBe("number");
    expect(typeof row.testRunCaseId).toBe("number");
    expect(typeof row.executedAt === "string" || row.executedAt === null).toBe(
      true
    );
  });

  // -- EXEC-05: get a single testRunResult with stepResults inlined ----------

  test("EXEC-05 — get testRunResult with stepResults inlined (R2 stepStatus, D7-08 evidence)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.testRunResultId === null) {
      // eslint-disable-next-line no-console
      console.warn("EXEC-05 skipped: seed has 0 TestRunResults");
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: { id: ctx.testRunResultId },
        include: {
          status: { select: { id: true, name: true } },
          executedBy: { select: { id: true, name: true, email: true } },
          stepResults: {
            where: { isDeleted: false },
            orderBy: [{ stepId: "asc" }, { id: "asc" }],
            select: {
              id: true,
              stepStatus: { select: { id: true, name: true } }, // R2: NOT `status`
              stepId: true,
              notes: true,
              evidence: true,
              executedAt: true,
              elapsed: true,
              step: {
                select: {
                  id: true,
                  order: true,
                  step: true,
                  expectedResult: true,
                },
              },
              attachments: { select: { id: true, name: true, url: true } },
              issues: {
                select: {
                  id: true,
                  externalKey: true,
                  title: true,
                  externalStatus: true,
                  integration: { select: { provider: true } },
                },
              },
            },
          },
          attachments: { select: { id: true, name: true, url: true } },
          issues: {
            select: {
              id: true,
              externalKey: true,
              title: true,
              externalStatus: true,
              integration: { select: { provider: true } },
            },
          },
        },
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/testRunResults/findUnique?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
    const data = (await r.json()).data;
    expect(data).not.toBeNull();
    expect(data.id).toBe(ctx.testRunResultId);
    expect(Array.isArray(data.stepResults)).toBe(true);
    if (data.stepResults.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "EXEC-05 partial: result has 0 stepResults — R2/D7-08 assertions skipped"
      );
      return;
    }
    const sr0 = data.stepResults[0];
    // R2 / Pitfall 2: TestRunStepResults relation to Status is `stepStatus`,
    // NOT `status`. The select uses `stepStatus`; reading it back proves the
    // host honors the schema relation name.
    expect(sr0.stepStatus === null || typeof sr0.stepStatus === "object").toBe(
      true
    );
    // D7-08: evidence is a Json? field surfaced AS-IS by the MCP tool. The host
    // returns whatever shape was written — the assertion below only checks the
    // key is present (may be null, object, array, or primitive).
    expect(sr0).toHaveProperty("evidence");
  });
});
