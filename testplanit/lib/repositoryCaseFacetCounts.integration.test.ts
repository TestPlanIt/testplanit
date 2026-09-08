/**
 * Live-DB integration tests for the filter-aware facet-count engine
 * (lib/repositoryCaseFacetCounts.ts) and the view-options route's
 * legacy-body regression (spec §8).
 *
 * Execution model (readWriteDialect.integration.test.ts convention):
 *   - Skipped by default. Opt in with RUN_DB_INTEGRATION=1.
 *   - DB SAFETY: connects ONLY to the tpi_test scratch database, whose URL is
 *     read from .env.e2e directly. The active .env DATABASE_URL points at a
 *     production-ish database and is never consulted — the suite hard-refuses
 *     any URL that is not the tpi_test database.
 *   - All fixtures are created with unique names inside one throwaway project
 *     and hard-deleted in afterAll, leaving the DB as it was found.
 *
 * Covered against real seeded data:
 *   1. whereExcept self-exclusion per dimension (template + tag chips), with
 *      unchipped dimensions counted under whereAll.
 *   2. dimensionTotals: the self-excluded base for a chipped dimension, the
 *      all-predicates total for every unchipped one.
 *   3. tags all/none (valued + bare) fragment execution incl. soft-deleted
 *      tag exclusion.
 *   4. hasValue/noValue pairs derived from whereExcept (the legacy mixed-base
 *      negative-noValue shape now stays >= 0 and exact), including the
 *      option-type (Dropdown) pair that produced a NEGATIVE "None" count in
 *      production UAT.
 *   5. searchCaseIds intersection — repo mode, run mode where the search ids
 *      INTERSECT (not overwrite) the run-membership id filter, and the route's
 *      sanitizer in front of it.
 *   6. Text-operator predicates in counts, cross-checked against
 *      matchesPostFetchFilters over the same rows.
 *   7. LEGACY REGRESSION: the route handler with a ReportBuilder-shaped body
 *      (no predicates) keeps legacy semantics — non-self-excluding
 *      templates/states — guarding against normalization into predicates.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ZenStackClient } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schema } from "~/zenstack/schema";
import { createDialect } from "~/lib/db/readWriteDialect";
import {
  matchesPostFetchFilters,
  type PostFetchFilter,
} from "~/lib/repositoryCaseFieldMatchers";
import {
  computeRepositoryCaseFacetCounts,
  type FacetCountsDb,
} from "./repositoryCaseFacetCounts";

// The route under test imports { baseDb } from ~/lib/db, which builds its
// client from the active .env DATABASE_URL. That module must never be loaded
// here — the mock below substitutes a proxy that forwards to the scratch-DB
// client once beforeAll has created it.
const scratchDb = vi.hoisted(() => {
  const holder: { client: unknown } = { client: null };
  const proxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const client = holder.client as Record<PropertyKey, unknown> | null;
        if (!client) {
          throw new Error("scratch DB client not initialized yet");
        }
        const value = client[prop];
        return typeof value === "function" ? value.bind(client) : value;
      },
    }
  );
  return { holder, proxy };
});

vi.mock("~/lib/db", () => ({ baseDb: scratchDb.proxy, db: scratchDb.proxy }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/app/actions/getUserAccessibleProjects", () => ({
  getUserAccessibleProjects: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getUserAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";
import { POST } from "@/api/repository-cases/view-options/route";

/**
 * Reads the scratch database URL from .env.e2e (project root = vitest cwd).
 * Returns null unless the URL unambiguously targets the tpi_test scratch
 * database — the safety gate this suite refuses to run without.
 */
function readScratchDbUrl(): string | null {
  try {
    const envPath = resolve(process.cwd(), ".env.e2e");
    const content = readFileSync(envPath, "utf8");
    const match = content.match(/^DATABASE_URL="?([^"\r\n]+)"?/m);
    const url = match?.[1] ?? null;
    if (!url || !/\/tpi_test(\?|$)/.test(new URL(url).pathname + "?")) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const SCRATCH_URL = RUN_INTEGRATION ? readScratchDbUrl() : null;
const describeIntegration =
  RUN_INTEGRATION && SCRATCH_URL ? describe : describe.skip;

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

describeIntegration("repositoryCaseFacetCounts (live scratch DB)", () => {
  const suffix = `facets_${Date.now().toString(36)}_${Math.floor(
    Math.random() * 1e6
  ).toString(36)}`;

  let client: any;
  let db: FacetCountsDb;

  let userA: { id: string };
  let userB: { id: string };
  let project: { id: number };
  let tmplA: { id: number };
  let tmplB: { id: number };
  let wfX: { id: number };
  let wfY: { id: number };
  let t1: { id: number };
  let t2: { id: number };
  let tDel: { id: number };
  let fieldF: { id: number; displayName: string };
  let fieldG: { id: number; displayName: string };
  let fieldD: { id: number; displayName: string };
  let optD1: { id: number };
  let optD2: { id: number };
  let run: { id: number };
  // c1..c6 repository-case ids, indexed 0..5.
  const cases: number[] = [];

  beforeAll(async () => {
    client = new ZenStackClient(schema, {
      dialect: createDialect(SCRATCH_URL!, []),
    });
    scratchDb.holder.client = client;
    db = client as unknown as FacetCountsDb;

    const role = await client.roles.findFirst({ select: { id: true } });
    expect(role).not.toBeNull();

    userA = await client.user.create({
      data: {
        name: `Facet IT A ${suffix}`,
        email: `${suffix}.a@example.test`,
        roleId: role!.id,
      },
      select: { id: true },
    });
    userB = await client.user.create({
      data: {
        name: `Facet IT B ${suffix}`,
        email: `${suffix}.b@example.test`,
        roleId: role!.id,
      },
      select: { id: true },
    });

    project = await client.projects.create({
      data: { name: `Facet IT ${suffix}`, createdBy: userA.id },
      select: { id: true },
    });
    const repository = await client.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await client.repositoryFolders.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        name: `root ${suffix}`,
        creatorId: userA.id,
      },
      select: { id: true },
    });

    // Reuse two existing (seeded) workflow states — cases only reference them.
    const workflows = await client.workflows.findMany({
      where: { isDeleted: false },
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true },
    });
    expect(workflows.length).toBe(2);
    [wfX, wfY] = workflows;

    const textType = await client.caseFieldTypes.findFirst({
      where: { type: "Text Long" },
      select: { id: true },
    });
    expect(textType).not.toBeNull();

    fieldF = await client.caseFields.create({
      data: {
        displayName: `F ${suffix}`,
        systemName: `f_${suffix}`,
        typeId: textType!.id,
      },
      select: { id: true, displayName: true },
    });
    fieldG = await client.caseFields.create({
      data: {
        displayName: `G ${suffix}`,
        systemName: `g_${suffix}`,
        typeId: textType!.id,
      },
      select: { id: true, displayName: true },
    });

    // Option-type field: the shape behind the production UAT bug where a
    // Dropdown chipped to one option rendered a NEGATIVE "None" count.
    const dropdownType = await client.caseFieldTypes.findFirst({
      where: { type: "Dropdown" },
      select: { id: true },
    });
    expect(dropdownType).not.toBeNull();

    optD1 = await client.fieldOptions.create({
      data: { name: `d1 ${suffix}`, order: 0 },
      select: { id: true },
    });
    optD2 = await client.fieldOptions.create({
      data: { name: `d2 ${suffix}`, order: 1 },
      select: { id: true },
    });
    fieldD = await client.caseFields.create({
      data: {
        displayName: `D ${suffix}`,
        systemName: `d_${suffix}`,
        typeId: dropdownType!.id,
        fieldOptions: {
          create: [{ fieldOptionId: optD1.id }, { fieldOptionId: optD2.id }],
        },
      },
      select: { id: true, displayName: true },
    });

    tmplA = await client.templates.create({
      data: {
        templateName: `A ${suffix}`,
        isEnabled: true,
        isDefault: false,
        projects: { create: [{ projectId: project.id }] },
        caseFields: {
          create: [
            { caseFieldId: fieldF.id, order: 0 },
            { caseFieldId: fieldG.id, order: 1 },
            { caseFieldId: fieldD.id, order: 2 },
          ],
        },
      },
      select: { id: true },
    });
    tmplB = await client.templates.create({
      data: {
        templateName: `B ${suffix}`,
        isEnabled: true,
        isDefault: false,
        projects: { create: [{ projectId: project.id }] },
      },
      select: { id: true },
    });

    t1 = await client.tags.create({
      data: { name: `t1 ${suffix}` },
      select: { id: true },
    });
    t2 = await client.tags.create({
      data: { name: `t2 ${suffix}` },
      select: { id: true },
    });
    tDel = await client.tags.create({
      data: { name: `tdel ${suffix}`, isDeleted: true, deletedAt: new Date() },
      select: { id: true },
    });

    // Case matrix (template, state, live tags, F text, G text, D option):
    //   c1: A, X, [t1],      "alpha foo",  "g one",    D1
    //   c2: A, Y, [t1,t2],   "bar",        "g two",    D1
    //   c3: B, X, [t2],      "foo baz",    "g three",  —
    //   c4: A, X, [],        —             "g four",   D2
    //   c5: B, Y, [t1,t2],   —             "g five",   —
    //   c6: B, X, [tDel],    —             —           —
    const matrix: Array<{
      templateId: number;
      stateId: number;
      tagIds: number[];
      f: string | null;
      g: string | null;
      d: number | null;
    }> = [
      {
        templateId: tmplA.id,
        stateId: wfX.id,
        tagIds: [t1.id],
        f: "alpha foo",
        g: "g one",
        d: optD1.id,
      },
      {
        templateId: tmplA.id,
        stateId: wfY.id,
        tagIds: [t1.id, t2.id],
        f: "bar",
        g: "g two",
        d: optD1.id,
      },
      {
        templateId: tmplB.id,
        stateId: wfX.id,
        tagIds: [t2.id],
        f: "foo baz",
        g: "g three",
        d: null,
      },
      {
        templateId: tmplA.id,
        stateId: wfX.id,
        tagIds: [],
        f: null,
        g: "g four",
        d: optD2.id,
      },
      {
        templateId: tmplB.id,
        stateId: wfY.id,
        tagIds: [t1.id, t2.id],
        f: null,
        g: "g five",
        d: null,
      },
      {
        templateId: tmplB.id,
        stateId: wfX.id,
        tagIds: [tDel.id],
        f: null,
        g: null,
        d: null,
      },
    ];
    for (const [index, spec] of matrix.entries()) {
      const created = await client.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repository.id,
          folderId: folder.id,
          templateId: spec.templateId,
          stateId: spec.stateId,
          name: `c${index + 1} ${suffix}`,
          creatorId: userA.id,
          caseTags: { create: spec.tagIds.map((tagId) => ({ tagId })) },
          caseFieldValues: {
            create: [
              ...(spec.f !== null
                ? [{ fieldId: fieldF.id, value: spec.f }]
                : []),
              ...(spec.g !== null
                ? [{ fieldId: fieldG.id, value: spec.g }]
                : []),
              // Dropdown values are stored as the bare numeric option id.
              ...(spec.d !== null
                ? [{ fieldId: fieldD.id, value: spec.d }]
                : []),
            ],
          },
        },
        select: { id: true },
      });
      cases.push(created.id);
    }

    // Run fixtures for the run-mode tests: rows for c1 (assigned to A),
    // c2 (unassigned), c3 (assigned to B); statuses stay null (untested).
    run = await client.testRuns.create({
      data: {
        projectId: project.id,
        name: `run ${suffix}`,
        stateId: wfX.id,
        createdById: userA.id,
        testCases: {
          create: [
            { repositoryCaseId: cases[0], assignedToId: userA.id },
            { repositoryCaseId: cases[1] },
            { repositoryCaseId: cases[2], assignedToId: userB.id },
          ],
        },
      },
      select: { id: true },
    });

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: userA.id },
    } as never);
    vi.mocked(getUserAccessibleProjects).mockResolvedValue([
      { projectId: project.id },
    ] as never);
  });

  afterAll(async () => {
    if (!client) return;
    try {
      if (project) {
        await client.testRunCases.deleteMany({
          where: { testRun: { projectId: project.id } },
        });
        await client.testRuns.deleteMany({
          where: { projectId: project.id },
        });
        await client.repositoryCases.deleteMany({
          where: { projectId: project.id },
        });
        await client.repositoryFolders.deleteMany({
          where: { projectId: project.id },
        });
        await client.repositories.deleteMany({
          where: { projectId: project.id },
        });
        await client.projects.delete({ where: { id: project.id } });
      }
      const templateIds = [tmplA, tmplB].filter(Boolean).map((t) => t.id);
      if (templateIds.length > 0) {
        await client.templates.deleteMany({
          where: { id: { in: templateIds } },
        });
      }
      const fieldIds = [fieldF, fieldG, fieldD]
        .filter(Boolean)
        .map((f) => f.id);
      if (fieldIds.length > 0) {
        await client.caseFields.deleteMany({ where: { id: { in: fieldIds } } });
      }
      // CaseFieldAssignment cascades with the field; the options do not.
      const optionIds = [optD1, optD2].filter(Boolean).map((o) => o.id);
      if (optionIds.length > 0) {
        await client.fieldOptions.deleteMany({
          where: { id: { in: optionIds } },
        });
      }
      const tagIds = [t1, t2, tDel].filter(Boolean).map((t) => t.id);
      if (tagIds.length > 0) {
        await client.tags.deleteMany({ where: { id: { in: tagIds } } });
      }
      const userIds = [userA, userB].filter(Boolean).map((u) => u.id);
      if (userIds.length > 0) {
        await client.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await client.$disconnect();
    }
  });

  const countOf = (
    rows: Array<{ id: number | string; count: number }>,
    id: number | string
  ) => rows.find((row) => row.id === id)?.count;

  it("self-excludes each chipped dimension and counts unchipped dimensions under whereAll", async () => {
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        { dimension: "templates", operator: "in", values: [tmplA.id] },
        { dimension: "tags", operator: "any", values: [t1.id] },
      ],
    });

    // whereAll = template A AND live-tag t1 → {c1, c2}.
    expect(result.totalCount).toBe(2);

    // Templates facet self-excludes templates but keeps the tags predicate:
    // live-t1 cases are c1 (A), c2 (A), c5 (B) — template B stays visible.
    expect(countOf(result.templates, tmplA.id)).toBe(2);
    expect(countOf(result.templates, tmplB.id)).toBe(1);

    // Tags facet self-excludes tags but keeps the template predicate:
    // template-A cases are {c1, c2, c4} → t1 on c1+c2, t2 on c2.
    expect(countOf(result.tags, t1.id)).toBe(2);
    expect(countOf(result.tags, t2.id)).toBe(1);
    expect(countOf(result.tags, "any")).toBe(2); // c1, c2 (c4 untagged)
    expect(countOf(result.tags, "none")).toBe(1); // c4

    // Unchipped dimensions count under whereAll ({c1, c2}).
    expect(countOf(result.states, wfX.id)).toBe(1); // c1
    expect(countOf(result.states, wfY.id)).toBe(1); // c2
    expect(result.automated).toEqual([{ value: false, count: 2 }]);
    expect(countOf(result.creators, userA.id)).toBe(2);

    // Unchipped dynamic field F derives hasValue/noValue from whereAll too:
    // c1 and c2 both carry F values.
    expect(result.dynamicFields[fieldF.displayName]?.counts).toEqual({
      hasValue: 2,
      noValue: 0,
    });
  });

  it("reports dimensionTotals as the self-excluded base for a chipped dimension and the all-predicates total for the rest", async () => {
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        { dimension: "templates", operator: "in", values: [tmplA.id] },
      ],
    });

    // whereAll = template A → {c1, c2, c4}.
    expect(result.totalCount).toBe(3);

    // CHIPPED dimension: its total is the count with its OWN chip lifted (all
    // six cases), which is exactly the base its per-option counts sit on. The
    // client's "All templates" row reads this instead of totalCount, so it can
    // never be smaller than the options listed under it.
    expect(result.dimensionTotals.templates).toBe(6);
    expect(result.dimensionTotals.templates).toBe(
      result.templates.reduce((sum, row) => sum + row.count, 0)
    );

    // UNCHIPPED dimensions share whereAll, so their total IS totalCount.
    for (const key of [
      "states",
      "creators",
      "automated",
      "parameterized",
      "attachments",
      "tags",
      "issues",
      `field_${fieldD.id}`,
      `field_${fieldF.id}`,
      `field_${fieldG.id}`,
    ]) {
      expect([key, result.dimensionTotals[key]]).toEqual([key, 3]);
    }

    // Sums of the facet buckets agree with those totals (each facet's buckets
    // partition its own base).
    expect(result.states.reduce((sum, row) => sum + row.count, 0)).toBe(3);
    expect(result.attachments.reduce((sum, row) => sum + row.count, 0)).toBe(3);
    expect(countOf(result.tags, "any")! + countOf(result.tags, "none")!).toBe(
      3
    );
  });

  it("executes tags all/none fragments against real join rows, excluding soft-deleted tags", async () => {
    const totalFor = async (
      operator: string,
      values: Array<number | string>
    ) => {
      const result = await computeRepositoryCaseFacetCounts(db, {
        projectId: project.id,
        predicates: [{ dimension: "tags", operator, values }],
      });
      return result.totalCount;
    };

    // all [t1, t2] → both live tags present: c2, c5.
    expect(await totalFor("all", [t1.id, t2.id])).toBe(2);
    // Bare any → some live tag: c1, c2, c3, c5 (c6's only tag is soft-deleted).
    expect(await totalFor("any", [])).toBe(4);
    // Bare none → no live tag: c4 (untagged) and c6 (deleted tag only).
    expect(await totalFor("none", [])).toBe(2);
    // none [t1] → no live t1 link: c3, c4, c6.
    expect(await totalFor("none", [t1.id])).toBe(3);
    // all [tDel] → a soft-deleted tag can never satisfy the fragment.
    expect(await totalFor("all", [tDel.id])).toBe(0);

    // Per-tag facet rows come from the raw join SQL (self-excluded → full
    // project scope here): t1 on c1/c2/c5, t2 on c2/c3/c5.
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        { dimension: "tags", operator: "all", values: [t1.id, t2.id] },
      ],
    });
    expect(countOf(result.tags, t1.id)).toBe(3);
    expect(countOf(result.tags, t2.id)).toBe(3);
  });

  it("derives hasValue/noValue pairs from whereExcept — the legacy negative-noValue shape stays exact and >= 0", async () => {
    // Legacy shape that went negative: G has 5 valued cases project-wide, but
    // an active text chip on F narrows the base to 2 cases. The legacy code
    // mixed the two bases (2 - 5 = -3); the engine derives both numbers from
    // the same per-field base.
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        {
          dimension: `field_${fieldF.id}`,
          operator: "contains",
          values: ["foo"],
        },
      ],
    });

    // whereAll = F contains "foo" → {c1, c3}; both carry G values.
    const gCounts = result.dynamicFields[fieldG.displayName]?.counts;
    expect(gCounts).toEqual({ hasValue: 2, noValue: 0 });
    expect(gCounts!.noValue).toBeGreaterThanOrEqual(0);

    // The chipped field F self-excludes: base = all 6 cases, F valued on 3.
    expect(result.dynamicFields[fieldF.displayName]?.counts).toEqual({
      hasValue: 3,
      noValue: 3,
    });
  });

  it("REGRESSION (production UAT): an option field chipped to one option keeps a non-negative, exact None count", async () => {
    // The reported bug: a Dropdown filtered to one option rendered a NEGATIVE
    // "None" row, because the client derived None by subtracting the option
    // counts (self-excluded base = 6 cases) from totalCount (all-predicates
    // base = 2 cases). The engine now emits the pair from the SAME base and
    // publishes that base as dimensionTotals.
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        {
          dimension: `field_${fieldD.id}`,
          operator: "in",
          values: [optD1.id],
        },
      ],
    });

    // whereAll = D is option 1 → {c1, c2}.
    expect(result.totalCount).toBe(2);

    const facet = result.dynamicFields[fieldD.displayName];
    expect(facet).toBeDefined();
    expect(facet.type).toBe("Dropdown");

    // Self-excluded base = all six cases; three of them carry a D value.
    expect(result.dimensionTotals[`field_${fieldD.id}`]).toBe(6);
    expect(facet.counts).toEqual({ hasValue: 3, noValue: 3 });
    expect(facet.counts!.noValue).toBeGreaterThanOrEqual(0);

    // Option rows sit on that same base: D1 on c1+c2, D2 on c4.
    expect(countOf(facet.options!, optD1.id)).toBe(2);
    expect(countOf(facet.options!, optD2.id)).toBe(1);

    // The identity the UI relies on: base - Σoptions = None (one option per
    // case for a Dropdown). Under the old mixed bases this was 2 - 3 = -1.
    const optionSum = facet.options!.reduce((sum, o) => sum + o.count, 0);
    expect(result.dimensionTotals[`field_${fieldD.id}`] - optionSum).toBe(
      facet.counts!.noValue
    );
    expect(result.totalCount - optionSum).toBeLessThan(0);
  });

  it("computes counts only within searchCaseIds, without self-excluding the search", async () => {
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        { dimension: "templates", operator: "in", values: [tmplA.id] },
      ],
      searchCaseIds: [cases[0], cases[2], cases[5]], // c1, c3, c6
    });

    // whereAll = search ids ∧ template A → {c1}.
    expect(result.totalCount).toBe(1);
    // Templates self-exclusion drops the template chip but NEVER the search:
    // within {c1, c3, c6} → A:1 (c1), B:2 (c3, c6).
    expect(countOf(result.templates, tmplA.id)).toBe(1);
    expect(countOf(result.templates, tmplB.id)).toBe(2);
  });

  it("intersects searchCaseIds with the run-membership id filter (not overwrite)", async () => {
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      isRunMode: true,
      effectiveRunIds: [run.id],
      predicates: [],
      searchCaseIds: [cases[1], cases[2], cases[3]], // c2, c3, c4
    });

    // Run membership {c1, c2, c3} ∩ search {c2, c3, c4} = {c2, c3}.
    // Overwriting either way would yield 3.
    expect(result.totalCount).toBe(2);
    expect(result.testRunOptions).not.toBeNull();
    expect(result.testRunOptions!.totalCount).toBe(2);
    // c2 unassigned, c3 assigned to userB; c1's row (userA) is outside the
    // intersection.
    expect(result.testRunOptions!.unassignedCount).toBe(1);
    expect(countOf(result.testRunOptions!.assignedTo, userB.id)).toBe(1);
    expect(
      countOf(result.testRunOptions!.assignedTo, userA.id)
    ).toBeUndefined();
    // All rows in scope are untested (statusId null).
    expect(result.testRunOptions!.untestedCount).toBe(2);
  });

  it("ROUTE: hostile searchCaseIds are sanitized and still INTERSECT the run scope", async () => {
    const response = await POST(
      makeRequest({
        projectId: project.id,
        isRunMode: true,
        runIds: [run.id],
        predicates: [],
        // Duplicated, negative, non-integer and non-numeric entries alongside
        // c2, c3, c4. After sanitization the set is exactly {c2, c3, c4}.
        searchCaseIds: [
          cases[1],
          cases[1],
          -5,
          0,
          2.5,
          "13",
          null,
          cases[2],
          cases[3],
        ],
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    // Run membership {c1, c2, c3} ∩ search {c2, c3, c4} = {c2, c3}. Letting a
    // junk id through, or overwriting either scope with the other, yields 3.
    expect(body.totalCount).toBe(2);
    expect(body.testRunOptions.totalCount).toBe(2);
    expect(body.dimensionTotals.templates).toBe(2);
    // c1 is in the run but outside the search; c4 is in the search but outside
    // the run — neither may contribute.
    expect(countOf(body.testRunOptions.assignedTo, userA.id)).toBeUndefined();
    expect(countOf(body.testRunOptions.assignedTo, userB.id)).toBe(1);
    expect(body.testRunOptions.unassignedCount).toBe(1);
  });

  it("self-excludes run dimensions: an assignedTo chip filters statuses and repo facets but not the assignedTo facet", async () => {
    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      isRunMode: true,
      effectiveRunIds: [run.id],
      predicates: [
        { dimension: "assignedTo", operator: "in", values: ["unassigned"] },
      ],
    });

    // Repo facets apply the run predicate as a case-id fragment: only c2 has
    // an unassigned row.
    expect(result.totalCount).toBe(1);
    expect(countOf(result.templates, tmplA.id)).toBe(1);
    expect(countOf(result.templates, tmplB.id)).toBeUndefined();

    // Statuses facet applies the assignedTo predicate row-wise → only c2's
    // untested row.
    expect(result.testRunOptions!.untestedCount).toBe(1);
    expect(result.testRunOptions!.statuses).toEqual([]);
    // The assignedTo facet self-excludes its own chip → all three rows.
    expect(countOf(result.testRunOptions!.assignedTo, userA.id)).toBe(1);
    expect(countOf(result.testRunOptions!.assignedTo, userB.id)).toBe(1);
    expect(result.testRunOptions!.unassignedCount).toBe(1);
    expect(result.testRunOptions!.totalCount).toBe(1);
  });

  it("applies text-operator predicates via the shared matchers — counts agree with matchesPostFetchFilters over the same rows", async () => {
    const filter: PostFetchFilter = {
      fieldId: fieldF.id,
      type: "text",
      operator: "contains",
      value1: "foo",
    };
    const rows = await client.caseFieldValues.findMany({
      where: { fieldId: fieldF.id, testCaseId: { in: cases } },
      select: { testCaseId: true, value: true },
    });
    const expectedIds = rows
      .filter((row: { testCaseId: number; value: unknown }) =>
        matchesPostFetchFilters(
          { caseFieldValues: [{ fieldId: fieldF.id, value: row.value }] },
          [filter]
        )
      )
      .map((row: { testCaseId: number }) => row.testCaseId);
    expect(new Set(expectedIds)).toEqual(new Set([cases[0], cases[2]]));

    const result = await computeRepositoryCaseFacetCounts(db, {
      projectId: project.id,
      predicates: [
        {
          dimension: `field_${fieldF.id}`,
          operator: "contains",
          values: ["foo"],
        },
      ],
    });
    expect(result.totalCount).toBe(expectedIds.length);
    // Every facet is scoped to the matcher-selected ids {c1, c3}.
    expect(countOf(result.templates, tmplA.id)).toBe(1);
    expect(countOf(result.templates, tmplB.id)).toBe(1);
    expect(countOf(result.tags, t1.id)).toBe(1); // c1
    expect(countOf(result.tags, t2.id)).toBe(1); // c3
  });

  it("LEGACY REGRESSION: a ReportBuilder-shaped body keeps non-self-excluding template/state semantics", async () => {
    const response = await POST(
      makeRequest({
        projectId: project.id,
        templateIds: [tmplA.id],
        stateIds: [wfX.id],
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    // Legacy semantics: the filters fold into baseWhere for EVERY facet, so
    // the templates facet collapses to the selected template and the states
    // facet to the selected state. If someone normalized the legacy body into
    // predicates, self-exclusion would surface template B / state Y here.
    expect(body.templates).toEqual([
      expect.objectContaining({ id: tmplA.id, count: 2 }), // c1, c4
    ]);
    expect(body.states).toEqual([
      expect.objectContaining({ id: wfX.id, count: 2 }),
    ]);
    expect(body.totalCount).toBe(2);
  });

  it("LEGACY REGRESSION: dynamicFieldFilters keep the legacy JS-intersection semantics", async () => {
    const response = await POST(
      makeRequest({
        projectId: project.id,
        dynamicFieldFilters: { [fieldF.id]: ["alpha foo"] },
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    // Legacy scalar matching is exact-value includes(): only c1.
    expect(body.totalCount).toBe(1);
    expect(body.templates).toEqual([
      expect.objectContaining({ id: tmplA.id, count: 1 }),
    ]);
  });

  it("the same filter through the engine branch self-excludes (route contrast for the hard branch)", async () => {
    const response = await POST(
      makeRequest({
        projectId: project.id,
        predicates: [
          { dimension: "templates", operator: "in", values: [tmplA.id] },
        ],
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    // Engine semantics: templates self-exclude, so BOTH templates surface
    // with their unfiltered counts while totalCount honors the predicate.
    expect(countOf(body.templates, tmplA.id)).toBe(3); // c1, c2, c4
    expect(countOf(body.templates, tmplB.id)).toBe(3); // c3, c5, c6
    expect(body.totalCount).toBe(3);
  });
});
