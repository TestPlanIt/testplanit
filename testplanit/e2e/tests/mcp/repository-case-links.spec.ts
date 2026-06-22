import { expect, test } from "../../fixtures/index";
import type { APIRequestContext } from "@playwright/test";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * Phase 8 E2E — Repository case links list (REPO-05).
 *
 * Exercises the same REST endpoint the Phase 8 MCP tool
 * `testplanit_repository_case_links_list` calls internally. Running against
 * a production build proves the host accepts the 3-way XOR shape
 * (caseId / caseAId / caseBId) plus the optional linkType filter.
 *
 * Coverage map:
 *   REPO-05 → testplanit_repository_case_links_list
 *
 * Test mode: serial — beforeAll resolves seed-context state.
 *
 * Skips: when seed lacks any RepositoryCaseLink rows accessible to the
 * project, the tests log a `console.warn(...)` skip-reason and exit early.
 */

interface SeedContext {
  projectId: number;
  token: string;
  headers: Record<string, string>;
  // A link row + its endpoints we found via beforeAll. Either populated
  // together or all null (seed-empty case).
  linkId: number | null;
  caseAId: number | null;
  caseBId: number | null;
  linkType: string | null;
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

test.describe("MCP repository case links read (Phase 8 REPO-05)", () => {
  let ctx: SeedContext;

  test.beforeAll(async ({ request, baseURL }) => {
    const r = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `Phase8-repo-case-links-${Date.now()}` },
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

    // Find any RepositoryCaseLink whose caseA is in this project. Pull its
    // endpoints + linkType for downstream test assertions.
    const linkQ = encodeURIComponent(
      JSON.stringify({
        where: {
          isDeleted: false,
          caseA: { projectId, isDeleted: false },
        },
        select: {
          id: true,
          type: true,
          caseAId: true,
          caseBId: true,
        },
        take: 1,
      })
    );
    const linkR = await request.get(
      `${baseURL}/api/model/repositoryCaseLink/findMany?q=${linkQ}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    let linkId: number | null = null;
    let caseAId: number | null = null;
    let caseBId: number | null = null;
    let linkType: string | null = null;
    if (linkR.status() === 200) {
      const linkBody = await linkR.json();
      const row = linkBody.data?.[0];
      if (row) {
        linkId = row.id as number;
        caseAId = row.caseAId as number;
        caseBId = row.caseBId as number;
        linkType = (row.type as string) ?? null;
      }
    }

    ctx = {
      projectId,
      token,
      headers,
      linkId,
      caseAId,
      caseBId,
      linkType,
    };
  });

  // -- caseId mode (bidirectional OR clause) ---------------------------------

  test("REPO-05 — caseId mode: bidirectional OR=[caseAId, caseBId] returns link", async ({
    request,
    baseURL,
  }) => {
    if (ctx.linkId === null || ctx.caseAId === null) {
      console.warn(
        "REPO-05 caseId mode skipped: seed has no RepositoryCaseLink in this project"
      );
      return;
    }

    let body: { data: { id: number }[] } | undefined;

    await test.step("Query links by caseId with bidirectional OR clause", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: {
            isDeleted: false,
            OR: [{ caseAId: ctx.caseAId }, { caseBId: ctx.caseAId }],
          },
          include: {
            caseA: {
              select: { id: true, name: true, source: true, automated: true },
            },
            caseB: {
              select: { id: true, name: true, source: true, automated: true },
            },
            createdBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/repositoryCaseLink/findMany?q=${q}`,
        { headers: ctx.headers }
      );
      expect(r.status()).toBe(200);
      body = await r.json();
    });

    await test.step("Confirm the seeded link appears in OR-mode results", async () => {
      expect(Array.isArray(body!.data)).toBe(true);
      expect(body!.data.length).toBeGreaterThanOrEqual(1);
      // Confirm the link we located in beforeAll appears in the OR-mode results.
      const found = body!.data.find(
        (row: { id: number }) => row.id === ctx.linkId
      );
      expect(found).toBeDefined();
    });
  });

  // -- caseAId mode (one-way originating side) -------------------------------

  test("REPO-05 — caseAId mode: one-way filter on originating endpoint", async ({
    request,
    baseURL,
  }) => {
    if (ctx.caseAId === null) {
      console.warn(
        "REPO-05 caseAId mode skipped: seed has no RepositoryCaseLink"
      );
      return;
    }

    let body: { data: { caseAId: number }[] } | undefined;

    await test.step("Query links filtered by originating endpoint caseAId", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { isDeleted: false, caseAId: ctx.caseAId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/repositoryCaseLink/findMany?q=${q}`,
        { headers: ctx.headers }
      );
      expect(r.status()).toBe(200);
      body = await r.json();
    });

    await test.step("Assert every result matches the requested caseAId", async () => {
      expect(Array.isArray(body!.data)).toBe(true);
      for (const row of body!.data) {
        expect(row.caseAId).toBe(ctx.caseAId);
      }
    });
  });

  // -- caseBId mode (one-way destination side) -------------------------------

  test("REPO-05 — caseBId mode: one-way filter on destination endpoint", async ({
    request,
    baseURL,
  }) => {
    if (ctx.caseBId === null) {
      console.warn(
        "REPO-05 caseBId mode skipped: seed has no RepositoryCaseLink"
      );
      return;
    }

    let body: { data: { caseBId: number }[] } | undefined;

    await test.step("Query links filtered by destination endpoint caseBId", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: { isDeleted: false, caseBId: ctx.caseBId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/repositoryCaseLink/findMany?q=${q}`,
        { headers: ctx.headers }
      );
      expect(r.status()).toBe(200);
      body = await r.json();
    });

    await test.step("Assert every result matches the requested caseBId", async () => {
      expect(Array.isArray(body!.data)).toBe(true);
      for (const row of body!.data) {
        expect(row.caseBId).toBe(ctx.caseBId);
      }
    });
  });

  // -- linkType filter -------------------------------------------------------

  test("REPO-05 — linkType filter: where.type narrows to a single LinkType", async ({
    request,
    baseURL,
  }) => {
    if (ctx.linkType === null || ctx.caseAId === null) {
      console.warn("REPO-05 linkType skipped: seed has no RepositoryCaseLink");
      return;
    }

    let body: { data: { type: string }[] } | undefined;

    await test.step("Query links narrowed by where.type linkType filter", async () => {
      const q = encodeURIComponent(
        JSON.stringify({
          where: {
            isDeleted: false,
            caseAId: ctx.caseAId,
            type: ctx.linkType,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 26,
        })
      );
      const r = await request.get(
        `${baseURL}/api/model/repositoryCaseLink/findMany?q=${q}`,
        { headers: ctx.headers }
      );
      expect(r.status()).toBe(200);
      body = await r.json();
    });

    await test.step("Assert every result matches the requested linkType", async () => {
      expect(Array.isArray(body!.data)).toBe(true);
      for (const row of body!.data) {
        expect(row.type).toBe(ctx.linkType);
      }
    });
  });
});
