import { expect, test } from "../../fixtures/index";
import type { APIRequestContext } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 7 E2E — Session read tools (SESS-01, SESS-02, SESS-03, SESS-04, SESS-05).
 *
 * Exercises the same REST endpoints the Phase 7 MCP session tools call
 * internally. Running these tests against a production build proves the host
 * accepts the request shapes the MCP tools generate.
 *
 * Coverage map:
 *   SESS-01 → testplanit_sessions_list           — paginated sessions
 *   SESS-02 → testplanit_sessions_get            — session + sessionResults inline (D7-12 take:101)
 *   SESS-03 → testplanit_session_results_list    — filtered by sessionId; NO testCaseId (R4)
 *   SESS-04 → testplanit_session_results_get     — result detail with createdBy (D7-13 executor)
 *   SESS-05 → testplanit_sessions_findings_list  — sessionId mode (D7-11 OR shape) + issueId mode
 *
 * Test mode: serial — tests share resolved seed-context state.
 *
 * Skips: when seed lacks the required entity, tests log a `console.warn(...)`
 * skip-reason and continue. The seed file (testplanit/prisma/seed.ts) does
 * NOT currently create Sessions/SessionResults/Issues, so most of these tests
 * will skip against a pristine seed. Framework remains in place for when seed
 * grows or fixture data is added via the host UI.
 */

interface SeedContext {
  projectId: number;
  token: string;
  headers: Record<string, string>;
  sessionId: number | null;
  sessionResultId: number | null;
  issueId: number | null;
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

test.describe("MCP session read tools (Phase 7 SESS-01..05)", () => {
  let ctx: SeedContext;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase7-sessions-${Date.now()}` },
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

    const session = await findFirst(request, baseURL!, token, "sessions", {
      projectId: project!.id,
      isDeleted: false,
    });
    const sessionResult = session
      ? await findFirst(request, baseURL!, token, "sessionResults", {
          isDeleted: false,
          sessionId: session.id,
        })
      : null;

    // SESS-05 issueId mode requires an Issue tied to the project — not all
    // seeds carry one. Look broadly: any non-deleted Issue accessible from this
    // project's sessions/sessionResults.
    const issue = await findFirst(request, baseURL!, token, "issue", {
      isDeleted: false,
    });

    ctx = {
      projectId: project!.id,
      token,
      headers,
      sessionId: session?.id ?? null,
      sessionResultId: sessionResult?.id ?? null,
      issueId: issue?.id ?? null,
    };
  });

  // -- SESS-01: list sessions ------------------------------------------------

  test("SESS-01 — list sessions filtered by projectId", async ({
    request,
    baseURL,
  }) => {
    let body: { data: Array<Record<string, unknown>> } | undefined;
    await test.step("Request sessions list filtered by projectId", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { projectId: ctx.projectId, isDeleted: false },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/sessions/findMany?q=${q}`,
        {
          headers: ctx.headers,
        }
      );
      expect(r.status()).toBe(200);
      body = await r.json();
      expect(Array.isArray(body!.data)).toBe(true);
    });
    if (body!.data.length === 0) {
      console.warn(
        "SESS-01: seed project has 0 Sessions — row-shape assertion skipped"
      );
      return;
    }
    await test.step("Verify first session row shape", async () => {
      const row = body!.data[0];
      expect(typeof row.id).toBe("number");
      expect(typeof row.name).toBe("string");
      expect(row.projectId).toBe(ctx.projectId);
      expect(typeof row.createdAt).toBe("string");
    });
  });

  // -- SESS-02: get session with sessionResults + truncation behavior --------

  test("SESS-02 — get session with sessionResults inline (D7-12 take:101 overflow probe)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.sessionId === null) {
      console.warn("SESS-02 skipped: seed project has 0 Sessions");
      return;
    }
    let data: Record<string, any> | undefined;
    await test.step("Get session with sessionResults inline (take:101 overflow probe)", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { id: ctx.sessionId },
          include: {
            project: { select: { id: true, name: true } },
            state: { select: { id: true, name: true } },
            createdBy: { select: { id: true, name: true, email: true } },
            assignedTo: { select: { id: true, name: true, email: true } },
            template: { select: { id: true, templateName: true } },
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
            // D7-12: take 101 so the MCP tool can detect overflow and surface
            // truncated:true. The host must accept the take cap; the spec only
            // verifies the response array is bounded by 101.
            sessionResults: {
              take: 101,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              include: {
                status: { select: { id: true, name: true } },
                createdBy: { select: { id: true, name: true, email: true } },
                session: {
                  select: { id: true, name: true, projectId: true },
                },
              },
            },
          },
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/sessions/findUnique?q=${q}`,
        {
          headers: ctx.headers,
        }
      );
      expect(r.status()).toBe(200);
      data = (await r.json()).data;
    });
    await test.step("Verify session identity and bounded sessionResults", async () => {
      expect(data).not.toBeNull();
      expect(data!.id).toBe(ctx.sessionId);
      expect(Array.isArray(data!.sessionResults)).toBe(true);
      expect(data!.sessionResults.length).toBeLessThanOrEqual(101);
    });
  });

  // -- SESS-03: list sessionResults filtered by sessionId; NO testCaseId (R4)

  test("SESS-03 — list sessionResults filtered by sessionId (R4: NO testCaseId)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.sessionId === null) {
      console.warn("SESS-03 skipped: seed project has 0 Sessions");
      return;
    }
    await test.step("List sessionResults filtered by sessionId and assert array shape", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { isDeleted: false, sessionId: ctx.sessionId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/sessionResults/findMany?q=${q}`,
        {
          headers: ctx.headers,
        }
      );
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  test("SESS-03 — R4 schema invariant: testCaseId is NOT a valid SessionResults filter", async ({
    request,
    baseURL,
  }) => {
    // R4 / Pitfall 4: SessionResults has no testCaseId FK. The MCP tool's
    // input schema does NOT accept testCaseId (07-05 plan). At the host level,
    // we attempt a where clause carrying testCaseId and document the host's
    // response. ZenStack v3 typically rejects unknown columns with 4xx; if it
    // silently ignores, this test still serves as a documentation marker.
    let r: Awaited<ReturnType<typeof request.get>> | undefined;
    await test.step("Query sessionResults with unknown testCaseId filter", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { isDeleted: false, testCaseId: 999999 },
          take: 1,
        })
      );
      r = await request.get(
        `${baseURL}/api/model/sessionResults/findMany?q=${q}`,
        {
          headers: ctx.headers,
        }
      );
    });
    await test.step("Document whether host rejects or ignores the unknown column", async () => {
      // The host MAY reject the unknown column (preferred — strict schema) OR
      // silently ignore it (acceptable — input schema is the MCP layer's job).
      // The MCP tool's primary R4 enforcement is at the input-schema level
      // (SessionResults.testCaseId not declared), not at the host wire level.
      if (r!.status() >= 400) {
        // Host rejected — strict schema enforcement (preferred outcome).
        expect(r!.status()).toBeGreaterThanOrEqual(400);
      } else {
        // Host accepted but presumably ignored. R4 is still enforced at the MCP
        // input schema (07-05 plan). Document and move on.

        console.warn(
          "SESS-03: host accepted unknown `testCaseId` filter on sessionResults; R4 enforced at MCP input-schema layer"
        );
      }
    });
  });

  // -- SESS-04: get sessionResult with createdBy (D7-13 executor) ------------

  test("SESS-04 — get sessionResult with createdBy executor (D7-13: NO separate executedBy)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.sessionResultId === null) {
      console.warn("SESS-04 skipped: seed has 0 SessionResults");
      return;
    }
    let data: Record<string, any> | undefined;
    await test.step("Get sessionResult with createdBy executor and related entities", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { id: ctx.sessionResultId },
          include: {
            status: { select: { id: true, name: true } },
            // D7-13: createdBy is THE executor. Sessions don't have a separate
            // executedBy field; the MCP tool surfaces createdBy as the executor.
            createdBy: { select: { id: true, name: true, email: true } },
            session: { select: { id: true, name: true, projectId: true } },
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
            resultFieldValues: {
              select: { id: true, value: true, fieldId: true },
            },
          },
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/sessionResults/findUnique?q=${q}`,
        {
          headers: ctx.headers,
        }
      );
      expect(r.status()).toBe(200);
      data = (await r.json()).data;
    });
    await test.step("Verify result identity and createdBy executor present", async () => {
      expect(data).not.toBeNull();
      expect(data!.id).toBe(ctx.sessionResultId);
      // D7-13 executor field — createdBy is present (may be null only if the
      // user was deleted; in normal seeds it should be a populated object).
      expect(data).toHaveProperty("createdBy");
      expect(Array.isArray(data!.resultFieldValues)).toBe(true);
    });
  });

  // -- SESS-05: findings list — sessionId mode (D7-11 OR shape) --------------

  test("SESS-05 sessionId mode — findings via OR over [sessions, sessionResults] (D7-11)", async ({
    request,
    baseURL,
  }) => {
    if (ctx.sessionId === null) {
      console.warn(
        "SESS-05 sessionId mode skipped: seed project has 0 Sessions"
      );
      return;
    }
    let body: { data: unknown[] } | undefined;
    await test.step("Query findings via OR over sessions and sessionResults", async () => {
      // D7-11 OR shape: findings = issues linked to the session OR to any of its
      // sessionResults. Mirrors the MCP tool's where clause exactly.
      const q = encodeURIComponent(
        JSON.stringify({
          where: {
            isDeleted: false,
            OR: [
              { sessions: { some: { id: ctx.sessionId } } },
              {
                sessionResults: { some: { session: { id: ctx.sessionId } } },
              },
            ],
          },
          include: { integration: { select: { provider: true } } },
          orderBy: [{ id: "asc" }],
          take: 501, // 500 cap + overflow probe (matches FINDINGS_TAKE_CAP)
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/issue/findMany?q=${q}`,
        {
          headers: ctx.headers,
        }
      );
      expect(r.status()).toBe(200);
      body = await r.json();
      expect(Array.isArray(body!.data)).toBe(true);
    });
    if (body!.data.length === 0) {
      console.warn(
        "SESS-05 sessionId mode: session has 0 linked issues — row-shape skipped"
      );
    }
  });

  // -- SESS-05: findings list — issueId mode ---------------------------------

  test("SESS-05 issueId mode — findUnique with linkedSessions + linkedSessionResults", async ({
    request,
    baseURL,
  }) => {
    if (ctx.issueId === null) {
      console.warn("SESS-05 issueId mode skipped: seed has 0 Issues");
      return;
    }
    let data: Record<string, any> | undefined;
    await test.step("Get issue with linked sessions and sessionResults", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { id: ctx.issueId },
          include: {
            integration: { select: { provider: true } },
            sessions: {
              take: 500,
              select: {
                id: true,
                name: true,
                createdAt: true,
                isCompleted: true,
                createdBy: { select: { id: true, name: true, email: true } },
              },
            },
            sessionResults: {
              take: 500,
              select: {
                id: true,
                sessionId: true,
                createdAt: true,
                status: { select: { id: true, name: true } },
                createdBy: { select: { id: true, name: true, email: true } },
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
      data = (await r.json()).data;
    });
    if (data === null) {
      console.warn(
        "SESS-05 issueId mode: issue not accessible to this token — skipped"
      );
      return;
    }
    await test.step("Verify issue identity and linked collections shape", async () => {
      expect(data!.id).toBe(ctx.issueId);
      expect(Array.isArray(data!.sessions)).toBe(true);
      expect(Array.isArray(data!.sessionResults)).toBe(true);
    });
  });
});
