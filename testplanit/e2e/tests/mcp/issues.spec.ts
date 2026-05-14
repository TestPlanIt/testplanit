import { expect, test } from "../../fixtures/index";
import type { APIRequestContext } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 8 E2E — Issues domain read tools (ISSUE-01..04 + chain proof).
 *
 * Exercises the same REST endpoints the Phase 8 MCP issue tools call
 * internally. Running against a production build proves the host accepts
 * the request shapes the MCP tools generate.
 *
 * Coverage map:
 *   ISSUE-01 → testplanit_issues_find_by_key  — (externalKey, externalSystem, projectId)
 *   ISSUE-02 → testplanit_issues_list         — project-scoped paginated list
 *   ISSUE-03 → testplanit_issues_get          — header + 3 inline arrays (cap 100)
 *   ISSUE-04 → testplanit_issues_list_links   — outbound + inbound junction traversal
 *   chain    → find_by_key → cases_list({ issueId }) — 2-call killer-app composition
 *
 * Test mode: serial — beforeAll resolves seed-context state.
 *
 * Skips: when seed lacks the relevant entity, tests log a `console.warn(...)`
 * skip-reason and exit early. The seed file does NOT currently create Issues,
 * so most blocks skip against a pristine seed; framework lives here for prod
 * smoke runs that have real fixture data.
 */

interface SeedContext {
  projectId: number;
  token: string;
  headers: Record<string, string>;
  issueId: number | null;
  issueExternalKey: string | null;
  issueExternalSystem: string | null;
  caseIdLinkedToAnyIssue: number | null;
}

async function findFirst(
  request: APIRequestContext,
  baseURL: string,
  token: string,
  model: string,
  where: Record<string, unknown>,
  select?: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
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

test.describe("MCP issue read tools (Phase 8 ISSUE-01..04)", () => {
  let ctx: SeedContext;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase8-issues-${Date.now()}` },
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
    const projectId = project!.id as number;

    // ISSUE-01..04 require an Issue tied to this project. Look broadly: any
    // non-deleted Issue with projectId matching, integration loaded so we can
    // resolve externalSystem from integration.provider.
    const issueQ = encodeURIComponent(
      JSON.stringify({
        where: { isDeleted: false, projectId },
        include: { integration: { select: { provider: true } } },
        take: 1,
      })
    );
    const issueR = await request.get(
      `${baseURL}/api/model/issue/findMany?q=${issueQ}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    let issueId: number | null = null;
    let issueExternalKey: string | null = null;
    let issueExternalSystem: string | null = null;
    if (issueR.status() === 200) {
      const issueBody = await issueR.json();
      const row = issueBody.data?.[0];
      if (row) {
        issueId = row.id as number;
        issueExternalKey = (row.externalKey as string | null) ?? null;
        issueExternalSystem =
          (row.integration?.provider as string | null) ?? null;
      }
    }

    // ISSUE-04 inbound mode wants any RepositoryCases.id linked to any Issue.
    // Look for a case with at least one issue link.
    const caseLinked = await findFirst(
      request,
      baseURL!,
      token,
      "repositoryCases",
      {
        projectId,
        isDeleted: false,
        issues: { some: { isDeleted: false } },
      }
    );

    ctx = {
      projectId,
      token,
      headers,
      issueId,
      issueExternalKey,
      issueExternalSystem,
      caseIdLinkedToAnyIssue: (caseLinked?.id as number | undefined) ?? null,
    };
  });

  // -- ISSUE-01: find by (externalKey, externalSystem, projectId) ------------

  test("ISSUE-01 — findFirst by (externalKey, integration.provider, projectId)", async ({
    request,
    baseURL,
  }) => {
    if (
      ctx.issueId === null ||
      ctx.issueExternalKey === null ||
      ctx.issueExternalSystem === null
    ) {
       
      console.warn(
        "ISSUE-01 skipped: seed has no Issue with externalKey + integration.provider in this project"
      );
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          externalKey: ctx.issueExternalKey,
          integration: { provider: ctx.issueExternalSystem },
          projectId: ctx.projectId,
          isDeleted: false,
        },
        include: {
          integration: { select: { id: true, name: true, provider: true } },
        },
      })
    );
    const r = await request.get(`${baseURL}/api/model/issue/findFirst?q=${q}`, {
      headers: ctx.headers,
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.data).not.toBeNull();
    expect(body.data.id).toBe(ctx.issueId);
    expect(body.data.externalKey).toBe(ctx.issueExternalKey);
    expect(body.data.integration?.provider).toBe(ctx.issueExternalSystem);
    expect(body.data.projectId).toBe(ctx.projectId);
  });

  // -- ISSUE-02: project-scoped list with deterministic createdAt-desc order --

  test("ISSUE-02 — list issues filtered by projectId; verify descending createdAt order", async ({
    request,
    baseURL,
  }) => {
    const q = encodeURIComponent(
      JSON.stringify({
        where: { projectId: ctx.projectId, isDeleted: false },
        include: {
          integration: { select: { id: true, name: true, provider: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
      })
    );
    const r = await request.get(`${baseURL}/api/model/issue/findMany?q=${q}`, {
      headers: ctx.headers,
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length === 0) {
       
      console.warn(
        "ISSUE-02: seed project has 0 Issues — order assertion skipped"
      );
      return;
    }
    // Verify orderBy applied: each createdAt >= the next.
    for (let i = 1; i < body.data.length; i++) {
      const prev = new Date(body.data[i - 1].createdAt as string).getTime();
      const curr = new Date(body.data[i].createdAt as string).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  // -- ISSUE-03: get with full ISSUE_DETAIL_INCLUDE and overflow probe --------

  test("ISSUE-03 — findUnique with ISSUE_DETAIL_INCLUDE: 3 inline arrays each capped at 101", async ({
    request,
    baseURL,
  }) => {
    if (ctx.issueId === null) {
       
      console.warn("ISSUE-03 skipped: seed has 0 Issues in project");
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: { id: ctx.issueId },
        include: {
          integration: { select: { id: true, name: true, provider: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          _count: { select: { repositoryCases: true } },
          // D8-06 / D7-12: each linked-array sub-include declares take:101 so
          // the get handler can detect overflow and stamp truncated.<key>:true.
          repositoryCases: {
            where: { isDeleted: false },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 101,
            select: { id: true, name: true, source: true, automated: true },
          },
          sessions: {
            where: { isDeleted: false },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 101,
            select: {
              id: true,
              name: true,
              mission: true,
              isCompleted: true,
              state: { select: { id: true, name: true } },
            },
          },
          testRuns: {
            where: { isDeleted: false },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 101,
            select: {
              id: true,
              name: true,
              isCompleted: true,
              completedAt: true,
            },
          },
        },
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/issue/findUnique?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
    const data = (await r.json()).data;
    expect(data).not.toBeNull();
    expect(data.id).toBe(ctx.issueId);
    expect(Array.isArray(data.repositoryCases)).toBe(true);
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(Array.isArray(data.testRuns)).toBe(true);
    expect(data.repositoryCases.length).toBeLessThanOrEqual(101);
    expect(data.sessions.length).toBeLessThanOrEqual(101);
    expect(data.testRuns.length).toBeLessThanOrEqual(101);
    // Overflow detection probe: if any one array is exactly 101 the MCP tool
    // would surface truncated:true. We document it but do not require it.
    if (data.repositoryCases.length === 101) {
       
      console.warn(
        "ISSUE-03: linkedCases overflow probe HIT (>= 100 — MCP would surface truncated)"
      );
    }
  });

  // -- ISSUE-04: outbound + inbound junction traversal -----------------------

  test("ISSUE-04 — outbound: cases linked to an issue via Issue.repositoryCases", async ({
    request,
    baseURL,
  }) => {
    if (ctx.issueId === null) {
       
      console.warn("ISSUE-04 outbound skipped: seed has 0 Issues");
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          isDeleted: false,
          issues: { some: { id: ctx.issueId, isDeleted: false } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
      })
    );
    const r = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany?q=${q}`,
      {
        headers: ctx.headers,
      }
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    if (body.data.length === 0) {
       
      console.warn(
        "ISSUE-04 outbound: issue has 0 linked cases (or filtered by access policy)"
      );
    }
  });

  test("ISSUE-04 — inbound: issues linked to a case via Issue.repositoryCases.some", async ({
    request,
    baseURL,
  }) => {
    if (ctx.caseIdLinkedToAnyIssue === null) {
       
      console.warn(
        "ISSUE-04 inbound skipped: no RepositoryCase has any Issue link in this project"
      );
      return;
    }
    const q = encodeURIComponent(
      JSON.stringify({
        where: {
          isDeleted: false,
          repositoryCases: {
            some: { id: ctx.caseIdLinkedToAnyIssue, isDeleted: false },
          },
        },
        include: {
          integration: { select: { id: true, name: true, provider: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
      })
    );
    const r = await request.get(`${baseURL}/api/model/issue/findMany?q=${q}`, {
      headers: ctx.headers,
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  // -- Chain proof: find_by_key → cases_list({issueId}) in 2 REST calls ------

  test("ISSUE chain — find_by_key → cases_list({ issueId }) in exactly 2 REST calls", async ({
    request,
    baseURL,
  }) => {
    if (
      ctx.issueExternalKey === null ||
      ctx.issueExternalSystem === null ||
      ctx.issueId === null
    ) {
       
      console.warn(
        "ISSUE chain skipped: seed has no Issue with externalKey + integration.provider in this project"
      );
      return;
    }

    // ---- Call 1: find_by_key ------------------------------------------------
    const findQ = encodeURIComponent(
      JSON.stringify({
        where: {
          externalKey: ctx.issueExternalKey,
          integration: { provider: ctx.issueExternalSystem },
          projectId: ctx.projectId,
          isDeleted: false,
        },
      })
    );
    const findR = await request.get(
      `${baseURL}/api/model/issue/findFirst?q=${findQ}`,
      {
        headers: ctx.headers,
      }
    );
    expect(findR.status()).toBe(200);
    const findBody = await findR.json();
    expect(findBody.data).not.toBeNull();
    const issueId = findBody.data.id as number;
    expect(issueId).toBe(ctx.issueId);

    // ---- Call 2: cases_list({ issueId }) -----------------------------------
    const casesQ = encodeURIComponent(
      JSON.stringify({
        where: {
          projectId: ctx.projectId,
          isDeleted: false,
          issues: { some: { id: issueId, isDeleted: false } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
      })
    );
    const casesR = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany?q=${casesQ}`,
      { headers: ctx.headers }
    );
    expect(casesR.status()).toBe(200);
    const casesBody = await casesR.json();
    expect(Array.isArray(casesBody.data)).toBe(true);
    if (casesBody.data.length === 0) {
       
      console.warn(
        "ISSUE chain partial: issue has 0 linked RepositoryCases — chain shape verified, non-empty assertion skipped"
      );
    }
  });
});
